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
// the app writes can't drift from the format it reads.
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
