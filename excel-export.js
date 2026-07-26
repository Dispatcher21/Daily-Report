// Fills the PR#439 Daily Work Report template with a report's data and
// triggers a download. The template file itself is only ever read, never
// saved over -- every export starts from the pristine bytes on disk.
//
// IMPORTANT: this does NOT use ExcelJS to load+modify+resave the workbook.
// A full load/save round trip through ExcelJS (or any library that rebuilds
// the workbook from its own object model) silently drops parts it doesn't
// understand -- verified against this exact template: printer settings
// (which drives Excel's Page Layout pagination/zoom), calcChain.xml,
// docProps/custom.xml, and three customXml parts all vanish on a save with
// ZERO edits made. That's what caused the "template is resizing" bug.
// Instead we treat the .xlsx as a zip (via fflate), and only ever touch the
// exact <c> cell elements we're filling in and append new drawing/media
// parts for photos -- every other byte of every other part is carried over
// completely untouched.

const TEMPLATE_URL = 'template/PR439-Daily-Work-Report-TEMPLATE.xlsx';

const SHEET1_PATH = 'xl/worksheets/sheet1.xml'; // Daily Work Report
const SHEET2_PATH = 'xl/worksheets/sheet2.xml'; // Daily_Photo_Log
const SHEET1_RELS_PATH = 'xl/worksheets/_rels/sheet1.xml.rels';
const SHEET2_RELS_PATH = 'xl/worksheets/_rels/sheet2.xml.rels';
const CONTENT_TYPES_PATH = '[Content_Types].xml';

const CONTRACTOR_COLS = ['C', 'D', 'E', 'F', 'G', 'H'];
const EQUIPMENT_FIRST_ROW = 12; // row 12..26, 15 rows total
const PAY_ITEM_FIRST_ROW = 28; // row 28..33, 6 rows total

const PHOTO_RANGES = [
  'A10:F25',
  'H10:M25',
  'A28:F43',
  'H28:M43',
  'A46:F61',
  'H46:M61',
];

// Aspect ratios (width/height) measured from the template's own column
// widths / row heights so pasted images fill each box without distortion.
const PHOTO_BOX_ASPECT = 400 / 303;
const SIGNATURE_BOX_ASPECT = 242 / 20;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function excelDateSerial(isoDateStr) {
  if (!isoDateStr) return null;
  const [y, m, d] = isoDateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  const utcDate = Date.UTC(y, m - 1, d);
  const epoch = Date.UTC(1899, 11, 30); // Excel's date epoch (accounts for the 1900 leap-year bug)
  return Math.round((utcDate - epoch) / 86400000);
}

function xmlEscapeText(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Replaces a single <c r="CELLREF" .../> (or ...>...</c>) element in a
// worksheet XML string, preserving its existing style ("s") attribute and
// discarding whatever value/type it had. Leaves every other byte untouched.
function setCellValue(xml, cellRef, kind, value) {
  const re = new RegExp(`<c r="${cellRef}"([^>]*?)(/>|>[\\s\\S]*?</c>)`);
  const match = xml.match(re);
  if (!match) {
    console.warn('excel-export: cell not found in template, skipping:', cellRef);
    return xml;
  }
  const styleMatch = match[1].match(/\ss="\d+"/);
  const styleAttr = styleMatch ? styleMatch[0] : '';

  let replacement;
  if (value === null || value === undefined || value === '') {
    replacement = `<c r="${cellRef}"${styleAttr}/>`;
  } else if (kind === 'number') {
    replacement = `<c r="${cellRef}"${styleAttr}><v>${value}</v></c>`;
  } else if (kind === 'date') {
    const serial = excelDateSerial(value);
    replacement = serial === null ? `<c r="${cellRef}"${styleAttr}/>` : `<c r="${cellRef}"${styleAttr}><v>${serial}</v></c>`;
  } else {
    const escaped = xmlEscapeText(value);
    replacement = `<c r="${cellRef}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escaped}</t></is></c>`;
  }
  return xml.replace(re, replacement);
}

// The quantity grid (C12:H26) has no header row available to label which
// column belongs to which contractor -- each of those columns is actually
// part of one merged cell spanning rows 5-11 (C5:C11 already holds
// "Contract Co.", D5:D11 holds project location, etc), so there's no free
// cell to put a per-column header in. Instead the column->contractor
// mapping is recorded as a legend line prepended to Notes.
function buildNotesWithContractorLegend(report) {
  const parts = [];
  (report.contractors || []).forEach((c, i) => {
    const name = (c.name || '').trim();
    if (name && i < CONTRACTOR_COLS.length) parts.push(`${CONTRACTOR_COLS[i]}: ${name}`);
  });
  const notes = report.notes || '';
  if (parts.length === 0) return notes;
  const legend = `Contractor columns - ${parts.join(' | ')}`;
  return notes ? `${legend}\n${notes}` : legend;
}

function fillSheet1Xml(xml, report) {
  xml = setCellValue(xml, 'Q3', 'number', numOrNull(report.reportNo));
  xml = setCellValue(xml, 'Q5', 'date', report.date);
  xml = setCellValue(xml, 'K6', 'number', numOrNull(report.hours));
  xml = setCellValue(xml, 'K7', 'text', report.activity || '');
  xml = setCellValue(xml, 'K8', 'text', buildNotesWithContractorLegend(report));
  xml = setCellValue(xml, 'B9', 'text', report.peName || '');
  xml = setCellValue(xml, 'B5', 'text', report.projectNo || '');
  xml = setCellValue(xml, 'C5', 'text', report.contractCo || '');
  xml = setCellValue(xml, 'D5', 'text', report.projectLocation || '');
  xml = setCellValue(xml, 'B7', 'text', report.projectName || '');
  xml = setCellValue(xml, 'K5', 'text', report.representative || '');
  xml = setCellValue(xml, 'Q7', 'date', report.ntpDate);

  (report.equipmentRows || []).forEach((row, i) => {
    const r = EQUIPMENT_FIRST_ROW + i;
    xml = setCellValue(xml, 'A' + r, 'text', row.label || '');
    CONTRACTOR_COLS.forEach((col, ci) => {
      xml = setCellValue(xml, col + r, 'number', numOrNull(row.qty ? row.qty[ci] : null));
    });
  });

  xml = setCellValue(xml, 'K12', 'text', report.trafficControlNote || '');
  xml = setCellValue(xml, 'I14', 'text', report.workSummary || '');

  (report.payItems || []).forEach((item, i) => {
    const r = PAY_ITEM_FIRST_ROW + i;
    xml = setCellValue(xml, 'I' + r, 'text', item.itemNumber || '');
    xml = setCellValue(xml, 'K' + r, 'text', item.description || '');
    xml = setCellValue(xml, 'P' + r, 'number', numOrNull(item.qty));
    xml = setCellValue(xml, 'Q' + r, 'text', item.unit || '');
  });

  xml = setCellValue(xml, 'B34', 'text', report.controllingItem || '');
  xml = setCellValue(xml, 'K34', 'text', report.commentsOnTime || '');
  xml = setCellValue(xml, 'C35', 'text', report.controllingItemTimeFrom || '');
  xml = setCellValue(xml, 'F35', 'text', report.controllingItemTimeTo || '');
  xml = setCellValue(xml, 'C36', 'text', report.workingConditions || '');

  xml = setCellValue(xml, 'I37', 'text', report.trafficControlSelect === 'IN_PLACE' ? 'X' : null);
  xml = setCellValue(xml, 'K37', 'text', report.trafficControlSelect === 'ATTENTION_REQUIRED' ? 'X' : null);

  xml = setCellValue(xml, 'D38', 'text', report.workBegin || '');
  xml = setCellValue(xml, 'G38', 'text', report.workEnd || '');
  xml = setCellValue(xml, 'I39', 'text', report.repSignatureName || '');
  xml = setCellValue(xml, 'I41', 'text', report.peSignatureName || '');

  xml = setCellValue(xml, 'F40', 'text', report.weatherDesc || '');
  xml = setCellValue(xml, 'D41', 'number', numOrNull(report.tempHigh));
  xml = setCellValue(xml, 'F41', 'number', numOrNull(report.tempLow));

  return xml;
}

function fillSheet2Xml(xml, report) {
  return setCellValue(xml, 'C7', 'text', report.peName || '');
}

// ---------- Image embedding (raw drawing/media parts) ----------

function colLetterToIndex(letters) {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) idx = idx * 26 + (letters.charCodeAt(i) - 64);
  return idx - 1; // 0-based
}

function parseCellRef(ref) {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  return { col: colLetterToIndex(m[1]), row: Number(m[2]) - 1 };
}

// A "A10:F25" style range -> a twoCellAnchor from/to pair (to is exclusive,
// i.e. one past the last included column/row).
function rangeToAnchor(rangeStr) {
  const [startRef, endRef] = rangeStr.split(':');
  const start = parseCellRef(startRef);
  const end = parseCellRef(endRef);
  return {
    from: { col: start.col, row: start.row },
    to: { col: end.col + 1, row: end.row + 1 },
  };
}

async function fitBlobToAspectPng(blob, aspect, targetWidth = 800) {
  const targetHeight = Math.round(targetWidth / aspect);
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() =>
    createImageBitmapFallback(blob)
  );

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  const srcAspect = bitmap.width / bitmap.height;
  let drawW, drawH;
  if (srcAspect > aspect) {
    drawW = targetWidth;
    drawH = drawW / srcAspect;
  } else {
    drawH = targetHeight;
    drawW = drawH * srcAspect;
  }
  const dx = (targetWidth - drawW) / 2;
  const dy = (targetHeight - drawH) / 2;
  ctx.drawImage(bitmap, dx, dy, drawW, drawH);

  const outBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new Uint8Array(await outBlob.arrayBuffer());
}

function createImageBitmapFallback(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
}

function buildDrawingXml(pictures) {
  const anchors = pictures
    .map(
      ({ anchor, relId, idx }) => `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${anchor.from.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.from.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${anchor.to.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.to.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${idx}" name="Picture ${idx}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`;
}

function buildDrawingRelsXml(pictures) {
  const rels = pictures
    .map(({ relId, mediaName }) => `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

// Appends a new relationship to an existing sheetN.xml.rels, using the next
// free rIdN (existing rels -- e.g. the printer settings link -- are kept).
function addRelationship(relsXml, type, target) {
  const existingIds = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  const nextId = 'rId' + (existingIds.length ? Math.max(...existingIds) + 1 : 1);
  const newRel = `<Relationship Id="${nextId}" Type="${type}" Target="${target}"/>`;
  return { xml: relsXml.replace('</Relationships>', newRel + '</Relationships>'), relId: nextId };
}

function addContentTypeOverride(contentTypesXml, partName, contentType) {
  if (contentTypesXml.includes(`PartName="${partName}"`)) return contentTypesXml;
  const override = `<Override PartName="${partName}" ContentType="${contentType}"/>`;
  return contentTypesXml.replace('</Types>', override + '</Types>');
}

function addDefaultExtensionIfMissing(contentTypesXml, extension, contentType) {
  if (contentTypesXml.includes(`Extension="${extension}"`)) return contentTypesXml;
  const def = `<Default Extension="${extension}" ContentType="${contentType}"/>`;
  return contentTypesXml.replace('</Types>', def + '</Types>');
}

// Adds a <drawing r:id="..."/> reference to a worksheet XML, right before
// </worksheet> (the only valid position left in these two sheets' schema
// order -- <drawing> comes after <headerFooter>, and neither sheet has any
// of the handful of elements that are schema-valid after it).
function attachDrawingToSheet(sheetXml, relId) {
  return sheetXml.replace('</worksheet>', `<drawing r:id="${relId}"/></worksheet>`);
}

async function embedImagesForSheet(files, sheetPath, sheetRelsPath, drawingPath, drawingRelsPath, images, mediaCounterRef) {
  const validImages = [];
  for (const img of images) {
    if (img.blob) validImages.push(img);
  }
  if (validImages.length === 0) return;

  const pictures = [];
  for (let i = 0; i < validImages.length; i++) {
    const { blob, aspect, rangeStr } = validImages[i];
    const png = await fitBlobToAspectPng(blob, aspect);
    const mediaName = `image${mediaCounterRef.n++}.png`;
    files['xl/media/' + mediaName] = png;
    pictures.push({
      anchor: rangeToAnchor(rangeStr),
      relId: 'rId' + (i + 1),
      mediaName,
      idx: i + 1,
    });
  }

  files[drawingPath] = textEncoder.encode(buildDrawingXml(pictures));
  files[drawingRelsPath] = textEncoder.encode(buildDrawingRelsXml(pictures));

  let sheetRelsXml = files[sheetRelsPath]
    ? textDecoder.decode(files[sheetRelsPath])
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const drawingRelTarget = '../drawings/' + drawingPath.split('/').pop();
  const { xml: newRelsXml, relId: drawingRelId } = addRelationship(
    sheetRelsXml,
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing',
    drawingRelTarget
  );
  files[sheetRelsPath] = textEncoder.encode(newRelsXml);

  let sheetXml = textDecoder.decode(files[sheetPath]);
  files[sheetPath] = textEncoder.encode(attachDrawingToSheet(sheetXml, drawingRelId));

  let contentTypesXml = textDecoder.decode(files[CONTENT_TYPES_PATH]);
  contentTypesXml = addDefaultExtensionIfMissing(contentTypesXml, 'png', 'image/png');
  contentTypesXml = addContentTypeOverride(
    contentTypesXml,
    '/' + drawingPath,
    'application/vnd.openxmlformats-officedocument.drawing+xml'
  );
  files[CONTENT_TYPES_PATH] = textEncoder.encode(contentTypesXml);
}

async function generateReportWorkbookBuffer(report) {
  const resp = await fetch(TEMPLATE_URL);
  if (!resp.ok) throw new Error('Could not load template file: ' + resp.status);
  const templateBuffer = new Uint8Array(await resp.arrayBuffer());

  const files = fflate.unzipSync(templateBuffer);

  let sheet1Xml = textDecoder.decode(files[SHEET1_PATH]);
  sheet1Xml = fillSheet1Xml(sheet1Xml, report);
  files[SHEET1_PATH] = textEncoder.encode(sheet1Xml);

  let sheet2Xml = textDecoder.decode(files[SHEET2_PATH]);
  sheet2Xml = fillSheet2Xml(sheet2Xml, report);
  files[SHEET2_PATH] = textEncoder.encode(sheet2Xml);

  const mediaCounterRef = { n: 1 };

  await embedImagesForSheet(
    files,
    SHEET1_PATH,
    SHEET1_RELS_PATH,
    'xl/drawings/drawing1.xml',
    'xl/drawings/_rels/drawing1.xml.rels',
    [
      { blob: report.repSignatureImage, aspect: SIGNATURE_BOX_ASPECT, rangeStr: 'M39:O39' },
      { blob: report.peSignatureImage, aspect: SIGNATURE_BOX_ASPECT, rangeStr: 'M41:O41' },
    ],
    mediaCounterRef
  );

  const photos = report.photos || [];
  await embedImagesForSheet(
    files,
    SHEET2_PATH,
    SHEET2_RELS_PATH,
    'xl/drawings/drawing2.xml',
    'xl/drawings/_rels/drawing2.xml.rels',
    PHOTO_RANGES.map((rangeStr, i) => ({ blob: photos[i], aspect: PHOTO_BOX_ASPECT, rangeStr })),
    mediaCounterRef
  );

  return fflate.zipSync(files, { level: 6 });
}

function reportFilename(report) {
  const projectNo = report.projectNo || 'PR';
  return `PR${projectNo}_DailyReport_${report.date || 'undated'}.xlsx`;
}

function triggerDownload(bytes, filename, mimeType) {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function downloadFilledReport(report) {
  const zipped = await generateReportWorkbookBuffer(report);
  triggerDownload(zipped, reportFilename(report), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// Bundles several filled reports into a single .zip so the browser only has
// to deliver one download -- triggering N separate downloads in a row gets
// silently blocked by mobile browsers after the first one or two.
async function downloadReportsAsZip(reports) {
  const files = {};
  const usedNames = new Set();
  for (const report of reports) {
    const buf = await generateReportWorkbookBuffer(report);
    let name = reportFilename(report);
    if (usedNames.has(name)) {
      name = name.replace(/\.xlsx$/, `_Report${report.reportNo}.xlsx`);
    }
    usedNames.add(name);
    files[name] = buf;
  }
  const zipped = fflate.zipSync(files, { level: 6 });
  const stamp = reports[0] && reports[0].projectNo ? `PR${reports[0].projectNo}_` : '';
  triggerDownload(zipped, `${stamp}DailyReports_${reports.length}files.zip`, 'application/zip');
}
