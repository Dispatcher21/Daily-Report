// Shapes for reports and projects. All of these are just starting points --
// every field stays editable.

// The template's force/equipment table runs rows 12-33: 22 rows, each with a
// label plus one quantity per contractor column. The first 15 carry the
// template's own default labels; the rest start blank.
const EQUIPMENT_ROW_COUNT = 22; // rows 12..33, fixed by the template

const DEFAULT_EQUIPMENT_LABELS = [
  'Superintendent',
  'Project Manager',
  'Foreman',
  'Operators',
  'Laborers',
  'Police officer',
  '',
  '',
  '',
  'Pickup truck',
  'Manlift',
  'Rough terrain crane',
  'Utility trailer',
  'Patrol unit',
  'Attenuator truck',
  '', '', '', '', '', '', '',
];
const CONTRACTOR_COUNT = 6; // fixed by the template
const PAY_ITEM_ROW_COUNT = 6; // fixed by the template

function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// `project` supplies the project-level starting values (from its uploaded
// data file -- Project No./Contract Co./etc, plus optional "default" values
// for most other fields) and `previous` is the most recent report already
// in that SAME project, used to carry forward day-to-day fields like
// representative/hours/contractors/equipment labels the way it always has.
//
// Precedence: fields that already had carry-forward behavior (representative,
// PE name, hours, contractors, equipment labels) keep preferring the
// previous report over the project default, so existing behavior doesn't
// change. Fields newly seedable from the project file (activity, notes,
// working conditions, etc.) just use the project default every time, since
// they never carried forward from a previous report before -- there's
// nothing to regress.
function makeBlankReport(nextReportNo, project, previous) {
  const meta = (project && project.meta) || {};
  const projectContractors = (project && project.defaultContractors) || [];
  const projectEquipmentLabels = (project && project.defaultEquipmentLabels) || [];

  return {
    id: crypto.randomUUID(),
    projectId: project ? project.id : null,
    reportNo: nextReportNo,
    date: todayIso(),
    hours: previous ? previous.hours : '',
    timeEntries: [{ start: '', end: '' }],
    activity: meta.activity || '',
    notes: meta.notes || '',
    peName: previous ? previous.peName : meta.peName || '',
    projectNo: meta.projectNo || '',
    projectName: meta.projectName || '',
    representative: previous ? previous.representative : meta.representative || '',
    ntpDate: meta.ntpDate || '',
    contractors: previous
      ? previous.contractors.map((c) => ({ name: c.name }))
      : Array.from({ length: CONTRACTOR_COUNT }, (_, i) => ({ name: projectContractors[i] || '' })),
    // Always exactly EQUIPMENT_ROW_COUNT rows -- fixed by the template's
    // physical row layout. If the project supplies fewer custom labels than
    // that, the remaining rows are just left blank (not backfilled from the
    // generic default list, which would silently mix unrelated labels in).
    // Carrying forward from an older report pads it out too, since reports
    // saved before the table grew to 22 rows only hold 15.
    equipmentRows: Array.from({ length: EQUIPMENT_ROW_COUNT }, (_, i) => ({
      label: previous
        ? (previous.equipmentRows[i] || {}).label || ''
        : projectEquipmentLabels.length
          ? projectEquipmentLabels[i] || ''
          : DEFAULT_EQUIPMENT_LABELS[i],
      qty: ['', '', '', '', '', ''],
    })),
    // Three distinct blocks on the printed form, top to bottom: the line
    // beside "WORK SUMMARY:", the line under it, then the large box.
    workSummaryHeader: meta.workSummaryHeader || '',
    trafficControlNote: meta.trafficControlNote || '',
    workSummary: meta.workSummary || '',
    payItems: Array.from({ length: PAY_ITEM_ROW_COUNT }, () => ({
      itemNumber: '',
      description: '',
      qty: '',
      unit: '',
    })),
    controllingItem: meta.controllingItem || '',
    commentsOnTime: meta.commentsOnTime || '',
    controllingItemTimeFrom: meta.controllingItemTimeFrom || '',
    controllingItemTimeTo: meta.controllingItemTimeTo || '',
    workingConditions: meta.workingConditions || '',
    trafficControlSelect: meta.trafficControlSelect || null,
    workBegin: meta.workBegin || '',
    workEnd: meta.workEnd || '',
    repSignatureName: previous ? previous.representative : meta.representative || '',
    repSignatureImage: null,
    peSignatureName: previous ? previous.peName : meta.peName || '',
    peSignatureImage: null,
    weatherDesc: meta.weatherDesc || '',
    tempHigh: meta.tempHigh || '',
    tempLow: meta.tempLow || '',
    photos: [null, null, null, null, null, null],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Brings a stored report up to the current shape. Reports saved before the
// force/equipment table grew from 15 rows to the template's full 22 only hold
// 15, and older ones predate the work-summary header field entirely.
function normalizeReport(report) {
  if (!report) return report;
  if (!Array.isArray(report.equipmentRows)) report.equipmentRows = [];
  while (report.equipmentRows.length < EQUIPMENT_ROW_COUNT) {
    report.equipmentRows.push({ label: '', qty: ['', '', '', '', '', ''] });
  }
  report.equipmentRows.length = EQUIPMENT_ROW_COUNT;
  report.equipmentRows.forEach((row) => {
    if (!Array.isArray(row.qty)) row.qty = ['', '', '', '', '', ''];
    while (row.qty.length < CONTRACTOR_COUNT) row.qty.push('');
  });
  if (report.workSummaryHeader == null) report.workSummaryHeader = '';
  return report;
}

// Duplicates a past report as the starting point for a new one. Everything
// carries over EXCEPT what's inherently specific to that one day: the
// report number, date, photos, and the actual signature images (typed
// signer names still carry over -- just not the drawn signature itself).
function copyReport(source, nextReportNo) {
  const copy = JSON.parse(JSON.stringify(source));
  copy.id = crypto.randomUUID();
  copy.reportNo = nextReportNo;
  copy.date = todayIso();
  copy.photos = [null, null, null, null, null, null];
  copy.repSignatureImage = null;
  copy.peSignatureImage = null;
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  return copy;
}

// Builds a new project record from a parsed project-data file (see
// project-file.js) plus the chosen report template bytes.
function makeProjectFromParsedFile(parsed, templateBlob, templateFileName) {
  const meta = parsed.meta || {};
  const displayName = meta.name || (meta.projectNo ? `PR#${meta.projectNo} - ${meta.projectName || 'Project'}` : 'New Project');
  return {
    id: crypto.randomUUID(),
    name: displayName,
    templateBlob,
    templateFileName,
    meta: {
      projectNo: meta.projectNo || '',
      projectName: meta.projectName || '',
      ntpDate: meta.ntpDate || '',
      representative: meta.representative || '',
      peName: meta.peName || '',
      activity: meta.activity || '',
      notes: meta.notes || '',
      workSummaryHeader: meta.workSummaryHeader || '',
      trafficControlNote: meta.trafficControlNote || '',
      workSummary: meta.workSummary || '',
      controllingItem: meta.controllingItem || '',
      commentsOnTime: meta.commentsOnTime || '',
      controllingItemTimeFrom: meta.controllingItemTimeFrom || '',
      controllingItemTimeTo: meta.controllingItemTimeTo || '',
      workingConditions: meta.workingConditions || '',
      trafficControlSelect: meta.trafficControlSelect || '',
      workBegin: meta.workBegin || '',
      workEnd: meta.workEnd || '',
      weatherDesc: meta.weatherDesc || '',
      tempHigh: meta.tempHigh || '',
      tempLow: meta.tempLow || '',
    },
    defaultContractors: parsed.contractors || [],
    defaultEquipmentLabels: parsed.equipmentLabels || [],
    payItemCatalog: parsed.payItemCatalog || [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
