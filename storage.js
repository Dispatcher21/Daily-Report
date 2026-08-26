// Thin IndexedDB wrapper for projects and their daily reports (including
// photo/signature blobs) on-device. No library needed.

const DB_NAME = 'daily-report-app';
const DB_VERSION = 3;
const REPORTS_STORE = 'reports';
const PROJECTS_STORE = 'projects';
const SETTINGS_STORE = 'settings';
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

// Favorite-starred projects, kept per device-user (by name), never synced to
// the company -- two people sharing a login see their own favorites, and
// switching companies doesn't touch this list.
function favoriteProjectsSettingKey(userName) {
  return `favoriteProjects:${userName || '_anon'}`;
}

async function getFavoriteProjectIds() {
  const userName = await getUserName();
  return (await getSetting(favoriteProjectsSettingKey(userName))) || [];
}

async function toggleFavoriteProject(projectId) {
  const userName = await getUserName();
  const key = favoriteProjectsSettingKey(userName);
  const ids = (await getSetting(key)) || [];
  const idx = ids.indexOf(projectId);
  if (idx === -1) ids.push(projectId);
  else ids.splice(idx, 1);
  await saveSetting(key, ids);
  return ids;
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

// onCompanySyncReportChanged is an optional hook into firebase-sync.js --
// storage.js has no idea that file exists. It's a plain global checked by
// name so pages that don't include firebase-sync.js work exactly as before,
// and so this file never needs to import anything sync-related itself.
// Fired without awaiting: a company push shouldn't make the caller wait for
// a save that's already durable in IndexedDB by this point.
async function saveReport(report) {
  const userName = await getUserName();
  if (userName) {
    if (!report.createdBy) report.createdBy = userName; // set once, never overwritten by a later editor
    report.lastEditedBy = userName;
  }
  report.updatedAt = Date.now();
  await putReportRaw(report);
  if (typeof onCompanySyncReportChanged === 'function') {
    onCompanySyncReportChanged(report, false).catch((err) => console.error('company sync mirror:', err));
  }
}

async function deleteReport(id) {
  const report = typeof onCompanySyncReportChanged === 'function' ? await getReport(id) : null;
  await withStore(REPORTS_STORE, 'readwrite', (store) => store.delete(id));
  if (report) {
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
  const project = typeof onCompanySyncProjectChanged === 'function' ? await getProject(id) : null;
  const reports = await getReportsForProject(id);
  for (const r of reports) {
    await deleteReport(r.id); // also mirrors each report's own deletion, see above
  }
  await withStore(PROJECTS_STORE, 'readwrite', (store) => store.delete(id));
  if (project) {
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

// ---------- Blob <-> JSON-safe encoding ----------
//
// A project's Blob fields (background image, template files) aren't
// JSON-safe on their own. This converts each Blob to base64 text (+ its
// mime type so it can be reconstructed exactly) and back -- used by
// serializeProjectForExport/deserializeImportedProject below, which
// report-bundle.js relies on to put a project's data in a shareable
// .report file.

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

// ---------- Merging a single incoming record ----------
//
// One item at a time -- as read from a .report bundle, one file per
// report/project. "Newer updatedAt wins" per record. Takes an
// already-fully-formed record (real Blob/File objects) so it works the
// same regardless of where it came from -- see report-bundle.js.
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
