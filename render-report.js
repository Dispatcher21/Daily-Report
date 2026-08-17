// Shared report -> DOM rendering, used by both print-view.html (browser
// print-to-PDF) and download.html (real PDF file via html2canvas+jsPDF).
// Renders each sheet as a CSS Grid sized in pt from print-layout.json so it
// matches the actual template's printed layout.

// ---------- Grid geometry helpers ----------

// NOTE: prefixed with rr* -- excel-export.js independently defines a
// same-purpose colLetterToIndex (0-based, same logic, harmless if it
// silently wins the global) but also CONTRACTOR_COLS/EQUIPMENT_FIRST_ROW/
// PAY_ITEM_FIRST_ROW as `const`, which throws a hard SyntaxError on
// redeclaration across <script> tags when both files load on one page
// (download.html loads both). Every name in this file that has a
// same-named twin in excel-export.js is renamed here to avoid collisions.
function rrColLetterToIndex(letters) {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) idx = idx * 26 + (letters.charCodeAt(i) - 64);
  return idx - 1; // 0-based
}
function colIndexToLetter(idx) {
  let n = idx + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function parseCoord(coord) {
  const m = coord.match(/^([A-Z]+)(\d+)$/);
  return { col: rrColLetterToIndex(m[1]) + 1, row: Number(m[2]) }; // 1-based for CSS grid
}

// ---------- Cell styling ----------

const BORDER_WIDTH = { thin: '0.75pt', medium: '1.5pt', thick: '2.25pt', hair: '0.5pt' };

function borderCss(side) {
  if (!side) return 'none';
  const w = BORDER_WIDTH[side.style] || '0.75pt';
  return `${w} solid ${side.color || '#000'}`;
}

function applyCellStyle(el, styleData) {
  el.style.fontFamily = 'Arial, sans-serif';
  el.style.fontSize = '10pt';
  el.style.background = '#fff';
  if (!styleData) return;
  if (styleData.fill) el.style.background = styleData.fill;
  const b = styleData.border || {};
  el.style.borderTop = borderCss(b.top);
  el.style.borderRight = borderCss(b.right);
  el.style.borderBottom = borderCss(b.bottom);
  el.style.borderLeft = borderCss(b.left);
  const f = styleData.font || {};
  if (f.bold) el.style.fontWeight = '700';
  if (f.italic) el.style.fontStyle = 'italic';
  if (f.size) el.style.fontSize = f.size + 'pt';
  if (f.color) el.style.color = f.color;
  const a = styleData.align || {};
  el.style.alignItems = a.v === 'center' ? 'center' : a.v === 'bottom' ? 'flex-end' : 'flex-start';
  el.style.justifyContent = a.h === 'center' ? 'center' : a.h === 'right' ? 'flex-end' : 'flex-start';
  el.style.textAlign = a.h || 'left';
  if (a.wrap) {
    el.style.whiteSpace = 'pre-wrap';
    el.style.overflow = 'visible';
  }
}

// ---------- Sheet rendering ----------

// coordValues: { COORD: textOverride } for cells whose content comes from
// report data instead of the template's own (blank) text.
// coordImages: { COORD: Blob } for photo/signature cells.
function renderSheetGrid(sheetData, coordValues, coordImages) {
  const grid = document.createElement('div');
  grid.className = 'print-grid';
  grid.style.gridTemplateColumns = sheetData.columns.map((c) => c.widthPt + 'pt').join(' ');
  grid.style.gridTemplateRows = sheetData.rows.map((r) => r.heightPt + 'pt').join(' ');

  const mergeSpanByAnchor = {};
  const coveredByMerge = new Set();
  sheetData.merges.forEach((m) => {
    const [a, b] = m.split(':');
    const pa = parseCoord(a);
    const pb = parseCoord(b);
    mergeSpanByAnchor[a] = { colSpan: pb.col - pa.col + 1, rowSpan: pb.row - pa.row + 1 };
    for (let r = pa.row; r <= pb.row; r++) {
      for (let c = pa.col; c <= pb.col; c++) {
        const coord = colIndexToLetter(c - 1) + r;
        if (coord !== a) coveredByMerge.add(coord);
      }
    }
  });

  for (let r = 1; r <= sheetData.maxRow; r++) {
    for (let c = 1; c <= sheetData.maxCol; c++) {
      const coord = colIndexToLetter(c - 1) + r;
      if (coveredByMerge.has(coord)) continue;
      const styleData = sheetData.cells[coord];
      const hasOverride = coord in coordValues;
      const hasImage = coord in coordImages;
      if (!styleData && !hasOverride && !hasImage) continue;

      const span = mergeSpanByAnchor[coord];
      const cellEl = document.createElement('div');
      cellEl.className = 'print-cell';
      cellEl.style.gridColumn = `${c} / span ${span ? span.colSpan : 1}`;
      cellEl.style.gridRow = `${r} / span ${span ? span.rowSpan : 1}`;
      applyCellStyle(cellEl, styleData);

      if (hasImage) {
        const blob = coordImages[coord];
        if (blob) {
          const img = document.createElement('img');
          img.src = URL.createObjectURL(blob);
          cellEl.appendChild(img);
          cellEl.style.padding = '0';
        }
      } else {
        cellEl.textContent = hasOverride ? coordValues[coord] : (styleData && styleData.text) || '';
      }

      grid.appendChild(cellEl);
    }
  }
  return grid;
}

// ---------- Report -> cell values (mirrors excel-export.js's coordinates) ----------

const RR_CONTRACTOR_COLS = ['C', 'D', 'E', 'F', 'G', 'H'];
const RR_EQUIPMENT_FIRST_ROW = 12;
const RR_PAY_ITEM_FIRST_ROW = 28;

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}
function calendarDay(date, ntpDate) {
  if (!date || !ntpDate) return '';
  const d1 = new Date(date + 'T00:00:00');
  const d2 = new Date(ntpDate + 'T00:00:00');
  return Math.round((d1 - d2) / 86400000) + 1;
}
function rrBuildNotesWithContractorLegend(report) {
  const parts = [];
  (report.contractors || []).forEach((c, i) => {
    const name = (c.name || '').trim();
    if (name && i < RR_CONTRACTOR_COLS.length) parts.push(`${RR_CONTRACTOR_COLS[i]}: ${name}`);
  });
  const notes = report.notes || '';
  if (parts.length === 0) return notes;
  const legend = `Contractor columns - ${parts.join(' | ')}`;
  return notes ? `${legend}\n${notes}` : legend;
}

function buildSheet1Values(report) {
  const v = {};
  v['Q3'] = report.reportNo != null ? String(report.reportNo) : '';
  v['Q5'] = fmtDate(report.date);
  v['K6'] = report.hours != null && report.hours !== '' ? String(report.hours) : '';
  v['K7'] = report.activity || '';
  v['K8'] = rrBuildNotesWithContractorLegend(report);
  v['B9'] = report.peName || '';
  v['B5'] = report.projectNo || '';
  v['C5'] = report.contractCo || '';
  v['D5'] = report.projectLocation || '';
  v['B7'] = report.projectName || '';
  v['K5'] = report.representative || '';
  v['Q7'] = fmtDate(report.ntpDate);
  v['Q9'] = String(calendarDay(report.date, report.ntpDate));

  (report.equipmentRows || []).forEach((row, i) => {
    const r = RR_EQUIPMENT_FIRST_ROW + i;
    v['A' + r] = row.label || '';
    RR_CONTRACTOR_COLS.forEach((col, ci) => {
      const q = row.qty ? row.qty[ci] : '';
      v[col + r] = q != null && q !== '' ? String(q) : '';
    });
  });

  v['K12'] = report.trafficControlNote || '';
  v['I14'] = report.workSummary || '';

  (report.payItems || []).forEach((item, i) => {
    const r = RR_PAY_ITEM_FIRST_ROW + i;
    v['I' + r] = item.itemNumber || '';
    v['K' + r] = item.description || '';
    v['P' + r] = item.qty != null && item.qty !== '' ? String(item.qty) : '';
    v['Q' + r] = item.unit || '';
  });

  v['B34'] = report.controllingItem || '';
  v['K34'] = report.commentsOnTime || '';
  v['C35'] = report.controllingItemTimeFrom || '';
  v['F35'] = report.controllingItemTimeTo || '';
  v['C36'] = report.workingConditions || '';
  v['I37'] = report.trafficControlSelect === 'IN_PLACE' ? 'X' : '';
  v['K37'] = report.trafficControlSelect === 'ATTENTION_REQUIRED' ? 'X' : '';
  v['C39'] = report.workBegin || '';
  v['F39'] = report.workEnd || '';
  v['I39'] = report.repSignatureName || '';
  v['I41'] = report.peSignatureName || '';
  v['F40'] = report.weatherDesc || '';
  v['D41'] = report.tempHigh != null && report.tempHigh !== '' ? String(report.tempHigh) : '';
  v['F41'] = report.tempLow != null && report.tempLow !== '' ? String(report.tempLow) : '';
  return v;
}

function buildSheet1Images(report) {
  const imgs = {};
  if (report.repSignatureImage) imgs['M39'] = report.repSignatureImage;
  if (report.peSignatureImage) imgs['M41'] = report.peSignatureImage;
  return imgs;
}

function buildSheet2Values(report) {
  return {
    B3: fmtDate(report.date),
    J3: report.projectNo || '',
    C5: report.projectName || '',
    C7: report.peName || '',
  };
}

const PHOTO_COORDS = ['A10', 'H10', 'A28', 'H28', 'A46', 'H46'];
function buildSheet2Images(report) {
  const imgs = {};
  (report.photos || []).forEach((blob, i) => {
    if (blob && PHOTO_COORDS[i]) imgs[PHOTO_COORDS[i]] = blob;
  });
  return imgs;
}

// ---------- Page assembly ----------

let printLayoutPromise = null;
function loadPrintLayout() {
  if (!printLayoutPromise) printLayoutPromise = fetch('print-layout.json').then((r) => r.json());
  return printLayoutPromise;
}

// Appends one report's two sheet-pages (each a .sheet-page div) into
// `container`. Returns the array of page elements just added.
function renderReportPages(container, layout, report) {
  const page1 = document.createElement('div');
  page1.className = 'sheet-page';
  page1.appendChild(renderSheetGrid(layout.dailyWorkReport, buildSheet1Values(report), buildSheet1Images(report)));
  container.appendChild(page1);

  const page2 = document.createElement('div');
  page2.className = 'sheet-page';
  page2.appendChild(renderSheetGrid(layout.dailyPhotoLog, buildSheet2Values(report), buildSheet2Images(report)));
  container.appendChild(page2);

  return [page1, page2];
}

// Waits for every <img> under `container` to finish loading/decoding (or
// error out) so a snapshot (print or canvas capture) doesn't race the photos.
function waitForImages(container) {
  const imgs = $$('img', container);
  return Promise.all(
    imgs.map((img) =>
      img.complete ? Promise.resolve() : new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      })
    )
  );
}
