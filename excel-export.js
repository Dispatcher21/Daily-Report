// Fills the PR#439 Daily Work Report template with a report's data and
// triggers a download. The template file itself is only ever read, never
// saved over -- every export starts from the pristine bytes on disk.

const TEMPLATE_URL = 'template/PR439-Daily-Work-Report-TEMPLATE.xlsx';

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

function toDateOnly(isoDateStr) {
  if (!isoDateStr) return null;
  const [y, m, d] = isoDateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// Draws a source image blob onto a canvas of the given aspect ratio using
// contain-fit (letterboxed on a white background), so ExcelJS's
// stretch-to-fill anchor never distorts the picture.
async function fitBlobToAspect(blob, aspect, targetWidth = 800) {
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
  return outBlob.arrayBuffer();
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

// The quantity grid (C12:H26) has no header row available to label which
// column belongs to which contractor (see note in generateReportWorkbookBuffer),
// so that mapping is recorded as a legend line prepended to Notes instead.
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

async function addFittedImage(workbook, worksheet, blob, rangeStr, aspect) {
  if (!blob) return;
  const buffer = await fitBlobToAspect(blob, aspect);
  const imageId = workbook.addImage({ buffer, extension: 'png' });
  worksheet.addImage(imageId, rangeStr);
}

async function generateReportWorkbookBuffer(report) {
  const resp = await fetch(TEMPLATE_URL);
  if (!resp.ok) throw new Error('Could not load template file: ' + resp.status);
  const templateBuffer = await resp.arrayBuffer();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer);

  const ws = workbook.getWorksheet('Daily Work Report');
  const photoWs = workbook.getWorksheet('Daily_Photo_Log');
  if (!ws || !photoWs) throw new Error('Template is missing an expected sheet');

  // --- Header / meta fields ---
  ws.getCell('Q3').value = numOrNull(report.reportNo);
  ws.getCell('Q5').value = toDateOnly(report.date);
  ws.getCell('K6').value = numOrNull(report.hours);
  ws.getCell('K7').value = report.activity || '';
  ws.getCell('K8').value = buildNotesWithContractorLegend(report);
  ws.getCell('B9').value = report.peName || '';
  ws.getCell('B5').value = report.projectNo || '';
  ws.getCell('C5').value = report.contractCo || '';
  ws.getCell('D5').value = report.projectLocation || '';
  ws.getCell('B7').value = report.projectName || '';
  ws.getCell('K5').value = report.representative || '';
  ws.getCell('Q7').value = toDateOnly(report.ntpDate);

  // NOTE: columns C-H at row 11 are NOT a free header row -- each of those
  // columns is actually one merged cell spanning rows 5-11 (C5:C11 already
  // holds "Contract Co.", D5:D11 holds project location, etc). The template
  // has no reserved cell for per-column contractor names, so instead of
  // clobbering those fields we record the column->contractor mapping as a
  // legend prepended to Notes (see buildNotesWithContractorLegend below).

  // --- Force & Equipment matrix (rows 12-26) ---
  (report.equipmentRows || []).forEach((row, i) => {
    const r = EQUIPMENT_FIRST_ROW + i;
    ws.getCell('A' + r).value = row.label || '';
    CONTRACTOR_COLS.forEach((col, ci) => {
      ws.getCell(col + r).value = numOrNull(row.qty ? row.qty[ci] : null);
    });
  });

  // --- Work summary ---
  ws.getCell('K12').value = report.trafficControlNote || '';
  ws.getCell('I14').value = report.workSummary || '';

  // --- Pay items (rows 28-33) ---
  (report.payItems || []).forEach((item, i) => {
    const r = PAY_ITEM_FIRST_ROW + i;
    ws.getCell('I' + r).value = item.itemNumber || '';
    ws.getCell('K' + r).value = item.description || '';
    ws.getCell('P' + r).value = numOrNull(item.qty);
    ws.getCell('Q' + r).value = item.unit || '';
  });

  // --- Controlling item / comments ---
  ws.getCell('B34').value = report.controllingItem || '';
  ws.getCell('K34').value = report.commentsOnTime || '';
  ws.getCell('C35').value = report.controllingItemTimeFrom || '';
  ws.getCell('F35').value = report.controllingItemTimeTo || '';
  ws.getCell('C36').value = report.workingConditions || '';

  // --- Traffic control select-one ---
  ws.getCell('I37').value = report.trafficControlSelect === 'IN_PLACE' ? 'X' : null;
  ws.getCell('K37').value = report.trafficControlSelect === 'ATTENTION_REQUIRED' ? 'X' : null;

  // --- Sign-off ---
  ws.getCell('D38').value = report.workBegin || '';
  ws.getCell('G38').value = report.workEnd || '';
  ws.getCell('I39').value = report.repSignatureName || '';
  ws.getCell('I41').value = report.peSignatureName || '';

  // --- Weather ---
  ws.getCell('F40').value = report.weatherDesc || '';
  ws.getCell('D41').value = numOrNull(report.tempHigh);
  ws.getCell('F41').value = numOrNull(report.tempLow);

  // --- Photo log sheet ---
  photoWs.getCell('C7').value = report.peName || '';

  await addFittedImage(workbook, ws, report.repSignatureImage, 'M39:O39', SIGNATURE_BOX_ASPECT);
  await addFittedImage(workbook, ws, report.peSignatureImage, 'M41:O41', SIGNATURE_BOX_ASPECT);

  const photos = report.photos || [];
  for (let i = 0; i < PHOTO_RANGES.length; i++) {
    await addFittedImage(workbook, photoWs, photos[i], PHOTO_RANGES[i], PHOTO_BOX_ASPECT);
  }

  return workbook.xlsx.writeBuffer();
}

async function downloadFilledReport(report) {
  const buffer = await generateReportWorkbookBuffer(report);
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const projectNo = report.projectNo || 'PR';
  a.href = url;
  a.download = `PR${projectNo}_DailyReport_${report.date || 'undated'}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
