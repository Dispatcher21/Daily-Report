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
// How many pay item rows the printed table itself has room for -- not a cap
// on how many a report can hold. A report can carry more; render-report.js
// prints the first PAY_ITEM_ROW_COUNT in the table and lists the rest as
// extra lines in the Summary of Work Performed box. Also the number of
// blank rows a brand-new report starts with in the editor.
const PAY_ITEM_ROW_COUNT = 6;

function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A "No Work Day" is just an otherwise-blank report whose Notes says so --
// there's no separate flag, so a report only counts as one if this is the
// entirety of its Notes (trimmed, case-insensitive), not merely mentioned
// inside other notes text.
const NO_WORK_DAY_NOTE = 'NO WORK DAY';
function isNoWorkDayReport(report) {
  return !!report && (report.notes || '').trim().toUpperCase() === NO_WORK_DAY_NOTE;
}

// Same idea as a No Work Day, but for a day lost specifically to weather
// (the contract-time-extension sense of the term) rather than blank for any
// other reason -- same otherwise-blank-apart-from-Notes convention.
const WEATHER_DAY_NOTE = 'WEATHER DAY';
function isWeatherDayReport(report) {
  return !!report && (report.notes || '').trim().toUpperCase() === WEATHER_DAY_NOTE;
}

// True for a catalog item that tracks Start/Stop Station, Side, and/or has a
// Locations list (see the STATIONS/LOCATIONS/SIDE columns in project-file.js).
// These can legitimately show up more than once on the same report --
// different segments/spots/sides worked the same day -- so report-editor.html
// and quick-quantity.html both give them a repeatable "add another entry" UI
// instead of the plain single-quantity-per-item model everything else uses.
// Fixed set, unlike Locations -- which side of the road isn't a per-project
// custom list, so report-editor.html and quick-quantity.html both just
// offer these three rather than reading a list from the project file.
const PAY_ITEM_SIDE_OPTIONS = ['Lt', 'Rt', 'Ctr'];

function payItemNeedsMultiple(catalogItem) {
  return !!catalogItem && (catalogItem.stations || catalogItem.side || catalogItem.computed || catalogItem.theoretical || (catalogItem.locations && catalogItem.locations.length > 0));
}

// Overrun/Underrun for a Theoretical Qty pay item -- Qty minus Theoretical
// Qty, positive meaning more was actually used than the theoretical figure
// called for. Null (shown as a dash) unless both sides are real numbers.
function computeOverrun(qty, theoreticalQty) {
  const q = Number(qty);
  const t = Number(theoreticalQty);
  if (qty === '' || theoreticalQty === '' || !Number.isFinite(q) || !Number.isFinite(t)) return null;
  return Math.round((q - t) * 1000) / 1000;
}

// Shared by report-editor.html and quick-quantity.html so an Overrun figure
// always reads the same wherever it shows up.
function overrunLabel(overrun) {
  if (overrun == null) return '—';
  const sign = overrun > 0 ? '+' : '';
  return `${sign}${overrun} ovr/undr`;
}

// Parses a civil engineering "station" value -- either plain feet (a bare
// number) or standard stationing notation like "120+15" (station 120, plus
// 15 feet; one station is 100 feet, so this is 12,015 feet from the
// reference point). Returns null for anything that's neither, same as a
// plain unparseable number always has.
function parseStation(value) {
  const str = String(value ?? '').trim();
  if (!str) return null;
  const stationMatch = /^(\d+)\s*\+\s*(\d+(?:\.\d+)?)$/.exec(str);
  if (stationMatch) return Number(stationMatch[1]) * 100 + Number(stationMatch[2]);
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : null;
}

// Length x Width area math for a Computed Quantity pay item, converted to
// match the item's own unit -- everything else (Sq Ft, linear units, etc.)
// is left as a plain Length x Width product since there's no unambiguous
// conversion to guess at.
function computeAreaQty(length, width, unit) {
  const l = Number(length);
  const w = Number(width);
  if (!Number.isFinite(l) || !Number.isFinite(w)) return '';
  const sqFt = l * w;
  const u = String(unit || '').trim().toUpperCase();
  const qty = u.includes('SQ YD') || u.includes('SY') ? sqFt / 9 : sqFt;
  return String(Math.round(qty * 1000) / 1000);
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
async function makeBlankReport(nextReportNo, project, previous) {
  const meta = (project && project.meta) || {};
  const projectContractors = (project && project.defaultContractors) || [];
  const projectEquipmentLabels = (project && project.defaultEquipmentLabels) || [];
  // A device logged in with a name (see login.html) always wins over
  // carry-forward/project-default -- that old behavior was a convenience
  // for "same person, next day"; a real identity is a better answer to the
  // same question, and covers a different person picking up the project too.
  const loggedInName = typeof getUserName === 'function' ? await getUserName() : null;

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
    representative: loggedInName || (previous ? previous.representative : meta.representative || ''),
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
      // Only meaningful for a catalog item with Stations/Locations/Side/
      // Computed/Theoretical enabled (see project-file.js) -- blank and
      // unused otherwise.
      startStation: '',
      endStation: '',
      location: '',
      side: '',
      length: '',
      width: '',
      theoreticalQty: '',
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
    // No peSignatureImage: the engineer's signature line is left blank on the
    // printed report for them to sign -- inspectors don't sign for them.
    peSignatureName: previous ? previous.peName : meta.peName || '',
    weatherDesc: meta.weatherDesc || '',
    tempHigh: meta.tempHigh || '',
    tempLow: meta.tempLow || '',
    photos: [null, null, null, null, null, null],
    // A brand-new report has nothing to lazily fetch -- every slot is
    // locally authoritative already. A report pulled from a company
    // without downloading its photo bytes (see firebase-sync.js) sets
    // these to false for whichever slots it deferred; report-editor.html
    // fetches them on open, download.html before generating a PDF.
    photosFetched: [true, true, true, true, true, true],
    signatureFetched: true,
    // Small rendered previews of the report's two printed pages (front:
    // the work report, back: the photo log), shown on reports.html.
    // Local-only -- never pushed to the company (see pushReportToCompany)
    // -- and regenerated whenever thumbnailAt stops matching updatedAt
    // (see ensureThumbnails in reports.html).
    thumbnail: null,
    thumbnailBack: null,
    thumbnailAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Brings a stored report up to the current shape. Reports saved before the
// force/equipment table grew from 15 rows to the template's full 22 only hold
// 15, and older ones predate the work-summary header field entirely.
function normalizeReport(report) {
  if (!report) return report;
  // Only fills in when entirely absent (a report saved before this field
  // existed) -- an actual `false` from a lazy pull must survive this, not
  // get reset back to "fetched" just because normalizeReport ran again.
  if (!Array.isArray(report.photosFetched)) report.photosFetched = [true, true, true, true, true, true];
  if (report.signatureFetched == null) report.signatureFetched = true;
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
  // Drop any engineer signature captured before that box was removed, so it
  // can't keep printing on a report the engineer never actually signed.
  delete report.peSignatureImage;
  return report;
}

// Builds a new project record from a parsed project-data file (see
// project-file.js).
//
// Projects used to carry a copy of the report template .xlsx. Nothing reads it
// any more -- the PDF is drawn entirely from print-layout.json -- so it's no
// longer stored, which also keeps it out of shared setups.
function makeProjectFromParsedFile(parsed) {
  const meta = parsed.meta || {};
  const displayName = meta.name || (meta.projectNo ? `PR#${meta.projectNo} - ${meta.projectName || 'Project'}` : 'New Project');
  return {
    id: crypto.randomUUID(),
    name: displayName,
    meta: {
      projectNo: meta.projectNo || '',
      projectName: meta.projectName || '',
      ntpDate: meta.ntpDate || '',
      contractLength: meta.contractLength || '',
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
    billingEstimates: parsed.billingEstimates || [],
    requiredFields: [],
    hiddenFields: [],
    fieldOrder: [],
    backgroundImage: null,
    backgroundImageFetched: true, // nothing to fetch -- this project was just created locally
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Finds an existing project a freshly-parsed one probably represents a new
// version of, so re-uploading a project's file can update it in place
// instead of always creating a duplicate. Matched by project number first
// (the stable key project data files are built around), falling back to an
// exact name match for files that don't carry one.
function findSimilarProject(pool, candidate) {
  const projectNo = ((candidate.meta && candidate.meta.projectNo) || '').trim().toLowerCase();
  const name = (candidate.name || '').trim().toLowerCase();
  return (
    pool.find((p) => {
      const pNo = ((p.meta && p.meta.projectNo) || '').trim().toLowerCase();
      if (projectNo && pNo && projectNo === pNo) return true;
      return !!name && (p.name || '').trim().toLowerCase() === name;
    }) || null
  );
}

// Keeps the matched project's identity (id/createdAt) but adopts everything
// the new file carries -- this is what makes it an update rather than a
// second, separate project with the same content.
function applyProjectUpdate(existing, candidate) {
  return {
    ...existing,
    name: candidate.name,
    meta: candidate.meta,
    payItemCatalog: candidate.payItemCatalog,
    defaultContractors: candidate.defaultContractors,
    defaultEquipmentLabels: candidate.defaultEquipmentLabels,
    // Billing estimates are accumulated over time from the Quantity Sheet's
    // "Record New Estimate" button, not authored up front like the rest of
    // this file -- a re-upload only overwrites them when the file actually
    // has an ESTIMATES sheet (candidate.billingEstimates non-null), so
    // re-importing an older export never silently erases real billing
    // history (see parseEstimatesSheet in project-file.js).
    billingEstimates: candidate.billingEstimates != null ? candidate.billingEstimates : existing.billingEstimates,
  };
}

// Next Estimate No. to suggest when recording a new billing checkpoint --
// one past the highest existing number, formatted with the same digit
// width as the one it follows (so "001" stays "002", not "2"). Purely a
// suggestion; the field stays editable.
function nextEstimateNo(billingEstimates) {
  const nums = (billingEstimates || [])
    .map((e) => e.estimateNo || '')
    .filter((s) => /^\d+$/.test(s));
  if (nums.length === 0) return '001';
  const widest = nums.reduce((a, b) => (b.length > a.length ? b : a));
  const max = Math.max(...nums.map(Number));
  return String(max + 1).padStart(widest.length, '0');
}

// ---------- Required-field definitions ----------
//
// An admin marks a subset of these (per project, in project.requiredFields)
// via the visual picker on required-fields.html. Shared here so that page,
// report-editor.html's red-border highlighting, and its Generate Report gate
// all agree on the same key -> label -> "is it actually filled in" logic.
const REQUIRED_FIELD_DEFS = [
  { key: 'activity', label: 'Activity', isEmpty: (r) => !String(r.activity || '').trim() },
  { key: 'notes', label: 'Notes', isEmpty: (r) => !String(r.notes || '').trim() },
  { key: 'representative', label: 'Representative', isEmpty: (r) => !String(r.representative || '').trim() },
  { key: 'peName', label: 'PE Name', isEmpty: (r) => !String(r.peName || '').trim() },
  { key: 'ntpDate', label: 'NTP Date', isEmpty: (r) => !String(r.ntpDate || '').trim() },
  { key: 'contractors', label: 'Contractors (at least one named)', isEmpty: (r) => !Array.isArray(r.contractors) || r.contractors.every((c) => !c.name || !c.name.trim()) },
  { key: 'equipmentRows', label: 'Equipment (at least one quantity entered)', isEmpty: (r) => !Array.isArray(r.equipmentRows) || r.equipmentRows.every((row) => !Array.isArray(row.qty) || row.qty.every((q) => !String(q || '').trim())) },
  { key: 'workSummaryHeader', label: 'Work Summary (top line)', isEmpty: (r) => !String(r.workSummaryHeader || '').trim() },
  { key: 'trafficControlNote', label: 'Short Work Summary', isEmpty: (r) => !String(r.trafficControlNote || '').trim() },
  { key: 'workSummary', label: 'Summary of Work Performed', isEmpty: (r) => !String(r.workSummary || '').trim() },
  { key: 'payItems', label: 'Pay Items (at least one entered)', isEmpty: (r) => !Array.isArray(r.payItems) || r.payItems.every((pi) => !((pi.itemNumber || pi.description) && String(pi.qty || '').trim())) },
  { key: 'controllingItem', label: 'Controlling Item', isEmpty: (r) => !String(r.controllingItem || '').trim() },
  { key: 'commentsOnTime', label: 'Comments on Time Charged', isEmpty: (r) => !String(r.commentsOnTime || '').trim() },
  { key: 'controllingItemTimeFrom', label: 'Controlling Item Time From', isEmpty: (r) => !String(r.controllingItemTimeFrom || '').trim() },
  { key: 'controllingItemTimeTo', label: 'Controlling Item Time To', isEmpty: (r) => !String(r.controllingItemTimeTo || '').trim() },
  { key: 'workingConditions', label: 'Working Conditions', isEmpty: (r) => !String(r.workingConditions || '').trim() },
  { key: 'trafficControlSelect', label: 'Traffic Control Status', isEmpty: (r) => !r.trafficControlSelect },
  { key: 'workBegin', label: 'Work Begin', isEmpty: (r) => !String(r.workBegin || '').trim() },
  { key: 'workEnd', label: 'Work End', isEmpty: (r) => !String(r.workEnd || '').trim() },
  { key: 'repSignatureName', label: 'Representative Name (sign-off)', isEmpty: (r) => !String(r.repSignatureName || '').trim() },
  { key: 'repSignatureImage', label: 'Representative Signature', isEmpty: (r) => !r.repSignatureImage },
  { key: 'peSignatureName', label: 'Project Engineer Name', isEmpty: (r) => !String(r.peSignatureName || '').trim() },
  { key: 'weatherDesc', label: 'Weather Description', isEmpty: (r) => !String(r.weatherDesc || '').trim() },
  { key: 'tempHigh', label: 'High Temp', isEmpty: (r) => !String(r.tempHigh ?? '').trim() },
  { key: 'tempLow', label: 'Low Temp', isEmpty: (r) => !String(r.tempLow ?? '').trim() },
  { key: 'photos', label: 'Photos (at least one)', isEmpty: (r) => !Array.isArray(r.photos) || r.photos.every((p) => !p) },
];

// ---------- Field visibility & order (admin-configurable, per project) ----------
//
// Contractors and Equipment share one entry here ('contractorsEquipment')
// even though REQUIRED_FIELD_DEFS above tracks them separately -- on the
// actual report-editor.html form they're one physical widget (a tab picks
// the contractor, equipment quantities are per-tab), so they can only be
// shown/hidden/repositioned as a unit. They can still be marked required
// independently -- that's a finer distinction than the widget's layout has
// to support.
const ORDERABLE_FIELD_DEFS = [
  { key: 'activity', label: 'Activity', kind: 'simple' },
  { key: 'notes', label: 'Notes', kind: 'simple' },
  { key: 'representative', label: 'Representative', kind: 'simple' },
  { key: 'peName', label: 'PE Name', kind: 'simple' },
  { key: 'ntpDate', label: 'NTP Date', kind: 'simple' },
  { key: 'contractorsEquipment', label: 'Contractors & Equipment', kind: 'block' },
  { key: 'workSummaryHeader', label: 'Work Summary (top line)', kind: 'simple' },
  { key: 'trafficControlNote', label: 'Short Work Summary', kind: 'simple' },
  { key: 'workSummary', label: 'Summary of Work Performed', kind: 'simple' },
  { key: 'payItems', label: 'Pay Items', kind: 'block' },
  { key: 'controllingItem', label: 'Controlling Item', kind: 'simple' },
  { key: 'commentsOnTime', label: 'Comments on Time Charged', kind: 'simple' },
  { key: 'controllingItemTimeFrom', label: 'Controlling Item Time From', kind: 'simple' },
  { key: 'controllingItemTimeTo', label: 'Controlling Item Time To', kind: 'simple' },
  { key: 'workingConditions', label: 'Working Conditions', kind: 'simple' },
  { key: 'trafficControlSelect', label: 'Traffic Control Status', kind: 'block' },
  { key: 'workBegin', label: 'Work Begin', kind: 'simple' },
  { key: 'workEnd', label: 'Work End', kind: 'simple' },
  { key: 'repSignatureName', label: 'Representative Name', kind: 'simple' },
  { key: 'repSignatureImage', label: 'Representative Signature', kind: 'block' },
  { key: 'peSignatureName', label: 'Project Engineer Name', kind: 'simple' },
  { key: 'weatherDesc', label: 'Weather Description', kind: 'simple' },
  { key: 'tempHigh', label: 'High Temp', kind: 'simple' },
  { key: 'tempLow', label: 'Low Temp', kind: 'simple' },
  { key: 'photos', label: 'Photos', kind: 'block' },
];
const DEFAULT_FIELD_ORDER = ORDERABLE_FIELD_DEFS.map((d) => d.key);

// report-editor.html's desktop layout clusters ORDERABLE_FIELD_DEFS keys
// into these fixed, thematic groups (each its own collapsible card) rather
// than one flat step per field -- this is a *display* grouping only, a
// separate concern from the field order/hidden/required config above,
// which admins still fully control per field. A group with every one of
// its keys hidden simply doesn't render; keys within a group still render
// in whatever order the admin set. Every ORDERABLE_FIELD_DEFS key must
// appear in exactly one group here.
const REPORT_BUILDER_GROUPS = [
  { id: 'overview', icon: '\u{1F4DD}', label: 'Overview', keys: ['activity', 'notes', 'representative', 'peName', 'ntpDate'] },
  { id: 'contractorsEquipment', icon: '\u{1F477}', label: 'Contractors & Equipment', keys: ['contractorsEquipment'] },
  { id: 'workSummary', icon: '\u{270D}\u{FE0F}', label: 'Work Summary', keys: ['workSummaryHeader', 'trafficControlNote', 'workSummary'] },
  { id: 'payItems', icon: '\u{1F4CA}', label: 'Pay Items', keys: ['payItems'] },
  { id: 'controllingItem', icon: '\u{23F1}\u{FE0F}', label: 'Controlling Item & Time Charged', keys: ['controllingItem', 'commentsOnTime', 'controllingItemTimeFrom', 'controllingItemTimeTo'] },
  { id: 'siteConditions', icon: '\u{1F6A7}', label: 'Site Conditions', keys: ['workingConditions', 'trafficControlSelect', 'workBegin', 'workEnd'] },
  { id: 'weather', icon: '\u{1F324}\u{FE0F}', label: 'Weather', keys: ['weatherDesc', 'tempHigh', 'tempLow'] },
  { id: 'signOff', icon: '\u{1F58B}\u{FE0F}', label: 'Sign-Off', keys: ['repSignatureName', 'repSignatureImage', 'peSignatureName'] },
  { id: 'photos', icon: '\u{1F4F7}', label: 'Photos', keys: ['photos'] },
];

// A required-field key that isn't its own orderable block (contractors,
// equipmentRows) resolves to the block that actually controls whether it's
// on the form at all.
const REQUIRED_TO_BLOCK_KEY = { contractors: 'contractorsEquipment', equipmentRows: 'contractorsEquipment' };
function blockKeyFor(requiredKey) {
  return REQUIRED_TO_BLOCK_KEY[requiredKey] || requiredKey;
}

// Saved order, with any keys the admin never touched (new app version added
// one, or this project predates the feature) appended at the end in their
// default position rather than silently dropped.
function getFieldOrder(project) {
  const saved = (project && Array.isArray(project.fieldOrder) && project.fieldOrder) || [];
  const known = new Set(DEFAULT_FIELD_ORDER);
  const savedValid = saved.filter((k) => known.has(k));
  const missing = DEFAULT_FIELD_ORDER.filter((k) => !savedValid.includes(k));
  return [...savedValid, ...missing];
}

function isFieldHidden(project, key) {
  return ((project && project.hiddenFields) || []).includes(blockKeyFor(key));
}

// Which of a project's marked-required fields this particular report hasn't
// filled in yet -- empty array means it's good to generate. A required field
// whose block the admin later hid is never enforced -- there'd be no way
// left on the form to satisfy it.
function getMissingRequiredFields(report, project) {
  const required = (project && project.requiredFields) || [];
  if (!required.length || !report) return [];
  return REQUIRED_FIELD_DEFS.filter(
    (def) => required.includes(def.key) && !isFieldHidden(project, def.key) && def.isEmpty(report)
  );
}
