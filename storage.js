// Thin IndexedDB wrapper for projects and their daily reports (including
// photo/signature/template blobs) on-device. No library needed.

const DB_NAME = 'daily-report-app';
const DB_VERSION = 3;
const REPORTS_STORE = 'reports';
const PROJECTS_STORE = 'projects';
const SETTINGS_STORE = 'settings';
const DEFAULT_TEMPLATE_URL = 'template/daily-work-report-template.xlsx';
const LOGO_SETTING_KEY = 'reportLogo';
const APP_ICON_SETTING_KEY = 'useLogoAsAppIcon';
const APP_ICON_COLOR_SETTING_KEY = 'appIconBgColor';
const DEFAULT_APP_ICON_COLOR = '#1c3d5a'; // the brand blue the built-in icon already uses

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

function getUseLogoAsAppIcon() {
  return getSetting(APP_ICON_SETTING_KEY).then((v) => !!v);
}

async function setUseLogoAsAppIcon(on) {
  await saveSetting(APP_ICON_SETTING_KEY, !!on);
}

function getAppIconColor() {
  return getSetting(APP_ICON_COLOR_SETTING_KEY).then((v) => v || DEFAULT_APP_ICON_COLOR);
}

async function setAppIconColor(color) {
  await saveSetting(APP_ICON_COLOR_SETTING_KEY, color || DEFAULT_APP_ICON_COLOR);
}

// Paints the logo onto a square tile, the same shape as the built-in icon. A
// bare logo would be letterboxed by the OS and look lost on a home screen,
// and wide logos would shrink to nothing as a favicon. `bgColor` is a hex
// string, or the literal 'transparent' for no tile at all -- just the logo on
// whatever background the OS puts behind it.
function buildAppIconFromLogo(logoBlob, size, bgColor) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(logoBlob);
    const img = new Image();
    img.onload = () => {
      try {
        const s = size || 192;
        const color = bgColor || DEFAULT_APP_ICON_COLOR;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = s;
        const ctx = canvas.getContext('2d');

        if (color !== 'transparent') {
          const r = s * 0.146; // matches the built-in icon's corner radius
          ctx.fillStyle = color;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(0, 0, s, s, r);
          else ctx.rect(0, 0, s, s);
          ctx.fill();
        }

        // Aspect-preserving fit inside a padded square.
        const pad = s * 0.14;
        const box = s - pad * 2;
        const scale = Math.min(box / img.naturalWidth, box / img.naturalHeight);
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        ctx.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);

        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('icon render failed'))), 'image/png');
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('could not read that image'));
    };
    img.src = url;
  });
}

// Swaps the tab/bookmark icon when the user has opted in. The installed
// home-screen icon comes from manifest.json and is captured at install time,
// so that one only changes if the app is re-added.
async function applyAppIcon() {
  try {
    if (!(await getUseLogoAsAppIcon())) return;
    const logo = await getReportLogo();
    if (!logo) return;
    const color = await getAppIconColor();
    const icon = await buildAppIconFromLogo(logo, 192, color);
    const href = URL.createObjectURL(icon);
    document.querySelectorAll('link[rel="icon"]').forEach((l) => {
      l.href = href;
      l.type = 'image/png';
    });
  } catch (err) {
    console.error('app icon:', err); // cosmetic only -- never block the page
  }
}

// Shows the company logo in the header bar, but only once the app is actually
// installed (added to the home screen) -- a browser tab already has its own
// favicon, so this is reserved for the "feels like a real app" moment.
async function applyHeaderLogo() {
  try {
    const header = document.querySelector('.app-header');
    if (!header) return;

    const installed = typeof isAppInstalled === 'function' && isAppInstalled();
    const logo = installed ? await getReportLogo() : null;

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

async function saveReport(report) {
  report.updatedAt = Date.now();
  await putReportRaw(report);
}

async function deleteReport(id) {
  await withStore(REPORTS_STORE, 'readwrite', (store) => store.delete(id));
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
  const reports = await getReportsForProject(id);
  for (const r of reports) {
    await deleteReport(r.id);
  }
  await withStore(PROJECTS_STORE, 'readwrite', (store) => store.delete(id));
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
  return copy;
}

function deserializeImportedProject(raw) {
  const project = { ...raw };
  // Older backups carry a template copy; drop it rather than decoding it.
  delete project.templateBlob;
  delete project.templateFileName;
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
      useLogoAsAppIcon: await getUseLogoAsAppIcon(),
      appIconBgColor: await getAppIconColor(),
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
    if (incomingSettings.useLogoAsAppIcon) await setUseLogoAsAppIcon(true);
    if (incomingSettings.appIconBgColor) await setAppIconColor(incomingSettings.appIconBgColor);
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
