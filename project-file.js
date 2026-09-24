// Parses/generates the "project data" Excel file. This is a small, plain
// data file the user maintains themselves -- completely separate from the
// actual Daily Work Report *template*, which goes through the byte-
// project data file -- not the report template. Uses SheetJS (global
// `XLSX`, lib/xlsx.min.js) since we're just reading/writing a simple data
// file here, not preserving an existing file's formatting.
//
// Covers every field a report has, so the user can seed as much or as
// little as they want per project -- anything left blank just stays blank
// on new reports, same as if it was never in the file at all.

const PROJECT_INFO_SHEET = 'PROJECT INFO';
const PAY_ITEMS_SHEET = 'PAY ITEMS';
const CONTRACTORS_SHEET = 'CONTRACTORS';
const EQUIPMENT_ROWS_SHEET = 'EQUIPMENT ROWS';

// key: field on project.meta / used to seed a new report.
// label: the text expected in column A of the PROJECT INFO sheet.
const PROJECT_INFO_FIELDS = [
  { key: 'name', label: 'PROJECT DISPLAY NAME' },
  { key: 'projectNo', label: 'PROJECT NO.' },
  { key: 'projectName', label: 'PROJECT NAME' },
  { key: 'location', label: 'PROJECT LOCATION (CITY, STATE)' },
  { key: 'ntpDate', label: 'NTP DATE' },
  { key: 'contractLength', label: 'TOTAL CONTRACT LENGTH (DAYS)' },
  { key: 'representative', label: 'REPRESENTATIVE' },
  { key: 'peName', label: 'PE NAME' },
  { key: 'activity', label: 'DEFAULT ACTIVITY' },
  { key: 'notes', label: 'DEFAULT NOTES' },
  { key: 'workSummaryHeader', label: 'DEFAULT WORK SUMMARY TOP LINE' },
  { key: 'trafficControlNote', label: 'DEFAULT SHORT WORK SUMMARY' },
  { key: 'workSummary', label: 'DEFAULT WORK SUMMARY' },
  { key: 'controllingItem', label: 'DEFAULT CONTROLLING ITEM' },
  { key: 'commentsOnTime', label: 'DEFAULT COMMENTS ON TIME CHARGED' },
  { key: 'controllingItemTimeFrom', label: 'DEFAULT CONTROLLING ITEM TIME FROM' },
  { key: 'controllingItemTimeTo', label: 'DEFAULT CONTROLLING ITEM TIME TO' },
  { key: 'workingConditions', label: 'DEFAULT WORKING CONDITIONS' },
  { key: 'trafficControlSelect', label: 'DEFAULT TRAFFIC CONTROL STATUS' }, // "In Place" / "Attention Required"
  { key: 'workBegin', label: 'DEFAULT WORK BEGIN' },
  { key: 'workEnd', label: 'DEFAULT WORK END' },
  { key: 'weatherDesc', label: 'DEFAULT WEATHER DESCRIPTION' },
  { key: 'tempHigh', label: 'DEFAULT TEMP HIGH' },
  { key: 'tempLow', label: 'DEFAULT TEMP LOW' },
];

function readWorkbookFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        resolve(XLSX.read(data, { type: 'array', cellDates: false }));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function findSheet(workbook, name) {
  const sheetName = workbook.SheetNames.find((n) => n.trim().toUpperCase() === name);
  return sheetName ? workbook.Sheets[sheetName] : null;
}

function isoDate(y, m, d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Every date input and calculation elsewhere in the app (the report editor's
// date field, the dashboard's "days since NTP") needs 'YYYY-MM-DD' -- but a
// cell someone typed a date into rarely comes through that way. A cell
// actually formatted as a date reads back as an Excel serial number (days
// since 1899-12-30) since the file is read with cellDates:false; a cell
// someone just typed text into carries whatever format they reached for,
// which for most people is M/D/YYYY, not ISO.
function normalizeDateValue(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  if (typeof value === 'number' && isFinite(value)) {
    const d = XLSX.SSF.parse_date_code(value);
    return d ? isoDate(d.y, d.m, d.d) : '';
  }

  const str = String(value).trim();
  if (!str) return '';

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(str);
  if (m) return isoDate(+m[1], +m[2], +m[3]);

  // M/D/YYYY (or M-D-YYYY, or a 2-digit year) -- the format most people
  // reach for by default when typing a date into a spreadsheet cell.
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(str);
  if (m) {
    let year = +m[3];
    if (year < 100) year += year < 70 ? 2000 : 1900;
    let month = +m[1];
    let day = +m[2];
    if (month > 12 && day <= 12) [month, day] = [day, month]; // was actually D/M/Y
    // Neither reading works (e.g. "22/13/2026") -- leave the original text
    // alone rather than emit something ISO-shaped but not an actual date.
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return isoDate(year, month, day);
    return str;
  }

  return str; // unrecognized -- leave as-is rather than silently discarding it
}

// Reads FIELD | VALUE rows, matched by label text (not position), so a
// reordered or lightly-edited file still parses correctly. "DEFAULT
// TRAFFIC CONTROL STATUS" is normalized from natural text ("In Place") to
// the internal value the report form uses; "NTP DATE" is normalized to ISO.
function parseProjectInfoSheet(ws) {
  if (!ws) return {};
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const result = {};
  for (const row of rows) {
    if (!row || row[0] == null) continue;
    const label = String(row[0]).trim().toUpperCase();
    const field = PROJECT_INFO_FIELDS.find((f) => f.label === label);
    if (!field || row[1] == null || String(row[1]).trim() === '') continue;

    if (field.key === 'ntpDate') {
      const normalized = normalizeDateValue(row[1]);
      if (normalized) result[field.key] = normalized;
      continue;
    }

    let value = String(row[1]).trim();
    if (field.key === 'trafficControlSelect') {
      const v = value.toUpperCase().replace(/[^A-Z]/g, '_');
      if (v.includes('ATTENTION')) value = 'ATTENTION_REQUIRED';
      else if (v.includes('IN_PLACE') || v.includes('PLACE')) value = 'IN_PLACE';
      else continue;
    }
    result[field.key] = value;
  }
  return result;
}

// Reads an ITEM NUMBER / DESCRIPTION / UNIT (/ PER PLANS TOTAL) table,
// columns resolved by header label so column order doesn't matter.
function parsePayItemsSheet(ws) {
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  let headerIdx = rows.findIndex(
    (row) => Array.isArray(row) && row.some((c) => c && String(c).trim().toUpperCase().startsWith('ITEM NUM'))
  );
  if (headerIdx === -1) headerIdx = 0;
  const header = rows[headerIdx] || [];
  const findCol = (labels) => {
    for (let i = 0; i < header.length; i++) {
      const h = header[i] ? String(header[i]).trim().toUpperCase() : '';
      if (labels.includes(h)) return i;
    }
    return -1;
  };
  const cItem = findCol(['ITEM NUMBER', 'ITEM #', 'ITEM NO', 'ITEM NO.']);
  const cDesc = findCol(['DESCRIPTION']);
  const cUnit = findCol(['UNIT']);
  // The planned/bid quantity for this item, used by the Quantity Sheet to
  // show percent complete. Optional -- older project files simply won't
  // have it, and that's fine (percent complete just stays blank for those).
  const cPlanned = findCol(['PER PLANS TOTAL', 'PLANNED QUANTITY', 'PLAN QTY']);
  // The bid unit price, used by the project dashboard to show each item's
  // contract value (planned qty x price) and $ earned to date (used qty x
  // price). Optional, same as above -- dollar figures just stay blank.
  const cPrice = findCol(['UNIT PRICE', 'BID UNIT PRICE', 'PRICE']);
  // All five optional, sit after pricing in the sheet. STATIONS: a bare
  // "Y" turns on Start/Stop Station fields for this item when logging a
  // quantity. LOCATIONS: one location name per line in the cell (Alt+Enter
  // in Excel) populates a dropdown for assigning that day's quantity to a
  // spot. SIDE: a bare "Y" turns on a fixed Lt/Rt/Ctr dropdown, the same
  // way STATIONS does -- unlike Locations, the side of the road isn't a
  // per-project custom list, so there's nothing to read beyond the toggle.
  // COMPUTED: a bare "Y" swaps the plain Qty field for Length/Width fields
  // that multiply out to Qty automatically (Sq Yd/Sq Ft area math) -- if
  // Stations is also on for the item, Length starts out as the station
  // span and Qty as Length x Width, both still hand-editable afterward.
  // THEORETICAL: a bare "Y" adds a hand-entered Theoretical Qty field next
  // to Qty, so each entry line shows an Overrun/Underrun (Qty minus
  // Theoretical) -- there's no formula for this in general (it depends on
  // mix design/density for something like asphalt tonnage), so it's just
  // typed in the same as Qty itself.
  // Any of the five enables logging the same item more than once per
  // report (different segments/locations/sides/measurements the same day).
  const cStations = findCol(['STATIONS', 'STATION', 'TRACK STATIONS']);
  const cLocations = findCol(['LOCATIONS', 'LOCATION']);
  const cSide = findCol(['SIDE', 'TRACK SIDE']);
  const cComputed = findCol(['COMPUTED', 'COMPUTED QTY', 'CALC QTY']);
  const cTheoretical = findCol(['THEORETICAL', 'THEORETICAL QTY']);

  const items = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const itemNumber = cItem !== -1 && row[cItem] != null ? String(row[cItem]).trim() : '';
    const description = cDesc !== -1 && row[cDesc] != null ? String(row[cDesc]).trim() : '';
    const unit = cUnit !== -1 && row[cUnit] != null ? String(row[cUnit]).trim() : '';
    const plannedQty = cPlanned !== -1 && row[cPlanned] != null ? String(row[cPlanned]).trim() : '';
    const unitPrice = cPrice !== -1 && row[cPrice] != null ? String(row[cPrice]).trim() : '';
    const stations = cStations !== -1 && row[cStations] != null && /^y(es)?$/i.test(String(row[cStations]).trim());
    const locations = cLocations !== -1 && row[cLocations] != null
      ? String(row[cLocations]).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      : [];
    const side = cSide !== -1 && row[cSide] != null && /^y(es)?$/i.test(String(row[cSide]).trim());
    const computed = cComputed !== -1 && row[cComputed] != null && /^y(es)?$/i.test(String(row[cComputed]).trim());
    const theoretical = cTheoretical !== -1 && row[cTheoretical] != null && /^y(es)?$/i.test(String(row[cTheoretical]).trim());
    if (!itemNumber && !description) continue;
    items.push({ itemNumber, description, unit, plannedQty, unitPrice, stations, locations, side, computed, theoretical });
  }
  return items;
}

// Reads a simple single-column list of names/labels (optional header row
// tolerated but not required).
//
// Position is meaningful in both of these lists -- a contractor's slot picks
// its quantity column on the report, and an equipment label's slot picks its
// row -- so a blank line is a deliberately empty slot, NOT a row to skip.
// Skipping them shifted every later entry up by one.
function parseSingleColumnList(ws, headerLabel, maxCount) {
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  let start = 0;
  for (let i = 0; i < rows.length; i++) {
    const cell = rows[i] && rows[i][0] != null ? String(rows[i][0]).trim() : '';
    if (!cell) continue;
    start = cell.toUpperCase() === headerLabel ? i + 1 : i;
    break;
  }

  const values = [];
  for (let i = start; i < rows.length && values.length < maxCount; i++) {
    const row = rows[i];
    values.push(row && row[0] != null ? String(row[0]).trim() : '');
  }
  // Trailing blanks carry no information, unlike interior ones.
  while (values.length && values[values.length - 1] === '') values.pop();
  return values;
}

// ---------- Pay App Quantities file (quantity-sheet.html) ----------
//
// The ONE place billing history round-trips through Excel -- Project Data
// (above) used to have its own ESTIMATES sheet for this, but that never
// carried anything beyond ESTIMATE NO./DATE/NOTE (never approval status,
// comments, or actual figures) and nothing in the app ever pointed anyone
// at it to fill in up front, so it just sat there unused. Removed rather
// than kept alongside this one, to avoid two different files both claiming
// to be "the" way to get Pay App data into the app.
//
// One sheet, one purpose: a grid of Pay App figures, one row per Pay App
// and one column per pay item (header = item number, the same key
// itemTotals already uses internally). Kept as its own file rather than
// folded into Project Data specifically so filling in Pay App numbers
// day-to-day never risks also overwriting the project's meta/pay item
// catalog/contractors/equipment the way re-uploading that file would --
// this one only ever touches billingEstimates, merged by estimateNo via
// mergeBillingEstimates in defaults.js.
//
// Built with ExcelJS, not the SheetJS (XLSX global) used by every other
// sheet in this file -- the community SheetJS build here silently drops
// cell styling, formulas, and freeze panes (confirmed by inspecting its
// own output: no <b/> in styles.xml, no <f> tags, no <pane> element), so a
// bold/frozen header and live running-total formulas simply aren't
// reachable through it. ExcelJS is what quantity-sheet-export.js already
// uses for the same reason -- this reuses its BRAND_FILL/GRID_BORDER/
// styleHeaderRow/styleDataRows helpers and depends on the same global
// ExcelJS (lib/exceljs.min.js) and quantity-calc.js (isLumpSumUnit/
// earnedTotalFor) it does. Safe here specifically because
// buildPayAppQuantitiesWorkbook/downloadPayAppQuantitiesFile are only ever
// called from quantity-sheet.html, the one page that loads all three --
// project.html/settings.html/index.html also load this file but never
// call these two functions, so they're never affected by not having
// ExcelJS loaded.
//
// The sheet itself has two header rows, not one: row 1 is the real,
// parsed header (ESTIMATE NO./DATE/NOTE/item numbers/a trailing computed
// total column); row 2 is a human-only annotation -- each item's
// description and unit, so filling this in doesn't require the PAY ITEMS
// sheet open side by side to know what "618-01" means. Row 2 (and the
// running-totals row at the bottom) both leave ESTIMATE NO. and DATE
// blank, which is what makes parsePayAppQuantitiesSheet's own "needs an
// estimateNo or date to count as a real row" check skip them automatically
// -- no parser change needed for either one.
const PAY_APP_QUANTITIES_SHEET = 'PAY APPS';
const PAY_APP_TOTAL_COL_LABEL = 'TOTAL $ THIS PAY APP';

function excelColLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// itemNumbers: current catalog items first, in their usual order -- then
// any item number that shows up in a real billingEstimate but ISN'T in the
// catalog anymore (renumbered or removed after it was already billed
// against). Skipping those would mean this export has no column for a
// real, already-recorded figure -- and since mergeBillingEstimates treats
// "this file's itemTotals" as the complete picture for whatever it does
// cover, re-uploading that same file unmodified would read back as the
// user having deleted that figure, silently wiping it (and resetting the
// Pay App's approval status as a side effect) even though nothing was
// actually changed.
function payAppItemNumbers(payItemCatalog, billingEstimates) {
  const itemNumbers = (payItemCatalog || []).map((it) => it.itemNumber || '').filter(Boolean);
  const knownItems = new Set(itemNumbers);
  (billingEstimates || []).forEach((e) => {
    Object.keys(e.itemTotals || {}).forEach((num) => {
      if (!knownItems.has(num)) {
        knownItems.add(num);
        itemNumbers.push(num);
      }
    });
  });
  return itemNumbers;
}

async function buildPayAppQuantitiesWorkbook(payItemCatalog, billingEstimates) {
  const catalog = payItemCatalog || [];
  const estimates = billingEstimates || [];
  const catalogByNumber = new Map(catalog.map((it) => [it.itemNumber, it]));
  const itemNumbers = payAppItemNumbers(catalog, estimates);
  const lastCol = 3 + itemNumbers.length + 1; // ESTIMATE NO./DATE/NOTE + items + the trailing total column

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(PAY_APP_QUANTITIES_SHEET, { views: [{ state: 'frozen', xSplit: 3, ySplit: 2 }] });
  ws.columns = [
    { width: 14 }, { width: 14 }, { width: 30 },
    ...itemNumbers.map(() => ({ width: 13 })),
    { width: 20 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.getCell(1).value = 'ESTIMATE NO.';
  headerRow.getCell(2).value = 'DATE';
  headerRow.getCell(3).value = 'NOTE';
  itemNumbers.forEach((num, i) => { headerRow.getCell(4 + i).value = num; });
  headerRow.getCell(lastCol).value = PAY_APP_TOTAL_COL_LABEL;
  styleHeaderRow(ws, 1, lastCol);

  const descRow = ws.getRow(2);
  descRow.getCell(3).value = 'Item description / unit ↓';
  itemNumbers.forEach((num, i) => {
    const cat = catalogByNumber.get(num);
    const label = !cat
      ? '(item removed from catalog)'
      : isLumpSumUnit(cat.unit)
        ? `${cat.description || ''} (Lump Sum, $)`.trim()
        : `${cat.description || ''} (${cat.unit || ''})`.trim();
    descRow.getCell(4 + i).value = label;
  });
  descRow.getCell(lastCol).value = 'Auto-calculated -- do not type here';
  for (let c = 1; c <= lastCol; c++) {
    const cell = descRow.getCell(c);
    cell.font = { italic: true, color: { argb: 'FF6B7280' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F5F7' } };
    cell.border = { top: GRID_BORDER, left: GRID_BORDER, bottom: GRID_BORDER, right: GRID_BORDER };
  }
  descRow.height = 26;
  descRow.alignment = { wrapText: true, vertical: 'middle' };

  estimates.forEach((e) => {
    const rowVals = [e.estimateNo || '', e.date || '', e.note || ''];
    let totalDollars = 0;
    let anyPriced = false;
    itemNumbers.forEach((num) => {
      const total = e.itemTotals && e.itemTotals[num] != null ? e.itemTotals[num] : null;
      rowVals.push(total);
      const cat = catalogByNumber.get(num);
      if (cat && total != null) {
        const unitPrice = cat.unitPrice !== '' && cat.unitPrice != null && isFinite(Number(cat.unitPrice)) ? Number(cat.unitPrice) : null;
        const earned = earnedTotalFor(cat.unit, Number(total), unitPrice);
        if (earned != null) { totalDollars += earned; anyPriced = true; }
      }
    });
    rowVals.push(anyPriced ? Math.round(totalDollars * 100) / 100 : null);
    ws.addRow(rowVals);
  });

  if (estimates.length > 0) {
    const firstDataRow = 3;
    const lastDataRow = 2 + estimates.length;
    styleDataRows(ws, firstDataRow, lastDataRow, lastCol);
    ws.getColumn(lastCol).numFmt = '$#,##0.00';

    // A real Excel formula, not a value computed once at download time --
    // stays correct if a figure is hand-edited afterward, without needing
    // a fresh download to see the new total.
    const totalRow = ws.addRow(['', '', 'TOTAL TO DATE']);
    for (let i = 0; i < itemNumbers.length; i++) {
      const col = 4 + i;
      const letter = excelColLetter(col);
      totalRow.getCell(col).value = { formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})` };
    }
    const totalLetter = excelColLetter(lastCol);
    totalRow.getCell(lastCol).value = { formula: `SUM(${totalLetter}${firstDataRow}:${totalLetter}${lastDataRow})` };
    totalRow.getCell(lastCol).numFmt = '$#,##0.00';
    totalRow.font = { bold: true };
    for (let c = 1; c <= lastCol; c++) {
      totalRow.getCell(c).border = { top: { style: 'double', color: { argb: 'FF1C3D5A' } }, left: GRID_BORDER, bottom: GRID_BORDER, right: GRID_BORDER };
    }
  }

  return wb;
}

async function downloadPayAppQuantitiesFile(project) {
  const wb = await buildPayAppQuantitiesWorkbook(project.payItemCatalog, project.billingEstimates);
  const slug = String(project.name || (project.meta && project.meta.projectNo) || 'project')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  const out = await wb.xlsx.writeBuffer();
  triggerDownload(
    new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `PayApps_${slug || 'project'}.xlsx`
  );
}

// Same header-by-label-not-position approach as this file's other sheet
// parsers -- every header cell that isn't ESTIMATE NO./DATE/NOTE/the
// trailing computed total column is a pay item's quantity (or, for a Lump
// Sum item, a dollar figure -- see pay-apps.html's own itemTotals comment)
// for that row's Pay App. The header text IS the item number, so there's
// no separate lookup against a PAY ITEMS sheet needed to know which item a
// column belongs to. Reads with plain SheetJS (not ExcelJS) since it only
// needs cell values, not styling -- a file ExcelJS wrote is a completely
// ordinary .xlsx, so SheetJS reads it exactly as well as one it wrote
// itself.
function parsePayAppQuantitiesSheet(ws) {
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  let headerIdx = rows.findIndex(
    (row) => Array.isArray(row) && row.some((c) => c && String(c).trim().toUpperCase().startsWith('ESTIMATE'))
  );
  if (headerIdx === -1) headerIdx = 0;
  const header = rows[headerIdx] || [];
  const findCol = (labels) => {
    for (let i = 0; i < header.length; i++) {
      const h = header[i] ? String(header[i]).trim().toUpperCase() : '';
      if (labels.includes(h)) return i;
    }
    return -1;
  };
  const cNo = findCol(['ESTIMATE NO.', 'ESTIMATE NO', 'ESTIMATE #', 'ESTIMATE']);
  const cDate = findCol(['DATE']);
  const cNote = findCol(['NOTE', 'NOTES']);
  const cTotal = findCol([PAY_APP_TOTAL_COL_LABEL.toUpperCase()]);
  const itemCols = [];
  header.forEach((cell, i) => {
    if (i === cNo || i === cDate || i === cNote || i === cTotal) return;
    const itemNumber = cell != null ? String(cell).trim() : '';
    if (itemNumber) itemCols.push({ index: i, itemNumber });
  });

  const estimates = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const estimateNo = cNo !== -1 && row[cNo] != null ? String(row[cNo]).trim() : '';
    const date = cDate !== -1 && row[cDate] != null ? normalizeDateValue(row[cDate]) : '';
    const note = cNote !== -1 && row[cNote] != null ? String(row[cNote]).trim() : '';
    if (!estimateNo && !date) continue;
    const itemTotals = {};
    itemCols.forEach((col) => {
      const raw = row[col.index];
      if (raw == null || String(raw).trim() === '') return;
      const num = Number(raw);
      if (isFinite(num)) itemTotals[col.itemNumber] = num;
    });
    estimates.push({ estimateNo, date, note, itemTotals });
  }
  return estimates;
}

async function parsePayAppQuantitiesFile(file) {
  const wb = await readWorkbookFromFile(file);
  return parsePayAppQuantitiesSheet(findSheet(wb, PAY_APP_QUANTITIES_SHEET));
}

async function parseProjectDataFile(file) {
  const wb = await readWorkbookFromFile(file);
  const meta = parseProjectInfoSheet(findSheet(wb, PROJECT_INFO_SHEET));
  const payItemCatalog = parsePayItemsSheet(findSheet(wb, PAY_ITEMS_SHEET));
  const contractors = parseSingleColumnList(findSheet(wb, CONTRACTORS_SHEET), 'CONTRACTOR NAME', CONTRACTOR_COUNT);
  const equipmentLabels = parseSingleColumnList(findSheet(wb, EQUIPMENT_ROWS_SHEET), 'LABEL', EQUIPMENT_ROW_COUNT);
  return { meta, payItemCatalog, contractors, equipmentLabels };
}

// Builds the four-sheet project data workbook. Both the blank example
// template and the export of a saved project go through here, so the format
// the app writes can't drift from the format it reads. Billing history
// (billingEstimates) never lived here for real -- see the Pay App
// Quantities file above -- so it's not a parameter at all.
function buildProjectDataWorkbook({ meta, payItemCatalog, contractors, equipmentLabels }) {
  const wb = XLSX.utils.book_new();

  const infoRows = [['FIELD', 'VALUE']];
  PROJECT_INFO_FIELDS.forEach((f) => {
    let value = meta && meta[f.key] != null ? String(meta[f.key]) : '';
    // Written back as the natural text the sheet documents, not the internal
    // constant -- parseProjectInfoSheet normalizes it again on the way in.
    if (f.key === 'trafficControlSelect') {
      value = value === 'IN_PLACE' ? 'In Place' : value === 'ATTENTION_REQUIRED' ? 'Attention Required' : '';
    }
    infoRows.push([f.label, value]);
  });
  const infoWs = XLSX.utils.aoa_to_sheet(infoRows);
  infoWs['!cols'] = [{ wch: 34 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(wb, infoWs, PROJECT_INFO_SHEET);

  const itemRows = [['ITEM NUMBER', 'DESCRIPTION', 'UNIT', 'PER PLANS TOTAL', 'UNIT PRICE', 'STATIONS', 'LOCATIONS', 'SIDE', 'COMPUTED', 'THEORETICAL']];
  (payItemCatalog || []).forEach((it) => {
    itemRows.push([
      it.itemNumber || '', it.description || '', it.unit || '', it.plannedQty || '', it.unitPrice || '',
      it.stations ? 'Y' : '', (it.locations || []).join('\n'), it.side ? 'Y' : '', it.computed ? 'Y' : '', it.theoretical ? 'Y' : '',
    ]);
  });
  const itemsWs = XLSX.utils.aoa_to_sheet(itemRows);
  itemsWs['!cols'] = [{ wch: 14 }, { wch: 38 }, { wch: 8 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 24 }, { wch: 8 }, { wch: 10 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, itemsWs, PAY_ITEMS_SHEET);

  const contractorRows = [['CONTRACTOR NAME']];
  for (let i = 0; i < CONTRACTOR_COUNT; i++) contractorRows.push([(contractors || [])[i] || '']);
  const contractorsWs = XLSX.utils.aoa_to_sheet(contractorRows);
  contractorsWs['!cols'] = [{ wch: 30 }];
  XLSX.utils.book_append_sheet(wb, contractorsWs, CONTRACTORS_SHEET);

  const equipRows = [['LABEL']];
  for (let i = 0; i < EQUIPMENT_ROW_COUNT; i++) equipRows.push([(equipmentLabels || [])[i] || '']);
  const equipWs = XLSX.utils.aoa_to_sheet(equipRows);
  equipWs['!cols'] = [{ wch: 26 }];
  XLSX.utils.book_append_sheet(wb, equipWs, EQUIPMENT_ROWS_SHEET);

  return wb;
}

function writeProjectWorkbook(wb, filename) {
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  triggerDownload(
    new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename
  );
}

// Blank starting point, with example values so the expected format is obvious.
function downloadProjectDataTemplate() {
  const wb = buildProjectDataWorkbook({
    meta: {
      name: 'This Appears on the App Front Page',
      projectNo: '###',
      projectName: '',
      ntpDate: '6/22/2026', // any of 6/22/2026, 06-22-2026 or 2026-06-22 parses fine
      contractLength: '180', // calendar days allowed by the contract, from NTP
      representative: 'JOHN JACOB JINGLHIMER SMITH',
      peName: 'NOTTA RE-AL ENJINIR',
    },
    payItemCatalog: [
      { itemNumber: '618-01', description: 'Thermoplastic Pavement Marking 4in', unit: 'LF', plannedQty: '12000', unitPrice: '1.10', stations: true, locations: [], side: true, computed: false, theoretical: false },
      { itemNumber: '618-02', description: 'Thermoplastic Pavement Marking 24in', unit: 'LF', plannedQty: '3500', unitPrice: '4.50', stations: false, locations: ['North Approach', 'Mid Span', 'South Approach'], side: false, computed: false, theoretical: false },
      { itemNumber: '619-01', description: 'Raised Pavement Markers', unit: 'EA', plannedQty: '450', unitPrice: '3.25', stations: false, locations: [], side: false, computed: false, theoretical: false },
      { itemNumber: '202-02-06100', description: 'Removal of Concrete Walks and Drives', unit: 'SQ YD', plannedQty: '500', unitPrice: '18.00', stations: true, locations: [], side: false, computed: true, theoretical: false },
      { itemNumber: '502-01-00100', description: 'Asphalt Concrete', unit: 'TON', plannedQty: '2000', unitPrice: '95.00', stations: true, locations: [], side: true, computed: false, theoretical: true },
    ],
    contractors: ['ABC Trucking', 'XYZ Barricades'],
    equipmentLabels: DEFAULT_EQUIPMENT_LABELS,
  });
  writeProjectWorkbook(wb, 'ProjectData_Template.xlsx');
}

// Exports a saved project back out in the same format it was uploaded in, so
// it can be edited, backed up, or carried to another device and re-uploaded.
function downloadProjectDataFile(project) {
  const wb = buildProjectDataWorkbook({
    // project.name is stored on the project itself, not inside meta.
    meta: Object.assign({}, project.meta, { name: project.name }),
    payItemCatalog: project.payItemCatalog,
    contractors: project.defaultContractors,
    equipmentLabels: project.defaultEquipmentLabels,
  });
  const slug = String(project.name || project.meta.projectNo || 'project')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  writeProjectWorkbook(wb, `ProjectData_${slug || 'project'}.xlsx`);
}
