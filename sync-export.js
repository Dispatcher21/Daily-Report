// Builds the project summary spreadsheet used by "Sync Selected" on the
// Reports page (see reports.html) -- a human-readable, one-row-per-report
// log to go alongside the .report bundles when sharing a project's data
// elsewhere. Pure functions, no network, no storage of its own.

// Slugifies free text for use as a filename/path segment -- a project or
// company name typed by hand is exactly the kind of text that tends to
// carry a stray "/" (e.g. "LA Hwy 1/2 Widening").
function pathSafe(text) {
  return String(text || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function projectFolderName(project) {
  return pathSafe(project.name || (project.meta || {}).projectNo || 'Project');
}

function masterSpreadsheetFilename(project) {
  return `${projectFolderName(project)}_Data.xlsx`;
}

// Human-readable summary of an array field that isn't worth its own column
// per entry -- exploding 22 equipment rows or 6 pay items into individual
// columns would make this file exactly the unreadable wall of columns it's
// meant to not be. One glance at a cell like "618-01: 250 LF; 619-04: 12 EA"
// tells a person what happened without opening the report itself.
function summarizePayItems(payItems) {
  return (payItems || [])
    .filter((it) => it && String(it.itemNumber || '').trim())
    .map((it) => `${it.itemNumber}: ${it.qty || 0} ${it.unit || ''}`.trim())
    .join('; ');
}
function summarizeContractors(contractors) {
  return (contractors || [])
    .map((c) => c && c.name)
    .filter(Boolean)
    .join('; ');
}

const MASTER_SHEET_HEADER = [
  'Report #', 'Date', 'Hours', 'Representative', 'PE Name',
  'Activity', 'Notes', 'Contractors', 'Pay Items',
  'Traffic Control Status', 'Working Conditions',
  'Weather', 'Temp High', 'Temp Low',
  'Work Begin', 'Work End', 'Photo Count',
];

function reportToMasterRow(report) {
  return [
    report.reportNo != null ? report.reportNo : '',
    report.date || '',
    report.hours != null && report.hours !== '' ? Number(report.hours) : '',
    report.representative || '',
    report.peName || '',
    report.activity || '',
    report.notes || '',
    summarizeContractors(report.contractors),
    summarizePayItems(report.payItems),
    report.trafficControlSelect === 'IN_PLACE' ? 'In Place'
      : report.trafficControlSelect === 'ATTENTION_REQUIRED' ? 'Attention Required' : '',
    report.workingConditions || '',
    report.weatherDesc || '',
    report.tempHigh || '',
    report.tempLow || '',
    report.workBegin || '',
    report.workEnd || '',
    (report.photos || []).filter(Boolean).length,
  ];
}

// One row per report, sorted oldest-first so the sheet reads top-to-bottom
// like a project log.
function buildMasterWorkbook(project, reports) {
  const sorted = (reports || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const rows = [MASTER_SHEET_HEADER, ...sorted.map(reportToMasterRow)];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 9 }, { wch: 11 }, { wch: 7 }, { wch: 20 }, { wch: 20 },
    { wch: 32 }, { wch: 32 }, { wch: 26 }, { wch: 32 },
    { wch: 16 }, { wch: 26 },
    { wch: 22 }, { wch: 9 }, { wch: 9 },
    { wch: 10 }, { wch: 10 }, { wch: 11 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Reports');
  return wb;
}
