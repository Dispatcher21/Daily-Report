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

async function saveReport(report) {
  report.updatedAt = Date.now();
  await withStore('readwrite', (store) => store.put(report));
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
