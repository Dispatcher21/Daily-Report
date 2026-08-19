// Path/filename conventions and the master data spreadsheet for OneDrive
// sync. Kept separate from sync-engine.js (which decides *what* to sync and
// *when*) so the "what does this look like in OneDrive" question can be
// tested on its own -- these are pure functions, no network, no auth.

// 'YYYY-MM-DD' -> '2026-08 (August)'. The leading ISO year-month makes the
// folder sort in true chronological order in OneDrive's default alphabetical
// listing; the month name in parentheses keeps it readable at a glance
// rather than looking cryptic to someone just browsing the drive.
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function monthFolderName(isoDate) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(isoDate);
  if (!m) return 'Undated';
  return `${m[1]}-${m[2]} (${MONTH_NAMES[Number(m[2]) - 1]})`;
}

// A report always has a date in practice (defaults.js seeds it to today and
// nothing in the UI clears it), but an older or hand-edited report could
// still carry a blank one -- these fall back to a fixed folder rather than
// silently landing at the project's root.
function dateFolderName(isoDate) {
  return isoDate || 'Undated';
}

// Slugifies free text for use as a OneDrive path segment. Item/graph API
// path segments can't contain \ / : * ? " < > | -- and a project or company
// name typed by hand is exactly the kind of text that tends to carry a
// stray "/" (e.g. "LA Hwy 1/2 Widening").
function pathSafe(text) {
  return String(text || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function reportPdfFilename(project, report) {
  const projectNo = pathSafe((project.meta || {}).projectNo || project.name || 'PR');
  const date = report.date || 'undated';
  return `PR${projectNo}_DailyReport_${date}_R${report.reportNo}.pdf`;
}

function reportPhotoFilename(report, photoIndex) {
  return `R${report.reportNo}_Photo${photoIndex + 1}.jpg`;
}

// Where one report's PDF lives, relative to the project's own OneDrive
// folder: Reports/2026-08 (August)/2026-08-19/
function reportPdfFolderPath(report) {
  return `Reports/${monthFolderName(report.date)}/${dateFolderName(report.date)}`;
}

// Where that same report's photos live: Photos/2026-08 (August)/2026-08-19/
function reportPhotoFolderPath(report) {
  return `Photos/${monthFolderName(report.date)}/${dateFolderName(report.date)}`;
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

// A lean version of a report for the OneDrive Data/ payload. Unlike
// serializeReportForExport (used by the local backup file), this does NOT
// embed photo bytes -- photos already get uploaded as real files under
// Photos/<month>/<date>/ (see reportPhotoFolderPath/reportPhotoFilename),
// so embedding them again here would mean every sync pull re-downloads
// every photo just to check whether a report's text changed. Only a
// manifest of which photo slots are filled travels with the report record
// itself; sync-engine.js downloads the actual files separately, only for
// slots this manifest says are filled. The signature is small enough (a
// line drawing, not a camera photo) that embedding it isn't worth a
// separate round-trip for.
async function buildSyncReportPayload(report) {
  const copy = { ...report };
  copy.photos = (report.photos || []).map((p) => !!p);
  copy.repSignatureImage = await blobFieldToEntry(report.repSignatureImage);
  delete copy.peSignatureImage; // retired field, never round-tripped
  return copy;
}

// One row per report, sorted oldest-first so the sheet reads top-to-bottom
// like a project log. This is the human-facing summary -- it is NOT what
// sync reads back to reconstruct a report; that's the per-report .txt
// payload in Data/. Nothing about this file's shape needs to stay
// backwards-compatible for that reason.
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
