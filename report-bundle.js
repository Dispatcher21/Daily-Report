// Builds and reads the .report file format: a zip archive (via fflate)
// wearing a custom extension -- the same pattern KMZ (zipped KML) and
// Word/Excel's own .docx/.xlsx (zipped XML) use. That's a real, standard
// container-format convention, not a disguise -- nothing inside is
// executable or renderable content, just the same report data and photos
// this app already stores, packaged as one file instead of several loose
// ones. Meant to be handed to the OS share sheet (whatever cloud provider
// an inspector already has signed in -- OneDrive, Drive, anything) and
// later opened back into the app via Settings > Import, not synced through
// any API this app calls on its own.
//
// Bundle contents:
//   manifest.json     -- format marker + version, so a future reshaping of
//                         this format can still tell an old bundle apart
//   project.json      -- the project this report belongs to, so a device
//                         that's never seen this project has somewhere to
//                         attach the report to
//   report.json       -- the report's own fields, WITHOUT embedded photo or
//                         signature bytes -- those travel as real files
//                         below instead of base64 text (smaller, and no
//                         "which slots are filled" manifest is needed the
//                         way the OneDrive sync payload needed one -- the
//                         zip listing itself already says what's there)
//   photos/photoN.jpg -- one real file per filled photo slot (1-indexed)
//   signature.png     -- the representative's signature, if signed

const PHOTO_SLOT_COUNT = 6;

function reportBundleFilename(report) {
  return `R${report.reportNo}_${report.date || 'undated'}.report`;
}

async function buildReportBundle(project, report) {
  const files = {};

  files['manifest.json'] = fflate.strToU8(JSON.stringify({
    formatVersion: 1,
    kind: 'daily-report-app-bundle',
    exportedAt: Date.now(),
  }));

  files['project.json'] = fflate.strToU8(JSON.stringify(await serializeProjectForExport(project)));

  const reportPayload = { ...report };
  delete reportPayload.photos;
  delete reportPayload.repSignatureImage;
  delete reportPayload.peSignatureImage; // retired field, never round-tripped
  files['report.json'] = fflate.strToU8(JSON.stringify(reportPayload));

  const photos = report.photos || [];
  for (let i = 0; i < photos.length; i++) {
    if (!photos[i]) continue;
    // level: 0 (store, no compression) -- these are already-compressed
    // JPEGs, re-deflating them wastes time for a percent or two at best.
    files[`photos/photo${i + 1}.jpg`] = [new Uint8Array(await photos[i].arrayBuffer()), { level: 0 }];
  }
  if (report.repSignatureImage) {
    files['signature.png'] = [new Uint8Array(await report.repSignatureImage.arrayBuffer()), { level: 0 }];
  }

  const zipped = fflate.zipSync(files, { level: 6 });
  return new Blob([zipped], { type: 'application/zip' });
}

// Returns null (rather than throwing) when `blob` isn't a zip at all or
// isn't one of ours -- callers use this to fall back to the plain-JSON
// backup format, since a file picked for Import could be either.
async function tryParseReportBundle(blob) {
  let files;
  try {
    files = fflate.unzipSync(new Uint8Array(await blob.arrayBuffer()));
  } catch (err) {
    return null; // not a zip at all
  }
  if (!files['manifest.json']) return null;

  let manifest;
  try {
    manifest = JSON.parse(fflate.strFromU8(files['manifest.json']));
  } catch (err) {
    return null;
  }
  if (!manifest || manifest.kind !== 'daily-report-app-bundle') return null;

  const project = deserializeImportedProject(JSON.parse(fflate.strFromU8(files['project.json'])));
  const report = JSON.parse(fflate.strFromU8(files['report.json']));

  report.photos = [];
  for (let i = 1; i <= PHOTO_SLOT_COUNT; i++) {
    const entry = files[`photos/photo${i}.jpg`];
    report.photos.push(entry ? new Blob([entry], { type: 'image/jpeg' }) : null);
  }
  report.repSignatureImage = files['signature.png'] ? new Blob([files['signature.png']], { type: 'image/png' }) : null;
  delete report.peSignatureImage;

  return { project, report };
}
