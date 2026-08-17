// Report -> DOM rendering for the PDF export (download.html). Each sheet is
// drawn as a CSS Grid sized in pt straight from print-layout.json, so it
// matches what the Excel template actually prints.

// ---------- Grid geometry helpers ----------

// NOTE: the rr* prefixes date from when this file shared a page with the old
// Excel exporter, which declared the same const names and blew up with a
// redeclaration SyntaxError. Kept as-is so the names stay unambiguous.
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
  el.style.color = '#000';
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
  // Wrapped cells are real boxes (the work-summary block, pay item
  // descriptions) so they clip; everything else is allowed to spill into
  // empty neighbours the way Excel renders long labels and values.
  if (a.wrap) {
    el.style.whiteSpace = 'pre-wrap';
    el.style.overflow = 'hidden';
  }
  // Vertical text (the contractor-name headers). The rotation itself is done
  // on an inner span so it doesn't disturb the cell's own box; the cell just
  // centres it in the tall merged column.
  if (a.rot) {
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.overflow = 'visible';
  }
}

// ---------- Sheet rendering ----------

// coordValues: { COORD: textOverride } for cells whose content comes from
// report data instead of the template's own (blank) text.
// coordImages: { COORD: Blob } for photo/signature cells.
function renderSheetGrid(sheetData, coordValues, coordImages) {
  // Only the print area lands on paper. Both sheets carry stray formatting
  // well past it (sheet 1 has cells out to column AL against a print area
  // ending at Q), and rendering those blew the page proportions out.
  const lastCol = sheetData.lastCol || sheetData.maxCol;
  const lastRow = sheetData.lastRow || sheetData.maxRow;

  const grid = document.createElement('div');
  grid.className = 'print-grid';
  grid.style.gridTemplateColumns = sheetData.columns
    .filter((c) => c.col <= lastCol)
    .map((c) => c.widthPt + 'pt')
    .join(' ');
  grid.style.gridTemplateRows = sheetData.rows
    .filter((r) => r.row <= lastRow)
    .map((r) => r.heightPt + 'pt')
    .join(' ');

  const mergeSpanByAnchor = {};
  const coveredByMerge = new Set();
  sheetData.merges.forEach((m) => {
    const [a, b] = m.split(':');
    const pa = parseCoord(a);
    const pb = parseCoord(b);
    if (pa.col > lastCol || pa.row > lastRow) return;
    // Clamp merges that run past the print area so they don't stretch the grid.
    const endCol = Math.min(pb.col, lastCol);
    const endRow = Math.min(pb.row, lastRow);
    mergeSpanByAnchor[a] = { colSpan: endCol - pa.col + 1, rowSpan: endRow - pa.row + 1 };
    for (let r = pa.row; r <= endRow; r++) {
      for (let c = pa.col; c <= endCol; c++) {
        const coord = colIndexToLetter(c - 1) + r;
        if (coord !== a) coveredByMerge.add(coord);
      }
    }
  });

  for (let r = 1; r <= lastRow; r++) {
    for (let c = 1; c <= lastCol; c++) {
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
        const text = hasOverride ? coordValues[coord] : (styleData && styleData.text) || '';
        // Values the app supplies always print black. The template carries
        // leftover red/blue font colours on some input cells from whoever set
        // it up; a real printed report shows those entries in black.
        if (hasOverride) cellEl.style.color = '#000';
        if (RR_NOWRAP_CELLS[coord]) {
          cellEl.style.whiteSpace = 'nowrap';
          cellEl.style.overflow = 'visible';
          cellEl.style.fontSize = RR_NOWRAP_CELLS[coord] + 'pt';
        }
        const rot = (styleData && styleData.align && styleData.align.rot) || 0;
        if (rot && text) {
          const span = document.createElement('span');
          span.className = 'rot-text';
          span.style.transform = `rotate(${-rot}deg)`;
          span.textContent = text;
          cellEl.appendChild(span);
        } else {
          cellEl.textContent = text;
        }
      }

      grid.appendChild(cellEl);
    }
  }
  return grid;
}

// ---------- Report -> cell values ----------
// Coordinates below are load-bearing: they were read off the template and
// checked against a real printed report.

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
// Static template labels the app deliberately renames on the printed form.
const LABEL_OVERRIDES = { I12: 'Short Work Summary' };

// Cells that must stay on one line even though the template marks them
// wrap-enabled, with the size needed to fit. "Short Work Summary" is wider
// than the I12:J12 box that used to hold "Traffic Control", and row 12 is only
// tall enough for one line, so wrapping it just cuts the second line off.
const RR_NOWRAP_CELLS = { I12: 10 };

function buildSheet1Values(report) {
  const v = Object.assign({}, LABEL_OVERRIDES);
  v['Q3'] = report.reportNo != null ? String(report.reportNo) : '';
  v['Q5'] = fmtDate(report.date);
  v['K6'] = report.hours != null && report.hours !== '' ? String(report.hours) : '';
  v['K7'] = report.activity || '';
  v['K8'] = report.notes || '';
  v['B9'] = report.peName || '';
  v['B5'] = report.projectNo || '';
  v['B7'] = report.projectName || '';
  v['K5'] = report.representative || '';
  v['Q7'] = fmtDate(report.ntpDate);
  v['Q9'] = String(calendarDay(report.date, report.ntpDate));

  // Contractor names head their own quantity column (C..H), printed vertically
  // in the merged C5:H11 header cells -- the same columns the equipment
  // quantities below them are keyed to.
  (report.contractors || []).forEach((c, i) => {
    if (i < RR_CONTRACTOR_COLS.length) v[RR_CONTRACTOR_COLS[i] + '5'] = (c && c.name) || '';
  });

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
  // Working conditions and weather are written on the line BELOW their long
  // labels (A36 and A40 hold those labels), starting back at column A --
  // verified against a printed report.
  v['A37'] = report.workingConditions || '';
  v['I37'] = report.trafficControlSelect === 'IN_PLACE' ? 'X' : '';
  v['K37'] = report.trafficControlSelect === 'ATTENTION_REQUIRED' ? 'X' : '';
  v['C39'] = report.workBegin || '';
  v['F39'] = report.workEnd || '';
  v['I39'] = report.repSignatureName || '';
  v['I41'] = report.peSignatureName || '';
  v['A41'] = report.weatherDesc || '';
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

// US Letter, in points -- what the template's page setup targets.
const LETTER_SHORT_PT = 612;
const LETTER_LONG_PT = 792;

// Where one rendered sheet has to land on a real Letter page: the paper size
// for its orientation, and the scale that fits the print area inside the
// template's own margins. The template asks for 80% (work report) and 60%
// (photo log); fitting is computed rather than trusted so the content can
// never run off the page.
function pageGeometry(sheetData) {
  const landscape = sheetData.orientation === 'landscape';
  const pageW = landscape ? LETTER_LONG_PT : LETTER_SHORT_PT;
  const pageH = landscape ? LETTER_SHORT_PT : LETTER_LONG_PT;

  const m = sheetData.marginsPt || { left: 0, right: 0, top: 0, bottom: 0 };
  const availW = pageW - (m.left || 0) - (m.right || 0);
  const availH = pageH - (m.top || 0) - (m.bottom || 0);

  const lastCol = sheetData.lastCol || sheetData.maxCol;
  const lastRow = sheetData.lastRow || sheetData.maxRow;
  const contentW = sheetData.columns.reduce((s, c) => (c.col <= lastCol ? s + c.widthPt : s), 0);
  const contentH = sheetData.rows.reduce((s, r) => (r.row <= lastRow ? s + r.heightPt : s), 0);

  const scale = Math.min(availW / contentW, availH / contentH);
  const drawW = contentW * scale;
  const drawH = contentH * scale;

  return {
    pageW,
    pageH,
    orientation: landscape ? 'landscape' : 'portrait',
    contentW,
    contentH,
    scale,
    drawW,
    drawH,
    // Centred across the printable width, top-aligned like Excel.
    x: (m.left || 0) + (availW - drawW) / 2,
    y: m.top || 0,
  };
}

// Appends one report's two sheet-pages (each a .sheet-page div) into
// `container`. Returns the page elements paired with their page geometry.
function renderReportPages(container, layout, report) {
  const sheets = [
    [layout.dailyWorkReport, buildSheet1Values(report), buildSheet1Images(report)],
    [layout.dailyPhotoLog, buildSheet2Values(report), buildSheet2Images(report)],
  ];

  return sheets.map(([sheetData, values, images]) => {
    const page = document.createElement('div');
    page.className = 'sheet-page';
    page.appendChild(renderSheetGrid(sheetData, values, images));
    container.appendChild(page);
    fitRotatedText(page); // needs layout, so only after it's in the document
    return { el: page, geom: pageGeometry(sheetData) };
  });
}

// Contractor names are typed by the user and can be longer than the vertical
// header box is tall. Excel would just let them run over the grid; shrink them
// to fit instead so a long name can't smear across the equipment table.
function fitRotatedText(scope) {
  $$('.rot-text', scope).forEach((span) => {
    const cell = span.parentElement;
    const avail = cell.clientHeight - 4;
    if (avail <= 0) return;
    let size = parseFloat(getComputedStyle(span).fontSize);
    while (span.scrollWidth > avail && size > 4) {
      size -= 0.5;
      span.style.fontSize = size + 'px';
    }
  });
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
