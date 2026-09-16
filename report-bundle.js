// Reads the .report file format: a zip archive (via fflate) wearing a
// custom extension -- the same pattern KMZ (zipped KML) and Word/Excel's
// own .docx/.xlsx (zipped XML) use. That's a real, standard
// container-format convention, not a disguise -- nothing inside is
// executable or renderable content, just report data and photos this app
// already stores. Opened back into the app via Settings > Import.
//
// This file only reads bundles now -- the send/build side (creating a
// .report file to share out) was a removed feature; nothing in the app
// still creates one. A device can only ever receive a bundle someone else
// (or an older version of this app) produced.
//
// Bundle contents:
//   manifest.json     -- format marker + version, so a future reshaping of
//                         this format can still tell an old bundle apart
//   project.json      -- the project this report belongs to, so a device
//                         that's never seen this project has somewhere to
//                         attach the report to
//   report.json       -- the report's own fields, WITHOUT embedded photo or
//                         signature bytes -- those travel as real files
//                         below instead of base64 text
//   photos/photoN.jpg -- one real file per filled photo slot (1-indexed)
//   signature.png     -- the representative's signature, if signed

const PHOTO_SLOT_COUNT = 6;

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
