// Thin IndexedDB wrapper for projects and their daily reports (including
// photo/signature/template blobs) on-device. No library needed.

const DB_NAME = 'daily-report-app';
const DB_VERSION = 2;
const REPORTS_STORE = 'reports';
const PROJECTS_STORE = 'projects';
const DEFAULT_TEMPLATE_URL = 'template/PR439-Daily-Work-Report-TEMPLATE.xlsx';

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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

  const resp = await fetch(DEFAULT_TEMPLATE_URL);
  const templateBlob = await resp.blob();

  const project = {
    id: crypto.randomUUID(),
    name: 'PR#439 - Causeway Striping',
    templateBlob,
    templateFileName: 'PR439-Daily-Work-Report-TEMPLATE.xlsx',
    meta: {
      projectNo: '439',
      projectName: 'PAVEMENT MARKING OF BRIDGE DECK AND ROADWAY',
      ntpDate: '2026-05-22',
      representative: 'JOHN SONNIER',
      peName: 'Elizabeth Guiza',
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
  copy.peSignatureImage = await blobFieldToEntry(report.peSignatureImage);
  return copy;
}

function deserializeImportedReport(raw) {
  const report = { ...raw };
  report.photos = (raw.photos || []).map(entryToBlobField);
  report.repSignatureImage = entryToBlobField(raw.repSignatureImage);
  report.peSignatureImage = entryToBlobField(raw.peSignatureImage);
  return report;
}

async function serializeProjectForExport(project) {
  const copy = { ...project };
  copy.templateBlob = await blobFieldToEntry(project.templateBlob);
  return copy;
}

function deserializeImportedProject(raw) {
  const project = { ...raw };
  project.templateBlob = entryToBlobField(raw.templateBlob);
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
  return {
    kind: 'daily-report-app-backup',
    exportedAt: Date.now(),
    projects: serializedProjects,
    reports: serializedReports,
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

  return {
    added,
    updated,
    skipped,
    total: incoming.length,
    projectsAdded,
    projectsUpdated,
    projectsSkipped,
    projectsTotal: incomingProjects.length,
  };
}
