// Syncs a project's reports (data, photos, signatures) out to a folder on
// the device, via the File System Access API -- the closest a browser tab
// can get to a real "keep this folder up to date" sync. Re-running it just
// overwrites files in place, so the folder always reflects the project's
// current state; nothing here watches for changes or runs in the
// background between runs.
//
// Not supported on iOS Safari (no showDirectoryPicker at all) or any other
// browser missing the API -- folderSyncSupported() is what callers check to
// decide whether to offer this at all vs. falling back to a plain zip
// download of the same contents (see buildProjectSyncZip below).
//
// Folder layout written:
//   manifest.json
//   project.json
//   reports/R{no}_{date}/report.json
//   reports/R{no}_{date}/photos/photoN.jpg
//   reports/R{no}_{date}/signature.png   (if signed)

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

function reportFolderName(report) {
  return `R${report.reportNo}_${report.date || 'undated'}`;
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

// Shared by both the real folder sync and the zip fallback so the two never
// drift apart in what they include.
async function collectProjectSyncFiles(project, reports, onProgress) {
  const files = [];
  files.push(['project.json', new Blob([JSON.stringify(await serializeProjectForExport(project))], { type: 'application/json' })]);
  files.push(['manifest.json', new Blob([JSON.stringify({
    formatVersion: 1,
    kind: 'daily-report-app-folder-sync',
    project: project.name,
    syncedAt: Date.now(),
    reportCount: reports.length,
  })], { type: 'application/json' })]);

  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    if (onProgress) onProgress(i, reports.length, report);
    const folder = `reports/${reportFolderName(report)}`;
    files.push([`${folder}/report.json`, new Blob([JSON.stringify(reportPayloadForSync(report))], { type: 'application/json' })]);

    const photos = report.photos || [];
    for (let p = 0; p < photos.length; p++) {
      if (!photos[p]) continue;
      files.push([`${folder}/photos/photo${p + 1}.jpg`, photos[p]]);
    }
    if (report.repSignatureImage) {
      files.push([`${folder}/signature.png`, report.repSignatureImage]);
    }
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
    const level = path.endsWith('.jpg') || path.endsWith('.png') ? 0 : 6; // already-compressed images: store, don't re-deflate
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
