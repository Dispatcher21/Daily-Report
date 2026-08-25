// Thin IndexedDB wrapper for projects and their daily reports (including
// photo/signature/template blobs) on-device. No library needed.

const DB_NAME = 'daily-report-app';
const DB_VERSION = 3;
const REPORTS_STORE = 'reports';
const PROJECTS_STORE = 'projects';
const SETTINGS_STORE = 'settings';
const DEFAULT_TEMPLATE_URL = 'template/daily-work-report-template.xlsx';
const LOGO_SETTING_KEY = 'reportLogo';
const USER_NAME_SETTING_KEY = 'userName';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(REPORTS_STORE)) {
        db.createObjectStore(REPORTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------- App-level settings ----------
//
// Things that belong to the whole app rather than one project -- the company
// logo above all, which is the same on every report the inspector files.

function getSetting(key) {
  return withStore(SETTINGS_STORE, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  });
}

async function saveSetting(key, value) {
  await withStore(SETTINGS_STORE, 'readwrite', (store) => store.put({ key, value }));
}

async function deleteSetting(key) {
  await withStore(SETTINGS_STORE, 'readwrite', (store) => store.delete(key));
}

function getReportLogo() {
  return getSetting(LOGO_SETTING_KEY);
}

async function saveReportLogo(blob) {
  await saveSetting(LOGO_SETTING_KEY, blob);
}

async function clearReportLogo() {
  await deleteSetting(LOGO_SETTING_KEY);
}

// The name this device is logged in as (see login.html) -- used to prefill
// a new report's Representative field and to stamp who created/last edited
// one, so an admin can tell whose work is whose. Optional: a device that
// never logged in just has no name, and everything behaves as it always
// did (blank/carried-forward representative, no attribution).
function getUserName() {
  return getSetting(USER_NAME_SETTING_KEY);
}
async function saveUserName(name) {
  await saveSetting(USER_NAME_SETTING_KEY, name || '');
}

// Shows the company logo in the header bar -- in the installed app and in
// a plain browser tab alike, since this is used as a regular website too,
// not just installed.
async function applyHeaderLogo() {
  try {
    const header = document.querySelector('.app-header');
    if (!header) return;

    const logo = await getReportLogo();

    let img = header.querySelector('.header-logo');
    if (!logo) {
      if (img) {
        if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
        img.remove();
      }
      return;
    }

    if (!img) {
      img = document.createElement('img');
      img.className = 'header-logo';
      img.alt = '';
      header.insertBefore(img, header.firstChild);
    }
    const url = URL.createObjectURL(logo);
    const prevUrl = img.dataset.url;
    img.src = url;
    img.dataset.url = url;
    if (prevUrl) URL.revokeObjectURL(prevUrl);
  } catch (err) {
    console.error('header logo:', err); // cosmetic only -- never block the page
  }
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Reports ----------

async function putReportRaw(report) {
  await withStore(REPORTS_STORE, 'readwrite', (store) => store.put(report));
}

// The onLocalFolder* calls below are optional hooks into local-folder-sync.js
// (mirrors data to a user-chosen folder) -- storage.js has no idea that file
// exists. They're plain globals checked by name so pages that don't include
// local-folder-sync.js work exactly as before, and so this file never needs
// to import anything sync-related itself. Fired without awaiting: folder I/O
// shouldn't make the caller wait for a save that's already durable in
// IndexedDB by this point.
async function saveReport(report) {
  const userName = await getUserName();
  if (userName) {
    if (!report.createdBy) report.createdBy = userName; // set once, never overwritten by a later editor
    report.lastEditedBy = userName;
  }
  report.updatedAt = Date.now();
  await putReportRaw(report);
  if (typeof onLocalFolderReportChanged === 'function') {
    onLocalFolderReportChanged(report, false).catch((err) => console.error('local folder mirror:', err));
  }
  if (typeof onCompanySyncReportChanged === 'function') {
    onCompanySyncReportChanged(report, false).catch((err) => console.error('company sync mirror:', err));
  }
}

async function deleteReport(id) {
  const needsReport = typeof onLocalFolderReportChanged === 'function' || typeof onCompanySyncReportChanged === 'function';
  const report = needsReport ? await getReport(id) : null;
  await withStore(REPORTS_STORE, 'readwrite', (store) => store.delete(id));
  if (report) {
    if (typeof onLocalFolderReportChanged === 'function') {
      onLocalFolderReportChanged(report, true).catch((err) => console.error('local folder mirror:', err));
    }
    if (typeof onCompanySyncReportChanged === 'function') {
      onCompanySyncReportChanged(report, true).catch((err) => console.error('company sync mirror:', err));
    }
  }
}

function getAllReports() {
  return withStore(REPORTS_STORE, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.updatedAt - a.updatedAt));
      req.onerror = () => reject(req.error);
    });
  });
}

async function getReportsForProject(projectId) {
  const all = await getAllReports();
  return all.filter((r) => r.projectId === projectId);
}

async function getReport(id) {
  const all = await getAllReports();
  return all.find((r) => r.id === id) || null;
}

async function getNextReportNo(projectId) {
  const reports = await getReportsForProject(projectId);
  const max = reports.reduce((m, r) => Math.max(m, Number(r.reportNo) || 0), 0);
  return max + 1;
}

// ---------- Projects ----------

async function putProjectRaw(project) {
  await withStore(PROJECTS_STORE, 'readwrite', (store) => store.put(project));
}

async function saveProject(project) {
  project.updatedAt = Date.now();
  await putProjectRaw(project);
  if (typeof onLocalFolderProjectChanged === 'function') {
    onLocalFolderProjectChanged(project, false).catch((err) => console.error('local folder mirror:', err));
  }
  if (typeof onCompanySyncProjectChanged === 'function') {
    onCompanySyncProjectChanged(project, false).catch((err) => console.error('company sync mirror:', err));
  }
}

function getAllProjects() {
  return withStore(PROJECTS_STORE, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.updatedAt - a.updatedAt));
      req.onerror = () => reject(req.error);
    });
  });
}

async function getProject(id) {
  const all = await getAllProjects();
  return all.find((p) => p.id === id) || null;
}

// Deletes a project and every report that belongs to it.
async function deleteProject(id) {
  const needsProject = typeof onLocalFolderProjectChanged === 'function' || typeof onCompanySyncProjectChanged === 'function';
  const project = needsProject ? await getProject(id) : null;
  const reports = await getReportsForProject(id);
  for (const r of reports) {
    await deleteReport(r.id); // also mirrors each report's own deletion, see above
  }
  await withStore(PROJECTS_STORE, 'readwrite', (store) => store.delete(id));
  if (project) {
    if (typeof onLocalFolderProjectChanged === 'function') {
      onLocalFolderProjectChanged(project, true).catch((err) => console.error('local folder mirror:', err));
    }
    if (typeof onCompanySyncProjectChanged === 'function') {
      onCompanySyncProjectChanged(project, true).catch((err) => console.error('company sync mirror:', err));
    }
  }
}

// One-time, automatic: if there are reports from before projects existed
// (no projectId), adopt them into an auto-created default project so
// nothing already entered is lost. Safe to call on every app load -- it's a
// no-op once there are no orphans left.
async function adoptOrphanReportsIfAny() {
  const all = await getAllReports();
  const orphans = all.filter((r) => !r.projectId);
  if (orphans.length === 0) return;

  // Take the project identity from the reports themselves rather than
  // hardcoding one -- they already carry these fields, and whoever's reports
  // these are, they aren't necessarily from the project this app shipped with.
  const seed = orphans[0] || {};
  const projectNo = seed.projectNo || '';
  const projectName = seed.projectName || '';
  const name = projectNo
    ? `PR#${projectNo}${projectName ? ' - ' + projectName : ''}`
    : projectName || 'Imported Reports';

  const project = {
    id: crypto.randomUUID(),
    name,
    meta: {
      projectNo,
      projectName,
      ntpDate: seed.ntpDate || '',
      representative: seed.representative || '',
      peName: seed.peName || '',
    },
    defaultContractors: [],
    defaultEquipmentLabels: [],
    payItemCatalog: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await putProjectRaw(project);
  for (const r of orphans) {
    r.projectId = project.id;
    await putReportRaw(r);
  }
}

// ---------- Backup / restore (manual export-import, no server involved) ----------
//
// Reports and projects both carry Blob fields (photos/signatures, template
// files), which aren't JSON-safe. Export converts each Blob to base64 text
// (+ its mime type so it can be reconstructed exactly); import reverses
// that. The resulting JSON file is fully self-contained -- moving it
// between devices is entirely up to the user (email, OneDrive, USB,
// whatever), the app never transmits it anywhere itself.

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000; // avoid call-stack blowups from String.fromCharCode on huge arrays
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

async function blobFieldToEntry(blob) {
  return blob ? { data: await blobToBase64(blob), type: blob.type } : null;
}

function entryToBlobField(entry) {
  return entry ? base64ToBlob(entry.data, entry.type) : null;
}

async function serializeReportForExport(report) {
  const copy = { ...report };
  copy.photos = [];
  for (const blob of report.photos || []) {
    copy.photos.push(await blobFieldToEntry(blob));
  }
  copy.repSignatureImage = await blobFieldToEntry(report.repSignatureImage);
  // peSignatureImage is retired -- only ever present on reports saved before
  // the engineer's signature box was removed. Carried through backups so an
  // older file still round-trips; nothing reads it back onto the report.
  copy.peSignatureImage = await blobFieldToEntry(report.peSignatureImage);
  return copy;
}

function deserializeImportedReport(raw) {
  const report = { ...raw };
  report.photos = (raw.photos || []).map(entryToBlobField);
  report.repSignatureImage = entryToBlobField(raw.repSignatureImage);
  // Dropped rather than decoded: the spread above would otherwise leave the
  // raw base64 wrapper sitting in a field nothing decodes any more.
  delete report.peSignatureImage;
  return report;
}

async function serializeProjectForExport(project) {
  const copy = { ...project };
  delete copy.templateBlob; // retired -- see makeProjectFromParsedFile
  copy.backgroundImage = await blobFieldToEntry(project.backgroundImage);
  return copy;
}

function deserializeImportedProject(raw) {
  const project = { ...raw };
  // Older backups carry a template copy; drop it rather than decoding it.
  delete project.templateBlob;
  delete project.templateFileName;
  project.backgroundImage = entryToBlobField(raw.backgroundImage);
  return project;
}

async function exportAllReportsBackup() {
  const reports = await getAllReports();
  const projects = await getAllProjects();
  const serializedReports = [];
  for (const r of reports) {
    serializedReports.push(await serializeReportForExport(r));
  }
  const serializedProjects = [];
  for (const p of projects) {
    serializedProjects.push(await serializeProjectForExport(p));
  }
  const logo = await getReportLogo();
  return {
    kind: 'daily-report-app-backup',
    exportedAt: Date.now(),
    projects: serializedProjects,
    reports: serializedReports,
    settings: {
      logo: await blobFieldToEntry(logo),
    },
  };
}

// Merges a previously-exported backup into local storage. Per project/report
// id: newer `updatedAt` wins, items only in the backup get added, items only
// present locally are left untouched (import never deletes anything).
async function importReportsBackup(backup) {
  const incomingProjects = (backup && backup.projects) || [];
  const existingProjects = await getAllProjects();
  const existingProjectsById = new Map(existingProjects.map((p) => [p.id, p]));

  let projectsAdded = 0;
  let projectsUpdated = 0;
  let projectsSkipped = 0;

  for (const raw of incomingProjects) {
    const project = deserializeImportedProject(raw);
    const existingProject = existingProjectsById.get(project.id);
    if (!existingProject) {
      await putProjectRaw(project);
      projectsAdded++;
    } else if ((project.updatedAt || 0) > (existingProject.updatedAt || 0)) {
      await putProjectRaw(project);
      projectsUpdated++;
    } else {
      projectsSkipped++;
    }
  }

  const incoming = (backup && backup.reports) || [];
  const existing = await getAllReports();
  const existingById = new Map(existing.map((r) => [r.id, r]));

  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const raw of incoming) {
    const report = deserializeImportedReport(raw);
    const existingReport = existingById.get(report.id);
    if (!existingReport) {
      await putReportRaw(report);
      added++;
    } else if ((report.updatedAt || 0) > (existingReport.updatedAt || 0)) {
      await putReportRaw(report);
      updated++;
    } else {
      skipped++;
    }
  }

  // Only adopt the backup's logo if this device doesn't already have one --
  // import never overwrites something already set up locally.
  let logoAdded = false;
  const incomingSettings = (backup && backup.settings) || {};
  if (incomingSettings.logo && !(await getReportLogo())) {
    await saveReportLogo(entryToBlobField(incomingSettings.logo));
    logoAdded = true;
  }

  return {
    added,
    updated,
    skipped,
    total: incoming.length,
    projectsAdded,
    projectsUpdated,
    projectsSkipped,
    projectsTotal: incomingProjects.length,
    logoAdded,
  };
}

// ---------- Merging a single incoming record ----------
//
// One item at a time -- as read from a .report bundle or a local sync
// folder, one file per report/project -- rather than a whole backup object.
// Same "newer updatedAt wins" rule importReportsBackup uses in bulk, just
// applied one at a time since that's how these arrive. Takes an
// already-fully-formed record (real Blob/File objects, not the {data,type}
// entry shape a JSON backup file carries) so it works the same regardless
// of where the record came from -- see report-bundle.js and
// local-folder-sync.js.
async function mergeReportRecord(report) {
  const existing = await getReport(report.id);
  if (!existing) {
    await putReportRaw(report);
    return 'added';
  }
  if ((report.updatedAt || 0) > (existing.updatedAt || 0)) {
    await putReportRaw(report);
    return 'updated';
  }
  return 'skipped';
}
async function mergeIncomingReport(raw) {
  return mergeReportRecord(deserializeImportedReport(raw));
}

async function mergeProjectRecord(project) {
  const existing = await getProject(project.id);
  if (!existing) {
    await putProjectRaw(project);
    return 'added';
  }
  if ((project.updatedAt || 0) > (existing.updatedAt || 0)) {
    await putProjectRaw(project);
    return 'updated';
  }
  return 'skipped';
}
async function mergeIncomingProject(raw) {
  return mergeProjectRecord(deserializeImportedProject(raw));
}
