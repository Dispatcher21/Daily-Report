// Thin IndexedDB wrapper for projects and their daily reports (including
// photo/signature blobs) on-device. No library needed.

const DB_NAME = 'daily-report-app';
const DB_VERSION = 6;
const REPORTS_STORE = 'reports';
const PROJECTS_STORE = 'projects';
const SETTINGS_STORE = 'settings';
const AUDIT_STORE = 'auditLog';
const REPORT_DRAFTS_STORE = 'reportDrafts';
const COMPANY_THEMES_STORE = 'companyThemes';
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
      if (!db.objectStoreNames.contains(AUDIT_STORE)) {
        db.createObjectStore(AUDIT_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(REPORT_DRAFTS_STORE)) {
        db.createObjectStore(REPORT_DRAFTS_STORE, { keyPath: 'reportId' });
      }
      if (!db.objectStoreNames.contains(COMPANY_THEMES_STORE)) {
        db.createObjectStore(COMPANY_THEMES_STORE, { keyPath: 'id' });
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
  const before = await getSetting(USER_NAME_SETTING_KEY);
  await saveSetting(USER_NAME_SETTING_KEY, name || '');
  if (typeof logDeviceRenamed === 'function') {
    logDeviceRenamed(before || '', name || '').catch((err) => console.error('audit log:', err));
  }
}

// Favorite-starred projects and the folder layout below are kept per
// person (by name, not by device) -- two people sharing a login see their
// own favorites, and switching companies doesn't touch this list. Synced
// to the company when a name is set (see onCompanySyncUserLayoutChanged in
// firebase-sync.js) specifically so this follows that person to a
// different phone/tablet instead of needing to be rebuilt from scratch
// there; a device with no name set stays local-only (there's no identity
// to sync it under).
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
  syncUserLayout(userName);
  return ids;
}

// The home screen's project grid order, and which projects are grouped
// into which folders (index.html is the only reader/writer of this).
// `null` means "never customized" -- index.html falls back to its
// original favorites-first flat order in that case; once someone drags
// anything, a real layout array gets saved and takes over ordering
// completely. Shape: an array of `{type:'project', id}` or `{type:'folder',
// id, name, projectIds:[id,...]}` entries, in display order.
function projectLayoutSettingKey(userName) {
  return `projectLayout:${userName || '_anon'}`;
}

async function getProjectLayout() {
  const userName = await getUserName();
  const v = await getSetting(projectLayoutSettingKey(userName));
  return v || null;
}

async function saveProjectLayout(layout) {
  const userName = await getUserName();
  await saveSetting(projectLayoutSettingKey(userName), layout);
  syncUserLayout(userName);
}

// Local marker of when this person's favorites/layout last changed on
// THIS device -- compared against the company's copy on pull (see
// pullUserLayout in firebase-sync.js) so an older copy synced from
// elsewhere never clobbers a newer local edit, and vice versa.
function userLayoutUpdatedAtSettingKey(userName) {
  return `userLayoutUpdatedAt:${userName || '_anon'}`;
}

// onCompanySyncUserLayoutChanged is an optional hook into firebase-sync.js,
// same pattern as onCompanySyncReportChanged -- a no-op if that file isn't
// loaded or no company is joined. Fired without awaiting: nobody should
// wait on a network push just to star a project or drop a folder.
function syncUserLayout(userName) {
  if (!userName) return; // nothing to key a synced copy under
  saveSetting(userLayoutUpdatedAtSettingKey(userName), Date.now()).then(() => {
    if (typeof onCompanySyncUserLayoutChanged === 'function') {
      onCompanySyncUserLayoutChanged(userName).catch((err) => console.error('user layout sync:', err));
    }
  });
}

// Shows the company logo in the header bar -- in the installed app and in
// a plain browser tab alike, since this is used as a regular website too,
// not just installed.
async function applyHeaderLogo() {
  try {
    const header = document.querySelector('.app-header');
    if (!header) return;

    const logo = await getReportLogo();

    let link = header.querySelector('.header-logo-link');
    let img = link ? link.querySelector('.header-logo') : null;
    if (!logo) {
      if (link) {
        if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
        link.remove();
      }
      return;
    }

    if (!link) {
      link = document.createElement('a');
      link.className = 'header-logo-link';
      link.href = 'index.html';
      img = document.createElement('img');
      img.className = 'header-logo';
      img.alt = '';
      link.appendChild(img);
      // After the hamburger button when one's present (it's meant to be the
      // leftmost thing in the header), otherwise at the very front -- same
      // as before this button existed.
      const hamburgerBtn = header.querySelector('#hamburger-btn');
      if (hamburgerBtn) hamburgerBtn.after(link);
      else header.insertBefore(link, header.firstChild);
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

// Removes a report from local storage only -- no audit entry, no
// onCompanySyncReportChanged push-back. Used when firebase-sync.js's delta
// pull learns (via a deletion tombstone) that another device already
// deleted this report on the company's behalf: the deletion already
// happened and already has its own audit entry, synced separately through
// the audit log pull -- re-running deleteReport's normal path here would
// just re-delete an already-gone remote doc and write a second, redundant
// audit entry for the same event.
async function deleteReportLocalOnly(id) {
  await withStore(REPORTS_STORE, 'readwrite', (store) => store.delete(id));
  await deleteReportDraft(id);
}

// onCompanySyncReportChanged is an optional hook into firebase-sync.js --
// storage.js has no idea that file exists. It's a plain global checked by
// name so pages that don't include firebase-sync.js work exactly as before,
// and so this file never needs to import anything sync-related itself.
// Fired without awaiting: a company push shouldn't make the caller wait for
// a save that's already durable in IndexedDB by this point.
async function saveReport(report) {
  // Needed before the write for the audit hook to diff against -- a no-op
  // extra read when nothing's listening (logAuditableChange undefined).
  const before = typeof logAuditableChange === 'function' ? await getReport(report.id, { includeDeleted: true }) : null;
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
  if (typeof onLocalFolderSyncReportChanged === 'function') {
    onLocalFolderSyncReportChanged(report, false).catch((err) => console.error('local folder sync:', err));
  }
  if (typeof logAuditableChange === 'function') {
    logAuditableChange('report', before, report, false).catch((err) => console.error('audit log:', err));
  }
}

// Soft-deletes a report -- moves it to Trash rather than removing it. There
// is deliberately no way to remove a report's data for good from anywhere
// in this app -- see restoreReport below for undoing this, and the
// PERMANENT DELETION header comment further down for why that
// capability was removed outright rather than merely hidden behind a
// button. The record stays right here locally and gets pushed to the
// company as an ordinary field update (deleted/deletedAt/deletedBy
// alongside everything else, via the normal onCompanySyncReportChanged
// path) so every device that syncs ends up with the same trashed record in
// its own Trash, not just whichever device clicked Delete.
//
// Fire-and-forget sync, like saveReport -- safe because the bumped
// updatedAt is itself the protection: an autoPullCompanyData that lands
// with the still-active, pre-delete copy is simply older by
// mergeReportRecord's "newer wins" rule and gets skipped, deleted flag and
// all, rather than resurrecting it.
async function deleteReport(id) {
  const report = await getReport(id, { includeDeleted: true });
  if (!report || report.deleted) return;
  const userName = (await getUserName()) || 'Unknown User';
  const deletedReport = { ...report, deleted: true, deletedAt: Date.now(), deletedBy: userName, updatedAt: Date.now() };
  await putReportRaw(deletedReport);
  await deleteReportDraft(id);
  if (typeof onCompanySyncReportChanged === 'function') {
    onCompanySyncReportChanged(deletedReport, false).catch((err) => console.error('company sync mirror:', err));
  }
  if (typeof onLocalFolderSyncReportChanged === 'function') {
    onLocalFolderSyncReportChanged(deletedReport, true).catch((err) => console.error('local folder sync:', err));
  }
  if (typeof logAuditableChange === 'function') {
    logAuditableChange('report', report, deletedReport, 'deleted').catch((err) => console.error('audit log:', err));
  }
}

// Undoes deleteReport -- clears the Trash flags and pushes the restored
// record like any other save. Same fire-and-forget reasoning as
// deleteReport: the freshly bumped updatedAt protects a restore from a
// stale pull the same way it protects a fresh delete.
async function restoreReport(id) {
  const report = await getReport(id, { includeDeleted: true });
  if (!report || !report.deleted) return;
  const restored = { ...report, updatedAt: Date.now() };
  delete restored.deleted;
  delete restored.deletedAt;
  delete restored.deletedBy;
  await putReportRaw(restored);
  if (typeof onCompanySyncReportChanged === 'function') {
    onCompanySyncReportChanged(restored, false).catch((err) => console.error('company sync mirror:', err));
  }
  if (typeof onLocalFolderSyncReportChanged === 'function') {
    onLocalFolderSyncReportChanged(restored, false).catch((err) => console.error('local folder sync:', err));
  }
  if (typeof logAuditableChange === 'function') {
    logAuditableChange('report', report, restored, 'restored').catch((err) => console.error('audit log:', err));
  }
}

// ---------- PERMANENT DELETION: REMOVED ON PURPOSE ----------
//
// This app used to have a permanentlyDeleteReport() -- a genuine hard
// delete (Firestore doc + Storage photos removed, tombstoned so every
// other device's pull wipes its own copy too) reachable from a "Delete
// Forever" button in the Trash view. It was removed entirely, not just
// unhooked from the UI, after it was used to permanently destroy two real
// reports by mistake during testing: a test session that was still joined
// to a real company called it against real data instead of the isolated
// test environment. The tombstone meant there was no way to get the data
// back afterward -- only a separate, unrelated local-folder-sync backup
// (which never deletes anything, by a different and much luckier design
// choice) made recovery possible at all.
// If a genuine "permanently erase this data" capability is ever needed
// again (a legal/retention requirement, say), it needs deliberate
// safeguards a plain function call doesn't have on its own -- at minimum,
// nothing should be able to reach it from a test/dev environment pointed
// at real company data. Don't just re-add a function with this name and a
// button; that's exactly how this happened the first time.

// ---------- Report drafts ----------
//
// report-editor.html's in-progress edits land here, not in the reports
// store itself -- keeps "the committed report" and "what's currently on
// screen, unsaved" separate, so Discard is just deleting the draft (the
// committed report underneath was never touched), and index.html can list
// "still has unsaved work" reports without disturbing the real record.
// Never synced to the company by design -- an in-progress edit on one
// device has no business showing up, half-finished, on another.

async function saveReportDraft(report) {
  await withStore(REPORT_DRAFTS_STORE, 'readwrite', (store) => store.put({
    reportId: report.id,
    projectId: report.projectId,
    updatedAt: Date.now(),
    data: report,
  }));
}

async function getReportDraft(reportId) {
  return withStore(REPORT_DRAFTS_STORE, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(reportId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  });
}

async function deleteReportDraft(reportId) {
  await withStore(REPORT_DRAFTS_STORE, 'readwrite', (store) => store.delete(reportId));
}

function getAllReportDrafts() {
  return withStore(REPORT_DRAFTS_STORE, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.updatedAt - a.updatedAt));
      req.onerror = () => reject(req.error);
    });
  });
}

// includeDeleted defaults to false so every existing caller -- dashboards,
// quantity math, exports, search, folder sync -- automatically only sees
// active reports with no change on their part; a trashed report (see
// deleteReport) is opt-in only, via the Deleted Reports view and the sync
// bookkeeping that needs to see it too (merge comparisons, tombstone
// checks, the "Sync Now" retry sweep) -- see firebase-sync.js's callers.
function getAllReports({ includeDeleted = false } = {}) {
  return withStore(REPORTS_STORE, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const result = includeDeleted ? req.result : req.result.filter((r) => !r.deleted);
        resolve(result.sort((a, b) => b.updatedAt - a.updatedAt));
      };
      req.onerror = () => reject(req.error);
    });
  });
}

async function getReportsForProject(projectId, opts) {
  const all = await getAllReports(opts);
  return all.filter((r) => r.projectId === projectId);
}

async function getReport(id, opts) {
  const all = await getAllReports(opts);
  return all.find((r) => r.id === id) || null;
}

async function getDeletedReportsForProject(projectId) {
  return (await getReportsForProject(projectId, { includeDeleted: true })).filter((r) => r.deleted);
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

// Same idea as deleteReportLocalOnly above, for projects.
async function deleteProjectLocalOnly(id) {
  await withStore(PROJECTS_STORE, 'readwrite', (store) => store.delete(id));
}

async function saveProject(project) {
  const before = typeof logAuditableChange === 'function' ? await getProject(project.id) : null;
  project.updatedAt = Date.now();
  await putProjectRaw(project);
  if (typeof onCompanySyncProjectChanged === 'function') {
    onCompanySyncProjectChanged(project, false).catch((err) => console.error('company sync mirror:', err));
  }
  if (typeof logAuditableChange === 'function') {
    logAuditableChange('project', before, project, false).catch((err) => console.error('audit log:', err));
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

// Deletes a project (a real, permanent removal -- there is no project
// Trash) and soft-deletes every report that belongs to it into Trash, same
// as deleteReport does one at a time -- see the PERMANENT DELETION comment
// above for why a report's own data is never actually destroyed by
// anything in this app, including this. Those reports end up "orphaned"
// (a projectId pointing at a project that no longer exists) rather than
// restorable through this project's own Trash view once it's gone, but
// their data still exists locally and in the company either way.
// deleteReport is fire-and-forget on its own sync (see its own comment),
// so there's nothing to catch per report here; only the project's own
// removal below still awaits its sync and can throw.
async function deleteProject(id) {
  const needsExisting = typeof onCompanySyncProjectChanged === 'function' || typeof logAuditableChange === 'function';
  const project = needsExisting ? await getProject(id) : null;
  const reports = await getReportsForProject(id, { includeDeleted: true });
  for (const r of reports) await deleteReport(r.id);
  const syncErrors = [];
  await withStore(PROJECTS_STORE, 'readwrite', (store) => store.delete(id));
  if (project) {
    if (typeof logAuditableChange === 'function') {
      logAuditableChange('project', project, null, true).catch((err) => console.error('audit log:', err));
    }
    if (typeof onCompanySyncProjectChanged === 'function') {
      try {
        await onCompanySyncProjectChanged(project, true);
      } catch (err) {
        console.error('company sync mirror:', err);
        syncErrors.push(err);
      }
    }
  }
  if (syncErrors.length) {
    throw new Error(`Deleted locally, but ${syncErrors.length} item(s) didn't sync -- they may come back on next sync: ${syncErrors[0].message}`);
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
// `existingReport`, if given (even explicitly null), is used as-is instead
// of looking it up here -- getReport is a full store.getAll() under the
// hood, so calling it once per record for a whole collection pull turns an
// O(n) sync into an O(n^2) one. A caller merging a single record on its own
// (there's currently none, but the fallback exists for that case) can just
// omit it and pay for the lookup itself.
async function mergeReportRecord(report, existingReport) {
  const existing = existingReport !== undefined ? existingReport : await getReport(report.id, { includeDeleted: true });
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

async function mergeProjectRecord(project, existingProject) {
  const existing = existingProject !== undefined ? existingProject : await getProject(project.id);
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

// ---------- Audit log ----------
//
// Append-only: an entry is written once (by logAuditableChange, see
// audit-log.js) and never edited or deleted afterward -- that's what makes
// it worth trusting as a record. mergeAuditEntry (used when pulling a
// company's log from the cloud) reflects that: an id already on file locally
// is left completely alone rather than checked for changes, since there
// never should be any.
async function saveAuditEntry(entry) {
  await withStore(AUDIT_STORE, 'readwrite', (store) => store.put(entry));
}

async function getAuditEntry(id) {
  return withStore(AUDIT_STORE, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  });
}

function getAllAuditEntries() {
  return withStore(AUDIT_STORE, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));
      req.onerror = () => reject(req.error);
    });
  });
}

async function mergeAuditEntry(entry) {
  const existing = await getAuditEntry(entry.id);
  if (existing) return 'skipped';
  await saveAuditEntry(entry);
  return 'added';
}

// ---------- Company themes ----------
//
// Small, admin-curated list (name + accent color + background + decal
// settings), cached locally so a member's Settings page and index.html can
// read it without a network round trip. Background/decal image bytes are
// lazy-fetched (see firebase-sync.js's fetchThemeAsset) exactly like
// project background photos -- only downloaded once a device actually
// needs to render that specific theme, not on every pull.
function getAllCompanyThemes() {
  return withStore(COMPANY_THEMES_STORE, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      // IndexedDB's getAll() order follows the key (id, a random UUID), not
      // creation order -- sort by createdAt so the builder's list and the
      // picker's gallery show themes in the order the admin actually made
      // them, same reasoning as reports/projects sorting by updatedAt.
      req.onsuccess = () => resolve(req.result.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
      req.onerror = () => reject(req.error);
    });
  });
}

async function getCompanyTheme(id) {
  return withStore(COMPANY_THEMES_STORE, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  });
}

async function putCompanyThemeRaw(theme) {
  await withStore(COMPANY_THEMES_STORE, 'readwrite', (store) => store.put(theme));
}

// Replaces the entire local theme list in one go -- the list is small and
// wholly admin-owned, so unlike projects/reports there's no per-record
// merge-by-updatedAt to do: whatever the company doc says right now IS the
// list, full stop. Existing image blobs are carried forward for any theme
// id that survives the replace, same "don't lose what's already local"
// idea as a project's background image during a normal pull.
async function replaceAllCompanyThemes(themes) {
  const existingById = new Map((await getAllCompanyThemes()).map((t) => [t.id, t]));
  // clear() then a run of put()s in the same synchronous pass -- valid IDB
  // usage; requests queued against one transaction execute in the order
  // they were made, no need to wait for clear()'s own onsuccess first.
  await withStore(COMPANY_THEMES_STORE, 'readwrite', (store) => {
    store.clear();
    for (const theme of themes) {
      const existing = existingById.get(theme.id);
      const merged = { ...theme };
      // Three cases, in order: no image at all; the incoming record ALREADY
      // carries its own blob (saveCompanyThemes just uploaded it -- that's
      // the admin's own device adopting what it just pushed, and must win
      // over anything stale sitting in the old cache); otherwise fall back
      // to whatever this device already had (the normal pull case, where
      // incoming is metadata-only from Firestore).
      if (!theme.hasBackgroundImage) {
        merged.backgroundImage = null;
        merged.backgroundImageFetched = true;
      } else if (theme.backgroundImageFetched && theme.backgroundImage) {
        merged.backgroundImage = theme.backgroundImage;
        merged.backgroundImageFetched = true;
      } else if (existing && existing.backgroundImageFetched && existing.backgroundImage) {
        merged.backgroundImage = existing.backgroundImage;
        merged.backgroundImageFetched = true;
      } else {
        merged.backgroundImage = null;
        merged.backgroundImageFetched = false;
      }
      if (!theme.hasDecalImage) {
        merged.decalImage = null;
        merged.decalImageFetched = true;
      } else if (theme.decalImageFetched && theme.decalImage) {
        merged.decalImage = theme.decalImage;
        merged.decalImageFetched = true;
      } else if (existing && existing.decalImageFetched && existing.decalImage) {
        merged.decalImage = existing.decalImage;
        merged.decalImageFetched = true;
      } else {
        merged.decalImage = null;
        merged.decalImageFetched = false;
      }
      store.put(merged);
    }
  });
}

// Records a lazily-fetched background/decal image blob against an
// already-cached theme -- see firebase-sync.js's fetchThemeAsset. A no-op
// if the theme's since been deleted out from under it (admin removed it
// while a fetch was in flight).
async function saveThemeImageBlob(themeId, kind, blob) {
  const theme = await getCompanyTheme(themeId);
  if (!theme) return;
  if (kind === 'background') {
    theme.backgroundImage = blob;
    theme.backgroundImageFetched = true;
  } else {
    theme.decalImage = blob;
    theme.decalImageFetched = true;
  }
  await putCompanyThemeRaw(theme);
}
