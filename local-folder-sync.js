// Local Save Folder: mirrors this app's projects and reports as plain files
// -- JSON plus real photo/signature files, nothing zipped or compressed --
// into a folder the user picks on their own device. Point it at a folder
// already synced by OneDrive, Dropbox, etc. and that provider's own desktop
// client carries the data to other devices; this file has no network code
// and no idea any of that is happening.
//
// Deliberately NOT one archive for the whole dataset: rewriting/recompressing
// everything (including every photo) on every autosaved keystroke would only
// get slower as the data grows, and a write interrupted partway through would
// corrupt the whole thing. One small file per record means each save only
// touches the one file that changed.
//
// Requires the File System Access API (showDirectoryPicker) -- Chrome/Edge,
// desktop and Android, not Safari or Firefox. Every exported function here
// assumes the caller already feature-detected via localFolderSupported().
//
// Folder layout:
//   <root>/daily-report-app-folder.json      -- format marker
//   <root>/<Project Folder Name>/project.json
//   <root>/<Project Folder Name>/reports/R<no>_<date>.json
//   <root>/<Project Folder Name>/reports/R<no>_<date>_photo1.jpg .. _photo6.jpg
//   <root>/<Project Folder Name>/reports/R<no>_<date>_signature.png
//
// A project's folder name is decided once (from its display name at the
// time) and remembered in a settings-backed id->name map -- see
// getProjectFolderName -- so renaming a project later doesn't orphan
// whatever's already on disk under the old name.

const LOCAL_FOLDER_HANDLE_KEY = 'localFolderHandle';
const LOCAL_FOLDER_AUTOSYNC_KEY = 'localFolderAutoSync';
const LOCAL_FOLDER_DIR_NAMES_KEY = 'localFolderProjectDirNames';
const LOCAL_FOLDER_MANIFEST_NAME = 'daily-report-app-folder.json';
const LOCAL_FOLDER_PHOTO_SLOTS = 6;

function localFolderSupported() {
  return 'showDirectoryPicker' in window;
}

async function getLocalFolderHandle() {
  return getSetting(LOCAL_FOLDER_HANDLE_KEY);
}
async function forgetLocalFolder() {
  await deleteSetting(LOCAL_FOLDER_HANDLE_KEY);
  await deleteSetting(LOCAL_FOLDER_DIR_NAMES_KEY);
}
async function getLocalFolderAutoSync() {
  const v = await getSetting(LOCAL_FOLDER_AUTOSYNC_KEY);
  return v == null ? true : v; // on by default once a folder is chosen
}
async function setLocalFolderAutoSync(on) {
  await saveSetting(LOCAL_FOLDER_AUTOSYNC_KEY, !!on);
}

// 'granted' | 'prompt' | 'denied'. Chromium remembers a granted permission
// across sessions for a handle stored via IndexedDB, but not forever --
// this is how the caller notices it's lapsed and needs `requestLocalFolderPermission`.
async function checkLocalFolderPermission(handle) {
  return handle.queryPermission({ mode: 'readwrite' });
}
// Must be called synchronously from a real click handler -- the browser
// silently refuses this from inside an await chain with no user gesture.
async function requestLocalFolderPermission(handle) {
  return handle.requestPermission({ mode: 'readwrite' });
}

async function pickLocalFolder() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await saveSetting(LOCAL_FOLDER_HANDLE_KEY, handle);
  await writeFile(handle, LOCAL_FOLDER_MANIFEST_NAME, JSON.stringify({ kind: 'daily-report-app-local-folder', formatVersion: 1 }));
  return handle;
}

// ---------- low-level file helpers ----------

async function writeFile(dirHandle, name, data) {
  const fh = await dirHandle.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}
async function removeFileIfExists(dirHandle, name) {
  try {
    await dirHandle.removeEntry(name);
  } catch (err) {
    // Wasn't there -- nothing to remove, not an error.
  }
}
async function readFileIfExists(dirHandle, name) {
  try {
    const fh = await dirHandle.getFileHandle(name);
    return await fh.getFile();
  } catch (err) {
    return null;
  }
}

// ---------- project folder naming ----------

function slugifyFolderName(text) {
  return String(text || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

async function getProjectFolderName(project) {
  const map = (await getSetting(LOCAL_FOLDER_DIR_NAMES_KEY)) || {};
  if (map[project.id]) return map[project.id];

  const base = slugifyFolderName(project.name || (project.meta || {}).projectNo || project.id) || 'Project';
  const used = new Set(Object.values(map));
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base} (${n++})`;

  map[project.id] = name;
  await saveSetting(LOCAL_FOLDER_DIR_NAMES_KEY, map);
  return name;
}

async function getProjectFolderHandle(rootHandle, project, { create } = {}) {
  const name = await getProjectFolderName(project);
  return rootHandle.getDirectoryHandle(name, { create: !!create });
}
async function getReportsFolderHandle(projectHandle, { create } = {}) {
  return projectHandle.getDirectoryHandle('reports', { create: !!create });
}

// ---------- report file naming ----------

function reportFileBaseName(report) {
  return `R${report.reportNo}_${report.date || 'undated'}`;
}
function reportJsonName(report) {
  return `${reportFileBaseName(report)}.json`;
}
function reportPhotoName(report, i) {
  return `${reportFileBaseName(report)}_photo${i + 1}.jpg`;
}
function reportSignatureName(report) {
  return `${reportFileBaseName(report)}_signature.png`;
}

// ---------- writing ----------

async function mirrorProjectToFolder(rootHandle, project) {
  const projectHandle = await getProjectFolderHandle(rootHandle, project, { create: true });
  const payload = await serializeProjectForExport(project);
  await writeFile(projectHandle, 'project.json', JSON.stringify(payload));
}

async function mirrorReportToFolder(rootHandle, project, report) {
  const projectHandle = await getProjectFolderHandle(rootHandle, project, { create: true });
  const reportsHandle = await getReportsFolderHandle(projectHandle, { create: true });

  const payload = { ...report };
  delete payload.photos;
  delete payload.repSignatureImage;
  delete payload.peSignatureImage; // retired field, never round-tripped
  await writeFile(reportsHandle, reportJsonName(report), JSON.stringify(payload));

  const photos = report.photos || [];
  for (let i = 0; i < LOCAL_FOLDER_PHOTO_SLOTS; i++) {
    const name = reportPhotoName(report, i);
    if (photos[i]) await writeFile(reportsHandle, name, photos[i]);
    else await removeFileIfExists(reportsHandle, name);
  }

  const sigName = reportSignatureName(report);
  if (report.repSignatureImage) await writeFile(reportsHandle, sigName, report.repSignatureImage);
  else await removeFileIfExists(reportsHandle, sigName);
}

async function removeReportFromFolder(rootHandle, project, report) {
  try {
    const projectHandle = await getProjectFolderHandle(rootHandle, project);
    const reportsHandle = await getReportsFolderHandle(projectHandle);
    await removeFileIfExists(reportsHandle, reportJsonName(report));
    for (let i = 0; i < LOCAL_FOLDER_PHOTO_SLOTS; i++) await removeFileIfExists(reportsHandle, reportPhotoName(report, i));
    await removeFileIfExists(reportsHandle, reportSignatureName(report));
  } catch (err) {
    // Project folder was never created on disk -- nothing to remove.
  }
}

async function removeProjectFromFolder(rootHandle, project) {
  const name = await getProjectFolderName(project);
  try {
    await rootHandle.removeEntry(name, { recursive: true });
  } catch (err) {
    // Wasn't there -- nothing to remove.
  }
}

// ---------- reading ----------

// A File handed back by getFile() stays tied to the entry it came from --
// if that file is later moved or removed from outside this app (someone
// reorganizing the synced folder, a conflict-resolution rename by whatever
// syncs it), a File stored away from an earlier pull can fail to read on a
// later mirror write. Reading its bytes into a plain Blob now, once, means
// what gets stored in IndexedDB no longer depends on that entry existing.
async function readStableBlob(dirHandle, name) {
  const file = await readFileIfExists(dirHandle, name);
  if (!file) return null;
  return new Blob([await file.arrayBuffer()], { type: file.type });
}

async function readReportFromFolder(reportsHandle, jsonFile) {
  const report = JSON.parse(await jsonFile.text());

  report.photos = [];
  for (let i = 0; i < LOCAL_FOLDER_PHOTO_SLOTS; i++) {
    report.photos.push(await readStableBlob(reportsHandle, reportPhotoName(report, i)));
  }
  report.repSignatureImage = await readStableBlob(reportsHandle, reportSignatureName(report));
  delete report.peSignatureImage;
  return report;
}

// Pulls everything found in the folder into local storage (merge only --
// same newer-updatedAt-wins rule as the JSON backup import, never deletes
// anything locally), then pushes every local project/report out to the
// folder. Pull always runs before push so a stale local copy can't
// overwrite a newer one that was sitting in the folder from another device.
async function syncLocalFolderNow(rootHandle, onProgress) {
  const summary = { pulled: 0, projectsPulled: 0, pushed: 0, errors: [] };

  for await (const [, entryHandle] of rootHandle.entries()) {
    if (entryHandle.kind !== 'directory') continue;

    const projectFile = await readFileIfExists(entryHandle, 'project.json');
    if (!projectFile) continue; // not one of our project folders

    try {
      const project = deserializeImportedProject(JSON.parse(await projectFile.text()));
      const projectResult = await mergeProjectRecord(project);
      if (projectResult !== 'skipped') summary.projectsPulled++;
      if (onProgress) onProgress({ phase: 'pull', folder: entryHandle.name });

      let reportsHandle;
      try {
        reportsHandle = await entryHandle.getDirectoryHandle('reports');
      } catch (err) {
        continue; // project folder with no reports yet
      }
      for await (const [name, fileHandle] of reportsHandle.entries()) {
        if (fileHandle.kind !== 'file' || !name.endsWith('.json')) continue;
        try {
          const report = await readReportFromFolder(reportsHandle, await fileHandle.getFile());
          const result = await mergeReportRecord(report);
          if (result !== 'skipped') summary.pulled++;
        } catch (err) {
          summary.errors.push(`${entryHandle.name}/${name}: ${err.message}`);
        }
      }
    } catch (err) {
      summary.errors.push(`${entryHandle.name}: ${err.message}`);
    }
  }

  const projects = await getAllProjects();
  for (const project of projects) {
    try {
      await mirrorProjectToFolder(rootHandle, project);
      const reports = await getReportsForProject(project.id);
      for (const report of reports) {
        await mirrorReportToFolder(rootHandle, project, report);
        summary.pushed++;
      }
    } catch (err) {
      summary.errors.push(`${project.name}: ${err.message}`);
    }
    if (onProgress) onProgress({ phase: 'push', project });
  }

  return summary;
}

// ---------- live hooks -- called from storage.js after every save/delete ----------
//
// Deletions always mirror immediately, regardless of the auto-sync setting:
// they're rare, deliberate single actions, not the rapid-fire autosave
// writes that setting exists to avoid. Only ordinary saves respect it.

async function onLocalFolderReportChanged(report, deleted) {
  const handle = await getLocalFolderHandle();
  if (!handle) return;
  if ((await checkLocalFolderPermission(handle)) !== 'granted') return;

  const project = await getProject(report.projectId);
  if (!project) return;

  if (deleted) {
    await removeReportFromFolder(handle, project, report);
    return;
  }
  if (!(await getLocalFolderAutoSync())) return;
  await mirrorReportToFolder(handle, project, report);
}

async function onLocalFolderProjectChanged(project, deleted) {
  const handle = await getLocalFolderHandle();
  if (!handle) return;
  if ((await checkLocalFolderPermission(handle)) !== 'granted') return;

  if (deleted) {
    await removeProjectFromFolder(handle, project);
    return;
  }
  if (!(await getLocalFolderAutoSync())) return;
  await mirrorProjectToFolder(handle, project);
}
