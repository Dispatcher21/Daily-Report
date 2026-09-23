// Syncs a project's reports (data, photos, signatures, and a printable PDF
// of each report) out to a folder on the device, via the File System Access
// API -- the closest a browser tab can get to a real "keep this folder up
// to date" sync. Re-running it just overwrites files in place, so the
// folder always reflects the project's current state; nothing here watches
// for changes or runs in the background between runs.
//
// Not supported on iOS Safari (no showDirectoryPicker at all) or any other
// browser missing the API -- folderSyncSupported() is what callers check to
// decide whether to offer this at all vs. falling back to a plain zip
// download of the same contents (see buildProjectSyncZip below).
//
// Nothing synced here is ever actually deleted from the folder, even once
// its report is deleted or renamed (Report No./date edited) inside the
// app: the old file/folder is renamed with a DELETED_ prefix instead (see
// tagEntryDeleted) and left in place. A folder the user chose to sync to
// is theirs -- the app updates it, but never removes anything from it on
// its own.
//
// Folder layout written:
//   reports/R{no}_{date}.pdf             -- the visual report, one PDF each
//   Quantity_Sheet.xlsx                  -- every pay item, every report on file
//   data/manifest.json
//   data/project.json
//   data/reports/R{no}_{date}/report.json
//   data/reports/R{no}_{date}/photos/photoN.jpg
//   data/reports/R{no}_{date}/signature.png   (if signed)
// The top-level reports/ folder (and the Quantity Sheet beside it) is what
// someone opens to actually look at something; every JSON file (raw/
// machine-readable, nothing to open by hand) is tucked under data/ instead
// of sitting loose next to it.

function folderSyncSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

// syncDirHandleSettingKey/getLinkedSyncFolderName live in storage.js now --
// the global out-of-sync banner (common.js) needs them on every page, not
// just the ones that load this whole file.

// A handle stored in IndexedDB from an earlier sync loses live write
// permission across sessions (the browser re-asks rather than trusting a
// stored grant forever) -- query first since that's silent, and only fall
// back to the (user-gesture-requiring) prompt if it's actually needed.
async function ensureSyncDirPermission(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

async function getOrPickSyncDirectory(projectId) {
  const key = syncDirHandleSettingKey(projectId);
  const stored = await getSetting(key);
  if (stored) {
    try {
      if (await ensureSyncDirPermission(stored)) return stored;
    } catch (err) {
      // Handle no longer valid (folder moved/deleted) -- fall through and pick again.
    }
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await saveSetting(key, handle);
  return handle;
}

async function forgetSyncFolder(projectId) {
  await deleteSetting(syncDirHandleSettingKey(projectId));
  await deleteSetting(folderSyncStateSettingKey(projectId));
}

async function writeFileToDir(dirHandle, path, blob) {
  const parts = path.split('/');
  const filename = parts.pop();
  let dir = dirHandle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

// Zero-padded so a folder full of these sorts the same whether you're
// looking at it alphabetically (Finder/Explorer) or chronologically --
// unpadded ("R10" sorting before "R2") is fine for the single-report .report
// bundle (report-bundle.js), which is never seen sitting in a folder next
// to a hundred others, but here it would be.
function paddedReportNo(report) {
  const n = Number(report.reportNo);
  return Number.isFinite(n) ? String(n).padStart(3, '0') : String(report.reportNo || '0');
}

function reportSyncBaseName(report) {
  return `R${paddedReportNo(report)}_${report.date || 'undated'}`;
}

function reportPayloadForSync(report) {
  const payload = { ...report };
  delete payload.photos;
  delete payload.repSignatureImage;
  delete payload.peSignatureImage;
  delete payload.thumbnail;
  delete payload.thumbnailAt;
  return payload;
}

// A hidden, off-screen render target for html2canvas -- same technique
// download.html uses (see its #render-sandbox), just built on the fly here
// instead of living in the page markup, since project.html has no reason to
// carry it around when nothing's syncing.
function createPdfSandbox() {
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.top = '0';
  el.style.left = '-20000px';
  el.style.zIndex = '-1';
  document.body.appendChild(el);
  return el;
}

async function preparePdfContext() {
  return {
    sandbox: createPdfSandbox(),
    layout: await loadPrintLayout(),
    logoBlob: await getReportLogo(),
  };
}

// Renders one report to a single-report PDF, fetching any not-yet-local
// photo/signature bytes first (same lazy-media story as download.html).
async function buildOneReportPdf(ctx, report) {
  let full = normalizeReport({ ...report, photos: [...(report.photos || [])] });
  if ((full.photosFetched || []).some((f) => !f) || full.signatureFetched === false) {
    full = await fetchReportMedia(full);
  }
  const { blob } = await buildPdfBlob(ctx.sandbox, ctx.layout, [full], ctx.logoBlob, () => {});
  return blob;
}

// buildQuantitySheetWorkbook/ExcelJS/quantity-calc.js are loaded on demand
// for the same reason the PDF libs are -- most pages that can save a report
// have no other reason to carry a spreadsheet engine's weight.
let quantitySheetLibsPromise = null;
function ensureQuantitySheetLibs() {
  if (!quantitySheetLibsPromise) {
    quantitySheetLibsPromise = (async () => {
      if (typeof ExcelJS === 'undefined') await lsLoadScript('lib/exceljs.min.js');
      if (typeof aggregatePayItemTotals !== 'function') await lsLoadScript('quantity-calc.js');
      if (typeof buildQuantitySheetWorkbook !== 'function') await lsLoadScript('quantity-sheet-export.js');
    })();
  }
  return quantitySheetLibsPromise;
}

// Always built from every report on file, not some date range -- "full
// project info", the same way data/project.json is the whole project
// record rather than a snapshot of what anyone happened to have open.
// Returns null (nothing to write) once there's genuinely no pay item
// activity anywhere in the project yet, same as buildQuantitySheetWorkbook
// itself.
async function buildQuantitySheetSyncFile(project, reports) {
  await ensureQuantitySheetLibs();
  const room = await getCompanyRoom();
  const result = await buildQuantitySheetWorkbook(reports, project, room, {
    showZero: false, includeByDay: true, includeDetail: true,
  });
  if (!result) return null;
  const buffer = await result.wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// Shared by both the real folder sync and the zip fallback so the two never
// drift apart in what they include. `includePdfs` is on by default -- off
// only lets a caller skip the (much slower) rasterization step if it's ever
// needed, there's no current UI path that does.
async function collectProjectSyncFiles(project, reports, onProgress, includePdfs = true) {
  const files = [];
  files.push(['data/project.json', new Blob([JSON.stringify(await serializeProjectForExport(project))], { type: 'application/json' })]);
  files.push(['data/manifest.json', new Blob([JSON.stringify({
    formatVersion: 2,
    kind: 'daily-report-app-folder-sync',
    project: project.name,
    syncedAt: Date.now(),
    reportCount: reports.length,
  })], { type: 'application/json' })]);

  const qtyBlob = await buildQuantitySheetSyncFile(project, reports);
  if (qtyBlob) files.push(['Quantity_Sheet.xlsx', qtyBlob]);

  let pdfCtx = null;
  try {
    if (includePdfs && reports.length) pdfCtx = await preparePdfContext();

    for (let i = 0; i < reports.length; i++) {
      const report = reports[i];
      if (onProgress) onProgress(i, reports.length, report);
      const base = reportSyncBaseName(report);
      const dataFolder = `data/reports/${base}`;

      if (pdfCtx) {
        const pdfBlob = await buildOneReportPdf(pdfCtx, report);
        files.push([`reports/${base}.pdf`, pdfBlob]);
      }

      files.push([`${dataFolder}/report.json`, new Blob([JSON.stringify(reportPayloadForSync(report))], { type: 'application/json' })]);

      const photos = report.photos || [];
      for (let p = 0; p < photos.length; p++) {
        if (!photos[p]) continue;
        files.push([`${dataFolder}/photos/photo${p + 1}.jpg`, photos[p]]);
      }
      if (report.repSignatureImage) {
        files.push([`${dataFolder}/signature.png`, report.repSignatureImage]);
      }
    }
  } finally {
    if (pdfCtx) pdfCtx.sandbox.remove();
  }
  return files;
}

// Writes every file straight into the chosen folder, prompting for it (or
// reusing the last one, if still permitted) on the way in.
async function syncProjectToFolder(project, onProgress) {
  const dirHandle = await getOrPickSyncDirectory(project.id);
  return writeProjectToFolder(project, dirHandle, onProgress);
}

// Writes one report's PDF + data/photos/signature straight into the
// folder, fetching any not-yet-local photo/signature bytes first (a report
// pulled from a company without downloading its photo bytes yet would
// otherwise silently sync a report.json with no matching photo files).
// Returns the base filename actually used, so the caller can record it.
async function writeReportFilesToFolder(dirHandle, pdfCtx, report) {
  let full = normalizeReport({ ...report, photos: [...(report.photos || [])] });
  if ((full.photosFetched || []).some((f) => !f) || full.signatureFetched === false) {
    full = await fetchReportMedia(full);
  }
  const base = reportSyncBaseName(full);
  const dataFolder = `data/reports/${base}`;

  const pdfBlob = await buildOneReportPdf(pdfCtx, full);
  await writeFileToDir(dirHandle, `reports/${base}.pdf`, pdfBlob);
  await writeFileToDir(dirHandle, `${dataFolder}/report.json`, new Blob([JSON.stringify(reportPayloadForSync(full))], { type: 'application/json' }));
  const photos = full.photos || [];
  for (let p = 0; p < photos.length; p++) {
    if (photos[p]) await writeFileToDir(dirHandle, `${dataFolder}/photos/photo${p + 1}.jpg`, photos[p]);
  }
  if (full.repSignatureImage) {
    await writeFileToDir(dirHandle, `${dataFolder}/signature.png`, full.repSignatureImage);
  }
  return base;
}

// The actual write, shared by syncProjectToFolder above (prompts for a
// folder if needed -- project.html's own Sync button, a real user gesture)
// and syncCurrentProjectToFolderIfLinked below (never prompts -- ridealong
// on the header refresh button, where popping a folder picker out of
// nowhere on what looks like a plain data refresh would be a bad surprise).
//
// Resumable: a report already recorded as synced (isReportFolderSynced,
// same check reports.html's cloud badges use) is skipped entirely rather
// than rebuilt, and each report's own success is saved to folderSyncState
// the moment it's written -- not once at the very end for the whole batch.
// This app has no way to keep a sync running once its page is navigated
// away from (there's no background-worker equivalent for writing to a
// chosen folder), so the first full sync of a project with a real backlog
// of reports can take a while and there's nothing stopping someone from
// leaving mid-way. Recording progress as it happens means that doesn't
// cost anything: the next sync -- another manual click, or the header
// refresh ridealong -- picks up exactly where the interrupted one left
// off instead of starting the whole project over.
//
// A full resync can run long enough that navigating away mid-way is a real
// possibility (nothing here can keep running once that happens -- see the
// comment above) -- warn before that happens, the same way an unsaved
// report edit already does elsewhere in the app. Deliberately scoped to
// this project-wide sync specifically, not every quick per-report
// auto-sync on save (onLocalFolderSyncReportChanged), which finishes near-
// instantly and would make this fire constantly for no real reason.
let activeProjectFolderSyncCount = 0;
window.addEventListener('beforeunload', (e) => {
  if (activeProjectFolderSyncCount > 0) { e.preventDefault(); e.returnValue = ''; }
});

async function writeProjectToFolder(project, dirHandle, onProgress) {
  activeProjectFolderSyncCount++;
  try {
    const reports = await getReportsForProject(project.id);

    await writeFileToDir(dirHandle, 'data/project.json', new Blob([JSON.stringify(await serializeProjectForExport(project))], { type: 'application/json' }));
    await writeFileToDir(dirHandle, 'data/manifest.json', new Blob([JSON.stringify({
      formatVersion: 2,
      kind: 'daily-report-app-folder-sync',
      project: project.name,
      syncedAt: Date.now(),
      reportCount: reports.length,
    })], { type: 'application/json' }));

    const state = await getFolderSyncState(project.id);
    const pending = reports.filter((r) => !isReportFolderSynced(r, state));
    if (pending.length) {
      // project.html (the only page with a Sync button) already carries
      // html2canvas/jsPDF/render-report.js/pdf-export.js statically, but the
      // header refresh ridealong (syncCurrentProjectToFolderIfLinked, below)
      // can fire this from any page -- most of which don't. Same on-demand
      // load syncSingleReportToFolder already uses for the same reason.
      await ensurePdfSyncLibs();
      const pdfCtx = await preparePdfContext();
      try {
        for (let i = 0; i < pending.length; i++) {
          const report = pending[i];
          if (onProgress) onProgress(i, pending.length, report);
          const base = await writeReportFilesToFolder(dirHandle, pdfCtx, report);
          // Re-read rather than reuse the copy from above -- a per-report
          // auto-sync (onLocalFolderSyncReportChanged) could plausibly write
          // its own entry in between iterations of this loop; last write
          // should never clobber a concurrent one.
          const latestState = await getFolderSyncState(project.id);
          latestState[report.id] = { baseName: base, syncedAt: Date.now() };
          await saveFolderSyncState(project.id, latestState);
        }
      } finally {
        pdfCtx.sandbox.remove();
      }
    }
    if (onProgress) onProgress(pending.length, pending.length, null);

    await refreshQuantitySheetInFolder(dirHandle, project);

    return { mode: 'folder', folderName: dirHandle.name, reportCount: reports.length };
  } finally {
    activeProjectFolderSyncCount--;
  }
}

// Fallback for browsers without the File System Access API (notably iOS
// Safari): same contents, packed as one zip the user saves themselves.
async function buildProjectSyncZip(project, onProgress) {
  const reports = await getReportsForProject(project.id);
  const files = await collectProjectSyncFiles(project, reports, onProgress);
  const zipInput = {};
  for (const [path, blob] of files) {
    // Already-compressed formats (JPEG photos, PNG signatures, PDFs, and
    // .xlsx -- itself a zip archive internally) gain nothing from
    // re-deflating -- level 0 just stores them.
    const level = /\.(jpg|png|pdf|xlsx)$/i.test(path) ? 0 : 6;
    zipInput[path] = [new Uint8Array(await blob.arrayBuffer()), { level }];
  }
  const zipped = fflate.zipSync(zipInput, { level: 6 });
  if (onProgress) onProgress(reports.length, reports.length, null);
  return { blob: new Blob([zipped], { type: 'application/zip' }), reportCount: reports.length };
}

function projectSyncZipFilename(project) {
  const slug = String(project.name || project.meta.projectNo || 'project')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return `${slug || 'project'}_backup.zip`;
}

// ---------- Auto-sync on save/delete ----------
//
// Once a project is linked to a folder (via the manual Sync button on
// project.html), every later saveReport()/deleteReport() call -- from
// report-editor.html, quick-quantity.html, reports.html's mass edit, a
// project-setup.html bulk import, wherever -- mirrors that one report out
// to the folder in the background, the same way onCompanySyncReportChanged
// already mirrors it to the company. storage.js knows nothing about this;
// it just calls onLocalFolderSyncReportChanged if this file happened to be
// loaded on the page (see the `typeof` guard there), same pattern as the
// firebase-sync.js hook.
//
// folderSyncStateSettingKey/getFolderSyncState/isReportFolderSynced live in
// storage.js now (the global out-of-sync banner in common.js needs them
// everywhere, not just the pages that load this whole file) -- doubles as:
// (a) how isReportFolderSynced tells reports.html which reports still need
// a folder update, and (b) how a rename (Report No./date edit) knows the
// OLD filename to delete so a folder sync never leaves a stale duplicate
// behind under the report's previous name.
async function saveFolderSyncState(projectId, state) {
  await saveSetting(folderSyncStateSettingKey(projectId), state);
}

async function removeEntryIfExists(dirHandle, name, opts) {
  try {
    await dirHandle.removeEntry(name, opts);
  } catch (err) {
    // Already gone (never synced under that name, or removed by hand) -- fine.
  }
}

async function copyFileEntry(dirHandle, srcName, destName) {
  const srcHandle = await dirHandle.getFileHandle(srcName);
  const file = await srcHandle.getFile();
  const destHandle = await dirHandle.getFileHandle(destName, { create: true });
  const writable = await destHandle.createWritable();
  await writable.write(file);
  await writable.close();
}

// Recursively copies every file/subdirectory from srcDir into destDir --
// used by tagEntryDeleted below since the File System Access API has no
// reliable cross-browser directory rename/move, only per-file writes.
async function copyDirTree(srcDir, destDir) {
  for await (const handle of srcDir.values()) {
    if (handle.kind === 'file') {
      const file = await handle.getFile();
      const destHandle = await destDir.getFileHandle(handle.name, { create: true });
      const writable = await destHandle.createWritable();
      await writable.write(file);
      await writable.close();
    } else {
      const subDest = await destDir.getDirectoryHandle(handle.name, { create: true });
      await copyDirTree(handle, subDest);
    }
  }
}

// Renames a file or directory to a DELETED_-prefixed name instead of
// removing it -- nothing the app syncs to a chosen folder should ever
// actually disappear from it, even once the report behind it is deleted or
// renamed inside the app. "Rename" here means copy-then-remove-the-
// original rather than a real move, since that's the operation the API
// actually offers; the content is what matters and it's fully preserved
// either way. No-op if `name` was never synced in the first place, or
// already carries the tag (nothing left to do).
async function tagEntryDeleted(dirHandle, name, isDirectory) {
  if (name.startsWith('DELETED_')) return;
  const deletedName = `DELETED_${name}`;
  try {
    if (isDirectory) {
      const srcDir = await dirHandle.getDirectoryHandle(name).catch(() => null);
      if (!srcDir) return;
      // A report renamed more than once tags a new name each time (dates/
      // numbers differ), but clear out any leftover from an earlier tag of
      // this exact same name first so a copy never merges stale content in.
      await removeEntryIfExists(dirHandle, deletedName, { recursive: true });
      const destDir = await dirHandle.getDirectoryHandle(deletedName, { create: true });
      await copyDirTree(srcDir, destDir);
      await dirHandle.removeEntry(name, { recursive: true });
    } else {
      const exists = await dirHandle.getFileHandle(name).catch(() => null);
      if (!exists) return;
      await removeEntryIfExists(dirHandle, deletedName);
      await copyFileEntry(dirHandle, name, deletedName);
      await dirHandle.removeEntry(name);
    }
  } catch (err) {
    console.error('tag deleted:', err); // best-effort -- never blocks the rest of a sync
  }
}

async function tagReportFilesDeleted(dirHandle, baseName) {
  const reportsDir = await dirHandle.getDirectoryHandle('reports', { create: true }).catch(() => null);
  if (reportsDir) await tagEntryDeleted(reportsDir, `${baseName}.pdf`, false);
  const dataDir = await dirHandle.getDirectoryHandle('data', { create: true })
    .then((d) => d.getDirectoryHandle('reports', { create: true }))
    .catch(() => null);
  if (dataDir) await tagEntryDeleted(dataDir, baseName, true);
}

// Rebuilds Quantity_Sheet.xlsx from every report currently on file and
// rewrites it -- called after a single report's own save/delete, since that
// report's pay items may have changed the project-wide totals the sheet
// shows. Tags it deleted instead of rewriting once nothing has any pay
// item activity left (the last pay-item-bearing report on the project was
// just deleted) -- same "never actually remove it" rule as everything else.
async function refreshQuantitySheetInFolder(dirHandle, project) {
  const reports = await getReportsForProject(project.id);
  const blob = await buildQuantitySheetSyncFile(project, reports);
  if (blob) await writeFileToDir(dirHandle, 'Quantity_Sheet.xlsx', blob);
  else await tagEntryDeleted(dirHandle, 'Quantity_Sheet.xlsx', false);
}

// Silent version of getOrPickSyncDirectory -- a background save can't pop a
// folder picker (no user gesture, and it'd be a jarring interruption mid
// typing/save anyway), so this only returns a handle when permission is
// already granted. A null here just means "stays flagged unsynced until the
// next manual Sync," which is what re-establishes permission.
async function getSyncDirectoryIfPermitted(projectId) {
  const stored = await getSetting(syncDirHandleSettingKey(projectId));
  if (!stored) return null;
  try {
    return (await stored.queryPermission({ mode: 'readwrite' })) === 'granted' ? stored : null;
  } catch (err) {
    return null; // handle no longer valid (folder moved/deleted)
  }
}

// Loads html2canvas/jsPDF/the report renderer/pdf-export.js/print-sheet.css
// on demand -- most pages that can save or delete a report (report-editor,
// quick-quantity, reports.html's mass edit, project-setup's import) have no
// other reason to carry this weight, so it's only fetched the moment a
// background sync actually needs to rasterize a PDF. A page that already
// has one of these loaded (project.html) skips reloading it -- checked by
// what it defines, not by what loaded it.
let pdfSyncLibsPromise = null;
function lsLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}
function lsLoadStylesheet(href) {
  if (document.querySelector(`link[href="${href}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.onload = resolve;
    l.onerror = () => reject(new Error('Failed to load ' + href));
    document.head.appendChild(l);
  });
}
// The html2canvas/render-report.js/print-sheet.css trio is shared with
// reports.html's own on-demand thumbnail generator (see its
// ensureThumbnailLibs) -- routed through this one memoized promise so
// whichever caller gets there first is the only one that actually injects
// render-report.js. A second independent loader racing to inject it would
// throw redeclaring its top-level `let`.
let reportRenderLibsPromise = null;
function ensureReportRenderLibs() {
  if (!reportRenderLibsPromise) {
    reportRenderLibsPromise = (async () => {
      await lsLoadStylesheet('print-sheet.css');
      if (typeof html2canvas !== 'function') await lsLoadScript('lib/html2canvas.min.js');
      if (typeof renderReportPages !== 'function') await lsLoadScript('render-report.js');
    })();
  }
  return reportRenderLibsPromise;
}

function ensurePdfSyncLibs() {
  if (!pdfSyncLibsPromise) {
    pdfSyncLibsPromise = (async () => {
      await ensureReportRenderLibs();
      if (typeof window.jspdf === 'undefined') await lsLoadScript('lib/jspdf.umd.min.js');
      if (typeof buildPdfBlob !== 'function') await lsLoadScript('pdf-export.js');
    })();
  }
  return pdfSyncLibsPromise;
}

// Writes just this one report's PDF + data files into the project's linked
// folder, and cleans up the old files first if the report's name changed
// (Report No. or date edited since the last sync). `dirHandle` is resolved
// by the caller (onLocalFolderSyncReportChanged) -- it decides up front
// whether there's actually a permitted folder to write to, which is also
// what tells it whether to show the progress banner at all.
async function syncSingleReportToFolder(project, report, dirHandle) {
  const state = await getFolderSyncState(project.id);
  const prevEntry = state[report.id];

  let full = normalizeReport({ ...report, photos: [...(report.photos || [])] });
  if ((full.photosFetched || []).some((f) => !f) || full.signatureFetched === false) {
    full = await fetchReportMedia(full);
  }
  const base = reportSyncBaseName(full);
  if (prevEntry && prevEntry.baseName && prevEntry.baseName !== base) {
    await tagReportFilesDeleted(dirHandle, prevEntry.baseName);
  }

  await ensurePdfSyncLibs();
  const pdfCtx = await preparePdfContext();
  try {
    const pdfBlob = await buildOneReportPdf(pdfCtx, full);
    await writeFileToDir(dirHandle, `reports/${base}.pdf`, pdfBlob);
  } finally {
    pdfCtx.sandbox.remove();
  }

  const dataFolder = `data/reports/${base}`;
  await writeFileToDir(dirHandle, `${dataFolder}/report.json`, new Blob([JSON.stringify(reportPayloadForSync(full))], { type: 'application/json' }));
  const photos = full.photos || [];
  for (let p = 0; p < photos.length; p++) {
    if (photos[p]) await writeFileToDir(dirHandle, `${dataFolder}/photos/photo${p + 1}.jpg`, photos[p]);
  }
  if (full.repSignatureImage) {
    await writeFileToDir(dirHandle, `${dataFolder}/signature.png`, full.repSignatureImage);
  }

  state[report.id] = { baseName: base, syncedAt: Date.now() };
  await saveFolderSyncState(project.id, state);

  await refreshQuantitySheetInFolder(dirHandle, project);
}

async function tagSingleReportDeleted(project, report, dirHandle) {
  const state = await getFolderSyncState(project.id);
  const entry = state[report.id];
  const base = entry ? entry.baseName : reportSyncBaseName(report);
  await tagReportFilesDeleted(dirHandle, base);
  if (entry) {
    delete state[report.id];
    await saveFolderSyncState(project.id, state);
  }

  await refreshQuantitySheetInFolder(dirHandle, project);
}

// ---------- Progress banner ----------
//
// Same bottom banner (common.js) every other background job in the app
// already uses -- login, company sync, PDF building, a bulk import -- so a
// background folder sync looks and feels like everything else async here
// instead of happening invisibly. storage.js's save/delete call is still
// fire-and-forget, so this never delays the save itself; it just narrates
// the write that's already happening after the fact.
//
// Skips showing anything when the banner is already busy with something
// else (a bulk import's own per-file progressStep, say) rather than
// stealing it mid-sequence -- the sync still happens, just without its own
// narration that turn. pbCurrentStepKey is common.js's own global (a plain
// script, not a module, so it really is one), 'folder-sync' is this file's
// key on it.
let activeFolderSyncCount = 0;
function folderSyncBannerAvailable() {
  if (typeof startProgressBanner !== 'function') return false; // page never loaded common.js's banner (shouldn't happen, but don't assume)
  const el = document.getElementById('global-progress-banner');
  return !el || el.hidden || pbCurrentStepKey === 'folder-sync';
}

// `task` receives an onProgress(done, total) it can call as often as it
// likes -- a single-report sync just never calls it, a full project sync
// (see the header refresh button in theme.js) turns it into a real "X of Y"
// fill instead of an indeterminate shimmer, the same as any other
// multi-item job on this banner.
async function runFolderSyncWithBanner(activeLabel, doneLabel, task) {
  const showBanner = folderSyncBannerAvailable();
  if (showBanner) {
    activeFolderSyncCount++;
    if (activeFolderSyncCount === 1) startProgressBanner();
    progressStep('folder-sync', activeLabel);
  }
  try {
    await task((done, total) => {
      if (showBanner && total) progressStep('folder-sync', activeLabel, `${done} of ${total}`);
    });
  } finally {
    if (showBanner) {
      activeFolderSyncCount = Math.max(0, activeFolderSyncCount - 1);
      if (activeFolderSyncCount === 0) finishProgressBanner(doneLabel);
    }
  }
}

// The hook itself -- see storage.js's saveReport/deleteReport. Bails out
// immediately, before loading anything, for the overwhelming common case of
// a project that was never linked to a folder.
async function onLocalFolderSyncReportChanged(report, deleted) {
  const linked = await getSetting(syncDirHandleSettingKey(report.projectId));
  if (!linked) return;
  const project = await getProject(report.projectId);
  if (!project) return;
  const dirHandle = await getSyncDirectoryIfPermitted(project.id);
  if (!dirHandle) return; // permission lapsed -- stays flagged unsynced (cloud icon) until the next manual Sync

  if (deleted) {
    await runFolderSyncWithBanner('Updating folder', 'Folder updated', () =>
      tagSingleReportDeleted(project, report, dirHandle));
  } else {
    await runFolderSyncWithBanner('Saving to folder', 'Synced to folder', () =>
      syncSingleReportToFolder(project, report, dirHandle));
  }
  // By far the most common path that changes folder sync state -- every
  // ordinary report save/delete on a linked project runs through here.
  // Without this, common.js's global out-of-sync banner never learns this
  // report just caught up, and keeps showing the pre-save pending count
  // until the next full page load.
  window.dispatchEvent(new CustomEvent('folder-sync-completed'));
}

// Used by the header refresh button (theme.js) -- when the page currently
// in view is scoped to a project, a full resync of it rides along with
// the company data pull, so anything that refresh just brought down (a
// teammate's new report, say) makes it out to the linked folder too,
// instead of waiting on this project's next individual save. Silent no-op
// for everything that doesn't apply: no project in view on this page, that
// project was never linked to a folder, or -- same as the per-report
// auto-sync -- permission has lapsed and needs a real click on Sync to
// Folder to renew (never prompts on its own; see writeProjectToFolder's
// comment for why).
async function syncCurrentProjectToFolderIfLinked(projectId) {
  if (!projectId) return;
  const dirHandle = await getSyncDirectoryIfPermitted(projectId);
  if (!dirHandle) return;
  const project = await getProject(projectId);
  if (!project) return;
  await runFolderSyncWithBanner('Syncing to folder', 'Synced to folder', (onProgress) =>
    writeProjectToFolder(project, dirHandle, onProgress));
}
