// Orchestrates OneDrive sync: discovers projects that exist on OneDrive but
// not on this device yet, then for each project pulls anything newer from
// OneDrive before pushing anything newer from here. Manual only for now,
// wired to a "Sync Now" button in Settings -- see the project notes for why
// that's the deliberate first step rather than syncing silently in the
// background.
//
// Pull-before-push, always, per project: if this device pushed a stale
// local copy before checking what OneDrive already had, it could silently
// overwrite a newer copy from another device with an older one. Pulling
// first means whatever gets pushed afterward is judged against the
// now-current state, not a stale one.
//
// NOT YET TESTED against a live Microsoft account -- see onedrive-config.js.
// This is written to the documented MSAL.js v5 / Graph v1.0 APIs but the
// first real run against an actual OneDrive is still ahead of it.

function reportNeedsPush(report) {
  return !report.syncedAt || (report.updatedAt || 0) > report.syncedAt;
}
function projectNeedsPush(project) {
  return !project.syncedAt || (project.updatedAt || 0) > project.syncedAt;
}

// Looks for a Data/project.txt under every folder at the root of the app's
// OneDrive space -- that's how a project created on a different device
// gets found here at all, since this device never created it locally and
// has no other way to know its folder exists. A folder with no
// Data/project.txt yet is either not one of ours or only partially synced;
// either way, nothing to discover there this pass.
async function discoverRemoteProjects(accessToken) {
  const rootItems = await listOneDriveFolder(accessToken, '');
  const found = [];
  for (const item of rootItems) {
    if (!item.folder) continue;
    try {
      const blob = await downloadOneDriveFile(accessToken, `${item.name}/Data/project.txt`);
      found.push(JSON.parse(await blob.text()));
    } catch (err) {
      // No project.txt there -- not a project folder, skip it.
    }
  }
  return found;
}

// Pulls one project's reports down from its Data/ folder. Checks each
// record's updatedAt against what's already stored here BEFORE downloading
// any photos -- photos are the expensive part of a pull, and there's no
// reason to fetch them for a report this device's copy is already at least
// as current as.
async function pullProject(accessToken, project, onProgress) {
  const projectPath = projectFolderName(project);
  const dataFiles = await listOneDriveFolder(accessToken, `${projectPath}/Data`);

  let added = 0, updated = 0, skipped = 0;
  for (const file of dataFiles) {
    if (!file.file || !file.name.endsWith('.txt')) continue;
    if (onProgress) onProgress({ phase: 'pull', project, fileName: file.name });

    if (file.name === 'project.txt') continue; // handled by discoverRemoteProjects/the caller

    const raw = JSON.parse(await (await downloadOneDriveFile(accessToken, `${projectPath}/Data/${file.name}`)).text());
    const existing = await getReport(raw.id);
    if (existing && (raw.updatedAt || 0) <= (existing.updatedAt || 0)) {
      skipped++;
      continue;
    }

    const report = { ...raw };
    report.repSignatureImage = entryToBlobField(raw.repSignatureImage);
    delete report.peSignatureImage;
    const manifest = Array.isArray(raw.photos) ? raw.photos : [];
    const photoFolder = `${projectPath}/${reportPhotoFolderPath(report)}`;
    report.photos = [];
    for (let i = 0; i < manifest.length; i++) {
      if (!manifest[i]) {
        report.photos.push(null);
        continue;
      }
      try {
        report.photos.push(await downloadOneDriveFile(accessToken, `${photoFolder}/${reportPhotoFilename(report, i)}`));
      } catch (err) {
        console.error('Could not fetch synced photo', report.id, i, err);
        report.photos.push(null);
      }
    }

    report.syncedAt = Date.now(); // just pulled -- this copy IS what OneDrive has
    const result = await mergeReportRecord(report);
    if (result === 'added') added++;
    else if (result === 'updated') updated++;
    else skipped++;
  }
  return { added, updated, skipped };
}

// Pushes whatever's changed locally in one project: the project record
// itself if it needs it, then each report that's new or changed since its
// last successful push (PDF, photos, and the lean Data/ payload), then
// rebuilds the master spreadsheet from every report so it always reflects
// current state rather than an incremental diff that could drift from it.
async function pushProject(accessToken, project, reports, sandbox, onProgress) {
  const projectPath = projectFolderName(project);
  await ensureOneDrivePath(accessToken, `${projectPath}/Data`);

  if (projectNeedsPush(project)) {
    const payload = await serializeProjectForExport(project);
    await uploadOneDriveFile(
      accessToken,
      `${projectPath}/Data/project.txt`,
      new Blob([JSON.stringify(payload)], { type: 'text/plain' })
    );
    await markProjectSynced(project.id, Date.now());
  }

  const toPush = reports.filter(reportNeedsPush);
  const layout = toPush.length > 0 ? await loadPrintLayout() : null;
  const logoBlob = toPush.length > 0 ? await getReportLogo() : null;

  for (let i = 0; i < toPush.length; i++) {
    const report = toPush[i];
    if (onProgress) onProgress({ phase: 'push', project, report, done: i, total: toPush.length });

    const pdfFolder = `${projectPath}/${reportPdfFolderPath(report)}`;
    await ensureOneDrivePath(accessToken, pdfFolder);
    const { blob: pdfBlob } = await buildPdfBlob(sandbox, layout, [report], logoBlob);
    await uploadOneDriveFile(accessToken, `${pdfFolder}/${reportPdfFilename(project, report)}`, pdfBlob);

    const photos = report.photos || [];
    if (photos.some(Boolean)) {
      const photoFolder = `${projectPath}/${reportPhotoFolderPath(report)}`;
      await ensureOneDrivePath(accessToken, photoFolder);
      for (let p = 0; p < photos.length; p++) {
        if (photos[p]) await uploadOneDriveFile(accessToken, `${photoFolder}/${reportPhotoFilename(report, p)}`, photos[p]);
      }
    }

    const dataPayload = await buildSyncReportPayload(report);
    await uploadOneDriveFile(
      accessToken,
      `${projectPath}/Data/${report.id}.txt`,
      new Blob([JSON.stringify(dataPayload)], { type: 'text/plain' })
    );

    await markReportSynced(report.id, Date.now());
  }

  if (toPush.length > 0) {
    const wb = buildMasterWorkbook(project, reports);
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    await uploadOneDriveFile(
      accessToken,
      `${projectPath}/${masterSpreadsheetFilename(project)}`,
      new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    );
  }

  return { pushed: toPush.length };
}

// The one function the Settings UI actually calls. `sandbox` is an
// off-screen DOM container (same idea as download.html's #render-sandbox)
// that report PDFs get rendered into along the way.
async function syncAllProjects(sandbox, onProgress) {
  const accessToken = await getOneDriveAccessToken();

  const remoteProjects = await discoverRemoteProjects(accessToken);
  for (const raw of remoteProjects) {
    raw.syncedAt = Date.now();
    await mergeProjectRecord(deserializeImportedProject(raw));
  }

  const projects = await getAllProjects();
  const summary = { projectsSynced: 0, reportsPushed: 0, reportsPulled: 0, errors: [] };

  for (const project of projects) {
    try {
      const pullResult = await pullProject(accessToken, project, onProgress);
      const reports = await getReportsForProject(project.id);
      const freshProject = await getProject(project.id);
      const pushResult = await pushProject(accessToken, freshProject, reports, sandbox, onProgress);

      summary.reportsPulled += pullResult.added + pullResult.updated;
      summary.reportsPushed += pushResult.pushed;
      summary.projectsSynced++;
    } catch (err) {
      console.error('Sync failed for project', project.id, err);
      summary.errors.push({ project: project.name, message: err.message });
    }
  }
  return summary;
}
