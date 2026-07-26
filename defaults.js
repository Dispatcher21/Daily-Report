// Project-specific defaults, matching the values already baked into the
// template today. All of these are just starting points -- every field
// stays editable per report.

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

function makeBlankReport(nextReportNo, previous) {
  return {
    id: crypto.randomUUID(),
    reportNo: nextReportNo,
    date: todayIso(),
    hours: previous ? previous.hours : '',
    timeEntries: [{ start: '', end: '' }],
    activity: '',
    notes: '',
    peName: previous ? previous.peName : 'Elizabeth Guiza',
    projectNo: previous ? previous.projectNo : '439',
    contractCo: previous ? previous.contractCo : 'HIGHWAY GRAPHICS',
    projectLocation: previous ? previous.projectLocation : 'Causeway PD',
    projectName: previous ? previous.projectName : 'PAVEMENT MARKING OF BRIDGE DECK AND ROADWAY',
    representative: previous ? previous.representative : 'JOHN SONNIER',
    ntpDate: previous ? previous.ntpDate : '2026-05-22',
    contractors: previous
      ? previous.contractors.map((c) => ({ name: c.name }))
      : Array.from({ length: CONTRACTOR_COUNT }, () => ({ name: '' })),
    equipmentRows: previous
      ? previous.equipmentRows.map((r) => ({ label: r.label, qty: ['', '', '', '', '', ''] }))
      : DEFAULT_EQUIPMENT_LABELS.map((label) => ({ label, qty: ['', '', '', '', '', ''] })),
    trafficControlNote: '',
    workSummary: '',
    payItems: Array.from({ length: PAY_ITEM_ROW_COUNT }, () => ({
      itemNumber: '',
      description: '',
      qty: '',
      unit: '',
    })),
    controllingItem: '',
    commentsOnTime: '',
    controllingItemTimeFrom: '',
    controllingItemTimeTo: '',
    workingConditions: '',
    trafficControlSelect: null,
    workBegin: '',
    workEnd: '',
    repSignatureName: previous ? previous.representative : 'JOHN SONNIER',
    repSignatureImage: null,
    peSignatureName: previous ? previous.peName : 'Elizabeth Guiza',
    peSignatureImage: null,
    weatherDesc: '',
    tempHigh: '',
    tempLow: '',
    photos: [null, null, null, null, null, null],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
