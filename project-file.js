// Parses/generates the "project data" Excel file. This is a small, plain
// data file the user maintains themselves -- completely separate from the
// actual Daily Work Report *template*, which goes through the byte-
// preserving engine in excel-export.js instead. Uses SheetJS (global
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
  { key: 'contractCo', label: 'CONTRACT CO.' },
  { key: 'projectLocation', label: 'PROJECT LOCATION' },
  { key: 'projectName', label: 'PROJECT NAME' },
  { key: 'ntpDate', label: 'NTP DATE' },
  { key: 'representative', label: 'REPRESENTATIVE' },
  { key: 'peName', label: 'PE NAME' },
  { key: 'activity', label: 'DEFAULT ACTIVITY' },
  { key: 'notes', label: 'DEFAULT NOTES' },
  { key: 'trafficControlNote', label: 'DEFAULT TRAFFIC CONTROL NOTE' },
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

// Reads FIELD | VALUE rows, matched by label text (not position), so a
// reordered or lightly-edited file still parses correctly. "DEFAULT
// TRAFFIC CONTROL STATUS" is normalized from natural text ("In Place") to
// the internal value the report form uses.
function parseProjectInfoSheet(ws) {
  if (!ws) return {};
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const result = {};
  for (const row of rows) {
    if (!row || row[0] == null) continue;
    const label = String(row[0]).trim().toUpperCase();
    const field = PROJECT_INFO_FIELDS.find((f) => f.label === label);
    if (!field || row[1] == null || String(row[1]).trim() === '') continue;
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

// Reads an ITEM NUMBER / DESCRIPTION / UNIT table, columns resolved by
// header label so column order doesn't matter.
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

  const items = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const itemNumber = cItem !== -1 && row[cItem] != null ? String(row[cItem]).trim() : '';
    const description = cDesc !== -1 && row[cDesc] != null ? String(row[cDesc]).trim() : '';
    const unit = cUnit !== -1 && row[cUnit] != null ? String(row[cUnit]).trim() : '';
    if (!itemNumber && !description) continue;
    items.push({ itemNumber, description, unit });
  }
  return items;
}

// Reads a simple single-column list of names/labels (optional header row
// tolerated but not required -- any non-empty cell in column A counts).
function parseSingleColumnList(ws, headerLabel, maxCount) {
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const values = [];
  for (const row of rows) {
    if (!row || row[0] == null) continue;
    const text = String(row[0]).trim();
    if (!text || text.toUpperCase() === headerLabel) continue;
    values.push(text);
    if (values.length >= maxCount) break;
  }
  return values;
}

async function parseProjectDataFile(file) {
  const wb = await readWorkbookFromFile(file);
  const meta = parseProjectInfoSheet(findSheet(wb, PROJECT_INFO_SHEET));
  const payItemCatalog = parsePayItemsSheet(findSheet(wb, PAY_ITEMS_SHEET));
  const contractors = parseSingleColumnList(findSheet(wb, CONTRACTORS_SHEET), 'CONTRACTOR NAME', 6);
  const equipmentLabels = parseSingleColumnList(findSheet(wb, EQUIPMENT_ROWS_SHEET), 'LABEL', 15);
  return { meta, payItemCatalog, contractors, equipmentLabels };
}

function downloadProjectDataTemplate() {
  const wb = XLSX.utils.book_new();

  const infoRows = [
    ['FIELD', 'VALUE'],
    ['PROJECT DISPLAY NAME', 'PR#440 - Downtown Bridge'],
    ['PROJECT NO.', '440'],
    ['CONTRACT CO.', 'ABC CONTRACTING LLC'],
    ['PROJECT LOCATION', 'Downtown District'],
    ['PROJECT NAME', 'BRIDGE DECK REPAIR'],
    ['NTP DATE', '2026-08-01'],
    ['REPRESENTATIVE', 'JOHN SONNIER'],
    ['PE NAME', 'Elizabeth Guiza'],
    ['DEFAULT ACTIVITY', ''],
    ['DEFAULT NOTES', ''],
    ['DEFAULT TRAFFIC CONTROL NOTE', ''],
    ['DEFAULT WORK SUMMARY', ''],
    ['DEFAULT CONTROLLING ITEM', ''],
    ['DEFAULT COMMENTS ON TIME CHARGED', ''],
    ['DEFAULT CONTROLLING ITEM TIME FROM', ''],
    ['DEFAULT CONTROLLING ITEM TIME TO', ''],
    ['DEFAULT WORKING CONDITIONS', ''],
    ['DEFAULT TRAFFIC CONTROL STATUS', ''], // "In Place" or "Attention Required", leave blank for neither
    ['DEFAULT WORK BEGIN', ''],
    ['DEFAULT WORK END', ''],
    ['DEFAULT WEATHER DESCRIPTION', ''],
    ['DEFAULT TEMP HIGH', ''],
    ['DEFAULT TEMP LOW', ''],
  ];
  const infoWs = XLSX.utils.aoa_to_sheet(infoRows);
  infoWs['!cols'] = [{ wch: 34 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(wb, infoWs, PROJECT_INFO_SHEET);

  const itemRows = [
    ['ITEM NUMBER', 'DESCRIPTION', 'UNIT'],
    ['618-01', 'Thermoplastic Pavement Marking 4in', 'LF'],
    ['618-02', 'Thermoplastic Pavement Marking 24in', 'LF'],
    ['619-01', 'Raised Pavement Markers', 'EA'],
  ];
  const itemsWs = XLSX.utils.aoa_to_sheet(itemRows);
  itemsWs['!cols'] = [{ wch: 14 }, { wch: 38 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, itemsWs, PAY_ITEMS_SHEET);

  const contractorRows = [['CONTRACTOR NAME'], ['ABC Trucking'], ['XYZ Barricades'], [''], [''], [''], ['']];
  const contractorsWs = XLSX.utils.aoa_to_sheet(contractorRows);
  contractorsWs['!cols'] = [{ wch: 30 }];
  XLSX.utils.book_append_sheet(wb, contractorsWs, CONTRACTORS_SHEET);

  const equipRows = [
    ['LABEL'],
    ['Superintendent'],
    ['Project Manager'],
    ['Foreman'],
    ['Operators'],
    ['Laborers'],
    ['Police officer'],
    [''],
    [''],
    [''],
    ['Pickup truck'],
    ['Manlift'],
    ['Rough terrain crane'],
    ['Utility trailer'],
    ['Patrol unit'],
    ['Attenuator truck'],
  ];
  const equipWs = XLSX.utils.aoa_to_sheet(equipRows);
  equipWs['!cols'] = [{ wch: 26 }];
  XLSX.utils.book_append_sheet(wb, equipWs, EQUIPMENT_ROWS_SHEET);

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  triggerDownload(
    new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    'ProjectData_Template.xlsx'
  );
}
