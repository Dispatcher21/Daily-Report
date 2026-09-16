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
// Folder layout written:
//   manifest.json
//   reports/R{no}_{date}.pdf             -- the visual report, one PDF each
//   data/project.json
//   data/reports/R{no}_{date}/report.json
//   data/reports/R{no}_{date}/photos/photoN.jpg
//   data/reports/R{no}_{date}/signature.png   (if signed)
// The top-level reports/ folder is what someone opens to actually look at a
// report; everything raw/machine-readable is tucked under data/ instead of
// sitting alongside it.

function folderSyncSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function syncDirHandleSettingKey(projectId) {
  return `syncDirHandle:${projectId}`;
}

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

// Lets the UI show which folder a project is already linked to (name only
// -- there's no way to get a full path back out of the API) without forcing
// a picker prompt just to check.
async function getLinkedSyncFolderName(projectId) {
  const stored = await getSetting(syncDirHandleSettingKey(projectId));
  return stored ? stored.name : null;
}

async function forgetSyncFolder(projectId) {
  await deleteSetting(syncDirHandleSettingKey(projectId));
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

// Shared by both the real folder sync and the zip fallback so the two never
// drift apart in what they include. `includePdfs` is on by default -- off
// only lets a caller skip the (much slower) rasterization step if it's ever
// needed, there's no current UI path that does.
async function collectProjectSyncFiles(project, reports, onProgress, includePdfs = true) {
  const files = [];
  files.push(['data/project.json', new Blob([JSON.stringify(await serializeProjectForExport(project))], { type: 'application/json' })]);
  files.push(['manifest.json', new Blob([JSON.stringify({
    formatVersion: 2,
    kind: 'daily-report-app-folder-sync',
    project: project.name,
    syncedAt: Date.now(),
    reportCount: reports.length,
  })], { type: 'application/json' })]);

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
  const reports = await getReportsForProject(project.id);
  const dirHandle = await getOrPickSyncDirectory(project.id);
  const files = await collectProjectSyncFiles(project, reports, onProgress);
  for (const [path, blob] of files) {
    await writeFileToDir(dirHandle, path, blob);
  }
  if (onProgress) onProgress(reports.length, reports.length, null);
  return { mode: 'folder', folderName: dirHandle.name, reportCount: reports.length };
}

// Fallback for browsers without the File System Access API (notably iOS
// Safari): same contents, packed as one zip the user saves themselves.
async function buildProjectSyncZip(project, onProgress) {
  const reports = await getReportsForProject(project.id);
  const files = await collectProjectSyncFiles(project, reports, onProgress);
  const zipInput = {};
  for (const [path, blob] of files) {
    // Already-compressed formats (JPEG photos, PNG signatures, PDFs) gain
    // nothing from re-deflating -- level 0 just stores them.
    const level = /\.(jpg|png|pdf)$/i.test(path) ? 0 : 6;
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
