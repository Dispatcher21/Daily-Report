// Thin IndexedDB wrapper for saving daily reports (including photo/signature
// blobs) on-device. No library needed -- reports are small in number and the
// API surface we need is tiny.

const DB_NAME = 'daily-report-app';
const DB_VERSION = 1;
const STORE = 'reports';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

async function putReportRaw(report) {
  await withStore('readwrite', (store) => store.put(report));
}

async function saveReport(report) {
  report.updatedAt = Date.now();
  await putReportRaw(report);
}

async function deleteReport(id) {
  await withStore('readwrite', (store) => store.delete(id));
}

function getAllReports() {
  // withStore resolves with whatever fn(store) returns; returning a promise
  // here is fine since a promise resolved with a promise adopts its state.
  return withStore('readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.updatedAt - a.updatedAt));
      req.onerror = () => reject(req.error);
    });
  });
}

async function getNextReportNo() {
  const reports = await getAllReports();
  const max = reports.reduce((m, r) => Math.max(m, Number(r.reportNo) || 0), 0);
  return max + 1;
}

// ---------- Backup / restore (manual export-import, no server involved) ----------
//
// Reports are stored with Blob fields (photos, signatures), which aren't
// JSON-safe. Export converts each Blob to base64 text (+ its mime type so it
// can be reconstructed exactly); import reverses that. The resulting JSON
// file is fully self-contained -- moving it between devices is entirely up
// to the user (email, OneDrive, USB, whatever), the app never transmits it
// anywhere itself.

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

async function exportAllReportsBackup() {
  const reports = await getAllReports();
  const serialized = [];
  for (const r of reports) {
    serialized.push(await serializeReportForExport(r));
  }
  return {
    kind: 'daily-report-app-backup',
    exportedAt: Date.now(),
    reports: serialized,
  };
}

// Merges a previously-exported backup into local storage. Per report id:
// newer `updatedAt` wins, reports only in the backup get added, reports
// only present locally are left untouched (import never deletes anything).
async function importReportsBackup(backup) {
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

  return { added, updated, skipped, total: incoming.length };
}
