// Shapes for reports and projects. All of these are just starting points --
// every field stays editable.

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
];

const EQUIPMENT_ROW_COUNT = DEFAULT_EQUIPMENT_LABELS.length; // 15, fixed by the template
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
    contractCo: meta.contractCo || '',
    projectLocation: meta.projectLocation || '',
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
    equipmentRows: previous
      ? previous.equipmentRows.map((r) => ({ label: r.label, qty: ['', '', '', '', '', ''] }))
      : Array.from({ length: EQUIPMENT_ROW_COUNT }, (_, i) => ({
          label: projectEquipmentLabels.length ? projectEquipmentLabels[i] || '' : DEFAULT_EQUIPMENT_LABELS[i],
          qty: ['', '', '', '', '', ''],
        })),
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
  const displayName = meta.name || (meta.projectNo ? `PR#${meta.projectNo} - ${meta.projectLocation || 'Project'}` : 'New Project');
  return {
    id: crypto.randomUUID(),
    name: displayName,
    templateBlob,
    templateFileName,
    meta: {
      projectNo: meta.projectNo || '',
      contractCo: meta.contractCo || '',
      projectLocation: meta.projectLocation || '',
      projectName: meta.projectName || '',
      ntpDate: meta.ntpDate || '',
      representative: meta.representative || '',
      peName: meta.peName || '',
      activity: meta.activity || '',
      notes: meta.notes || '',
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
