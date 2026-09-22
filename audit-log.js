// Who changed what, when -- a plain-text audit trail for Company Admins.
// Hooked into storage.js the same optional-global way firebase-sync.js
// hooks in company sync (see logAuditableChange, called from saveReport/
// deleteReport/saveProject/deleteProject): storage.js has no idea this file
// exists, it just calls the function by name if something defined it.
//
// An entry is written once and never edited afterward -- see mergeAuditEntry
// in storage.js. What's harder is *when* to write one: report-editor.html
// autosaves on every field change (scheduleSave, ~400ms debounce), so a
// naive "log every saveReport call" would turn five minutes of normal
// editing into dozens of near-duplicate entries, each showing a couple more
// typed characters. Instead, edits to the same report/project are coalesced
// -- see pendingEdits below -- into one entry that covers the whole burst of
// activity, written COALESCE_MS after the last save in that burst. Creation
// and deletion are real, single, deliberate actions (not autosave spam), so
// those are logged immediately.

const AUDIT_COALESCE_MS = 4000;
const pendingEdits = new Map(); // entityId -> { entityType, before, after, timer, batchLabel }

// ---------- Batch context ----------
//
// Excel import and Mass Edit/Delete Selected each fire many individual
// saveReport/deleteReport calls in a tight loop -- without this, 50 reports
// imported together would read exactly like 50 unrelated one-off edits,
// with nothing tying them together. beginAuditBatch/endAuditBatch just tag
// whatever entries get written (or start coalescing) while a batch is open
// with a short suffix on the entity label, e.g. "Report #45 — Main St
// (via Excel Import)".
//
// Captured into logAuditableChange's own local variable up front, not read
// again later off this module-level one -- a coalesced edit's entry isn't
// actually written until AUDIT_COALESCE_MS after the last save in it, well
// after the batch itself has already closed, so reading the live value at
// write time would silently lose the tag for exactly the multi-edit bursts
// this exists to label.
let auditBatchLabel = null;
function beginAuditBatch(label) { auditBatchLabel = label; }
function endAuditBatch() { auditBatchLabel = null; }
function withBatchSuffix(label, batchLabel) {
  return batchLabel ? `${label} (${batchLabel})` : label;
}

// Fields that are either bookkeeping (id, sync/local-only state) or binary
// blobs -- meaningless or unreadable in a text diff, and in several cases
// (photos, thumbnails) never even loaded locally unless someone opened that
// specific report. Signature *presence* still shows up via repSignatureName/
// peSignatureName, which do get diffed normally.
const REPORT_DIFF_SKIP = new Set([
  'id', 'projectId', 'updatedAt', 'createdBy', 'lastEditedBy',
  'photos', 'photosFetched', 'repSignatureImage', 'signatureFetched', 'peSignatureImage',
  'thumbnail', 'thumbnailBack', 'thumbnailAt',
  // inspectors gets its own identity-matched diff instead (see
  // diffInspectors, called separately in diffReport the same way payItems
  // is) -- per-inspector added/removed/Hours changes, not raw per-segment
  // start/end times, which would be noise the Hours figure already speaks
  // to. timeEntries is the pre-multi-inspector field, superseded by
  // inspectors and never touched again after a report is migrated, so it
  // never has anything to show either way.
  'timeEntries',
]);
const PROJECT_DIFF_SKIP = new Set([
  'id', 'updatedAt', 'createdAt', 'backgroundImage', 'backgroundImageFetched',
  // requiredFields/hiddenFields/fieldOrder get their own diff (diffFieldConfig,
  // called separately in diffProject) instead of the generic label-map path.
  'requiredFields', 'hiddenFields', 'fieldOrder',
]);

const REPORT_FIELD_LABELS = {
  reportNo: 'Report No.', date: 'Date', hours: 'Hours', activity: 'Activity', notes: 'Notes',
  peName: 'PE Name', projectNo: 'Project No.', projectName: 'Project Name', representative: 'Representative',
  ntpDate: 'NTP Date', contractors: 'Contractors', equipmentRows: 'Equipment',
  workSummaryHeader: 'Work Summary (top line)', trafficControlNote: 'Short Work Summary', workSummary: 'Summary of Work Performed',
  payItems: 'Pay Items', controllingItem: 'Controlling Item', commentsOnTime: 'Comments on Time Charged',
  controllingItemTimeFrom: 'Controlling Item Time From', controllingItemTimeTo: 'Controlling Item Time To',
  workingConditions: 'Working Conditions', trafficControlSelect: 'Traffic Control Status',
  workBegin: 'Work Begin', workEnd: 'Work End', repSignatureName: 'Representative Signature',
  peSignatureName: 'PE Signature', weatherDesc: 'Weather', tempHigh: 'Temp High', tempLow: 'Temp Low',
};
const PROJECT_FIELD_LABELS = {
  name: 'Project Display Name', payItemCatalog: 'Pay Item Catalog', defaultContractors: 'Default Contractors',
  defaultEquipmentLabels: 'Default Equipment Labels',
  'meta.projectNo': 'Project No.', 'meta.projectName': 'Project Name', 'meta.ntpDate': 'NTP Date',
  'meta.contractLength': 'Contract Length', 'meta.representative': 'Representative', 'meta.peName': 'PE Name',
  'meta.activity': 'Default Activity', 'meta.notes': 'Default Notes',
  'meta.workSummaryHeader': 'Default Work Summary (top line)', 'meta.trafficControlNote': 'Default Short Work Summary',
  'meta.workSummary': 'Default Work Summary', 'meta.controllingItem': 'Default Controlling Item',
  'meta.commentsOnTime': 'Default Comments on Time Charged', 'meta.controllingItemTimeFrom': 'Default Controlling Item Time From',
  'meta.controllingItemTimeTo': 'Default Controlling Item Time To', 'meta.workingConditions': 'Default Working Conditions',
  'meta.trafficControlSelect': 'Default Traffic Control Status', 'meta.workBegin': 'Default Work Begin',
  'meta.workEnd': 'Default Work End', 'meta.weatherDesc': 'Default Weather', 'meta.tempHigh': 'Default Temp High',
  'meta.tempLow': 'Default Temp Low',
};
const COMPANY_PERMISSION_LABELS = {
  membersCanCreateProjects: 'Members Can Create Projects',
  membersCanViewManagerDashboard: 'Members Can View Manager Dashboard',
  membersCanEditProjects: 'Members Can Edit Projects',
  membersCanEditAnyReport: 'Members Can Edit Any Report',
  membersCanEditOwnReports: 'Members Can Edit Own Reports',
};

function fmtLeaf(v) {
  if (v == null || v === '') return '(blank)';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

// Generic recursive diff for anything that isn't specially handled below --
// walks matching arrays by index and objects by key down to primitive
// leaves, emitting one line per leaf that actually changed. Good enough for
// fields like Contractors or Equipment, where entries are rarely reordered;
// Pay Items gets its own smarter, identity-based diff instead (see below),
// since re-ordering or removing one mid-list item is common there and a
// positional diff would misreport every entry after it as "changed".
function diffGeneric(before, after, label, out) {
  const a = before == null ? '' : before;
  const b = after == null ? '' : after;
  if (Array.isArray(a) || Array.isArray(b)) {
    const arrA = Array.isArray(a) ? a : [];
    const arrB = Array.isArray(b) ? b : [];
    const len = Math.max(arrA.length, arrB.length);
    for (let i = 0; i < len; i++) diffGeneric(arrA[i], arrB[i], `${label} ${i + 1}`, out);
    return;
  }
  if (typeof a === 'object' && typeof b === 'object' && a && b) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diffGeneric(a[k], b[k], `${label} ${k}`, out);
    return;
  }
  if (fmtLeaf(a) !== fmtLeaf(b)) out.push({ label, from: fmtLeaf(a), to: fmtLeaf(b) });
}

// One line per changed field on a scalar/simple-object level, dotted-path
// aware (meta.projectNo etc.) so PROJECT_FIELD_LABELS can label nested
// fields without a nested label tree.
function diffByLabelMap(before, after, labelMap, skip, prefix, out) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (skip.has(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const a = before ? before[key] : undefined;
    const b = after ? after[key] : undefined;
    if (key === 'meta' && !prefix) {
      diffByLabelMap(a, b, labelMap, new Set(), 'meta', out);
      continue;
    }
    const label = labelMap[path] || path;
    diffGeneric(a, b, label, out);
  }
}

// Pay item rows carry a natural composite identity (which item, which
// segment/side/location) that's worth matching on rather than comparing
// position-by-position -- adding one row shouldn't make every later row
// look like it changed. Multiple rows can legitimately share every one of
// these (two identical re-measurements), so index among matches with the
// exact same key breaks the tie.
function payItemKey(pi) {
  return [pi.itemNumber, pi.side || '', pi.startStation || '', pi.endStation || '', pi.location || ''].join('|');
}
function diffPayItems(before, after, out) {
  const realBefore = (before || []).filter((pi) => pi && (pi.itemNumber || pi.description));
  const realAfter = (after || []).filter((pi) => pi && (pi.itemNumber || pi.description));
  const usedAfter = new Set();
  const seenKeyCount = new Map();

  for (const b of realBefore) {
    const key = payItemKey(b);
    const occurrence = seenKeyCount.get(key) || 0;
    seenKeyCount.set(key, occurrence + 1);
    let matchIdx = -1;
    let seenSoFar = 0;
    for (let i = 0; i < realAfter.length; i++) {
      if (usedAfter.has(i) || payItemKey(realAfter[i]) !== key) continue;
      if (seenSoFar === occurrence) { matchIdx = i; break; }
      seenSoFar++;
    }
    if (matchIdx === -1) {
      out.push({ label: `Pay Item ${b.itemNumber} removed`, from: `${fmtLeaf(b.qty)} ${b.unit || ''}`.trim(), to: '' });
      continue;
    }
    usedAfter.add(matchIdx);
    const a = realAfter[matchIdx];
    const rowLabel = `Pay Item ${b.itemNumber}${b.side ? ' (' + b.side + ')' : ''}`;
    const fields = ['qty', 'startStation', 'endStation', 'location', 'side', 'length', 'width', 'theoreticalQty'];
    const fieldLabels = { qty: 'Qty', startStation: 'Start Station', endStation: 'Stop Station', location: 'Location', side: 'Side', length: 'Length', width: 'Width', theoreticalQty: 'Theoretical Qty' };
    for (const f of fields) {
      if (fmtLeaf(b[f]) !== fmtLeaf(a[f])) out.push({ label: `${rowLabel} ${fieldLabels[f]}`, from: fmtLeaf(b[f]), to: fmtLeaf(a[f]) });
    }
  }
  for (let i = 0; i < realAfter.length; i++) {
    if (usedAfter.has(i)) continue;
    const a = realAfter[i];
    out.push({ label: `Pay Item ${a.itemNumber} added`, from: '', to: `${fmtLeaf(a.qty)} ${a.unit || ''}`.trim() });
  }
}

// Same identity-over-position reasoning as pay item rows -- catalog entries
// are keyed by Item Number alone, since (unlike report rows) each one is
// meant to be unique.
function diffPayItemCatalog(before, after, out) {
  const byNumber = (list) => new Map((list || []).filter((it) => it.itemNumber).map((it) => [it.itemNumber, it]));
  const b = byNumber(before);
  const a = byNumber(after);
  const flagLabels = { stations: 'Stations tracking', side: 'Side tracking', computed: 'Computed Qty', theoretical: 'Theoretical Qty' };
  for (const [num, bItem] of b) {
    const aItem = a.get(num);
    if (!aItem) {
      out.push({ label: `Pay Item Catalog ${num} removed`, from: bItem.description || '', to: '' });
      continue;
    }
    const fieldLabels = { description: 'Description', unit: 'Unit', plannedQty: 'Per Plans Total', unitPrice: 'Unit Price' };
    for (const f of Object.keys(fieldLabels)) {
      if (fmtLeaf(bItem[f]) !== fmtLeaf(aItem[f])) out.push({ label: `Pay Item Catalog ${num} ${fieldLabels[f]}`, from: fmtLeaf(bItem[f]), to: fmtLeaf(aItem[f]) });
    }
    for (const f of Object.keys(flagLabels)) {
      if (!!bItem[f] !== !!aItem[f]) out.push({ label: `Pay Item Catalog ${num} ${flagLabels[f]}`, from: bItem[f] ? 'On' : 'Off', to: aItem[f] ? 'On' : 'Off' });
    }
    const bLoc = (bItem.locations || []).join(', ');
    const aLoc = (aItem.locations || []).join(', ');
    if (bLoc !== aLoc) out.push({ label: `Pay Item Catalog ${num} Locations`, from: fmtLeaf(bLoc), to: fmtLeaf(aLoc) });
  }
  for (const [num, aItem] of a) {
    if (!b.has(num)) out.push({ label: `Pay Item Catalog ${num} added`, from: '', to: aItem.description || '' });
  }
}

// Same identity-over-position reasoning again -- each Pay App has a stable
// id (unlike a pay item row, there's nothing else to key on), so this used
// to fall through to diffGeneric's plain positional array walk, which
// produces unreadable nested-index lines like "Billing Estimates 2
// itemTotals 4" instead of naming the actual Pay App and item. itemTotals
// is a flat {itemNumber: dollar total} map -- whatever $/Qty/% entry mode
// was used on pay-apps.html, it's already resolved to a total by the time
// it's saved, so there's nothing left to label beyond the item number.
function diffBillingEstimates(before, after, out) {
  const byId = (list) => new Map((list || []).filter((e) => e && e.id).map((e) => [e.id, e]));
  const b = byId(before);
  const a = byId(after);
  const estLabel = (e) => `Pay App #${e.estimateNo || '?'} (${e.date || 'no date'})`;
  for (const [id, bEst] of b) {
    const aEst = a.get(id);
    if (!aEst) {
      out.push({ label: `${estLabel(bEst)} removed`, from: 'on file', to: '' });
      continue;
    }
    const label = estLabel(bEst);
    if (fmtLeaf(bEst.estimateNo) !== fmtLeaf(aEst.estimateNo)) out.push({ label: `${label} No.`, from: fmtLeaf(bEst.estimateNo), to: fmtLeaf(aEst.estimateNo) });
    if (fmtLeaf(bEst.date) !== fmtLeaf(aEst.date)) out.push({ label: `${label} Date`, from: fmtLeaf(bEst.date), to: fmtLeaf(aEst.date) });
    if (fmtLeaf(bEst.note) !== fmtLeaf(aEst.note)) out.push({ label: `${label} Note`, from: fmtLeaf(bEst.note), to: fmtLeaf(aEst.note) });
    const bTotals = bEst.itemTotals || {};
    const aTotals = aEst.itemTotals || {};
    for (const item of new Set([...Object.keys(bTotals), ...Object.keys(aTotals)])) {
      if (fmtLeaf(bTotals[item]) !== fmtLeaf(aTotals[item])) {
        out.push({ label: `${label} Item ${item} Total`, from: fmtLeaf(bTotals[item]), to: fmtLeaf(aTotals[item]) });
      }
    }
  }
  for (const [id, aEst] of a) {
    if (!b.has(id)) out.push({ label: `${estLabel(aEst)} recorded`, from: '', to: 'on file' });
  }
}

// Same identity-over-position reasoning as pay item rows -- matched by
// name, since an inspector has no other stable identity. Two inspectors
// can share a typed name; index among matches with that exact name breaks
// the tie, same as payItemKey. Reports who was added/removed and whose
// Hours changed -- not a play-by-play of their individual time segments,
// which would be noise the aggregate Hours figure already speaks to.
function diffInspectors(before, after, out) {
  const realBefore = (before || []).filter((insp) => insp && (insp.name || '').trim());
  const realAfter = (after || []).filter((insp) => insp && (insp.name || '').trim());
  const usedAfter = new Set();
  const seenNameCount = new Map();

  for (const b of realBefore) {
    const name = b.name.trim();
    const occurrence = seenNameCount.get(name) || 0;
    seenNameCount.set(name, occurrence + 1);
    let matchIdx = -1;
    let seenSoFar = 0;
    for (let i = 0; i < realAfter.length; i++) {
      if (usedAfter.has(i) || realAfter[i].name.trim() !== name) continue;
      if (seenSoFar === occurrence) { matchIdx = i; break; }
      seenSoFar++;
    }
    if (matchIdx === -1) {
      out.push({ label: `Inspector ${name} removed`, from: `${fmtLeaf(b.hours)} hrs`, to: '' });
      continue;
    }
    usedAfter.add(matchIdx);
    const a = realAfter[matchIdx];
    if (fmtLeaf(b.hours) !== fmtLeaf(a.hours)) {
      out.push({ label: `Inspector ${name} Hours`, from: fmtLeaf(b.hours), to: fmtLeaf(a.hours) });
    }
  }
  for (let i = 0; i < realAfter.length; i++) {
    if (usedAfter.has(i)) continue;
    const a = realAfter[i];
    out.push({ label: `Inspector ${a.name.trim()} added`, from: '', to: `${fmtLeaf(a.hours)} hrs` });
  }
}

// Photos are skipped by REPORT_DIFF_SKIP (binary, meaningless in a text
// diff) but a count is still worth showing -- "Photos: 2 → 4" says someone
// added two without exposing the images themselves. Slots can be null
// (a removed photo leaves a gap rather than shifting the rest down), so
// this counts filled slots, not array length.
function diffPhotos(before, after, out) {
  const count = (arr) => (arr || []).filter(Boolean).length;
  const b = count(before);
  const a = count(after);
  if (b !== a) out.push({ label: 'Photos', from: `${b} photo${b === 1 ? '' : 's'}`, to: `${a} photo${a === 1 ? '' : 's'}` });
}

function diffReport(before, after) {
  const out = [];
  diffPayItems(before.payItems, after.payItems, out);
  diffInspectors(before.inspectors, after.inspectors, out);
  diffPhotos(before.photos, after.photos, out);
  const beforeRest = { ...before };
  const afterRest = { ...after };
  delete beforeRest.payItems;
  delete afterRest.payItems;
  delete beforeRest.inspectors;
  delete afterRest.inspectors;
  diffByLabelMap(beforeRest, afterRest, REPORT_FIELD_LABELS, REPORT_DIFF_SKIP, '', out);
  return out;
}

// Admin-configurable show/hide/require/order for report fields
// (required-fields.html) -- used to be skipped entirely (see
// PROJECT_DIFF_SKIP's history), which meant an admin could silently make a
// field invisible or optional with nothing recording it. Order changes are
// collapsed into one line each way rather than one per field: a drag
// reorder touches every field's position, and reporting each individually
// would bury the one field that was actually re-required or hidden in noise.
function fieldLabel(key) {
  const def = (typeof ORDERABLE_FIELD_DEFS !== 'undefined' ? ORDERABLE_FIELD_DEFS : []).find((d) => d.key === key);
  return def ? def.label : key;
}
function diffFieldConfig(before, after, out) {
  const bReq = new Set(before.requiredFields || []);
  const aReq = new Set(after.requiredFields || []);
  const bHid = new Set(before.hiddenFields || []);
  const aHid = new Set(after.hiddenFields || []);
  for (const key of new Set([...bReq, ...aReq, ...bHid, ...aHid])) {
    const label = fieldLabel(key);
    if (bReq.has(key) !== aReq.has(key)) {
      out.push({ label: `${label} Required`, from: bReq.has(key) ? 'Yes' : 'No', to: aReq.has(key) ? 'Yes' : 'No' });
    }
    if (bHid.has(key) !== aHid.has(key)) {
      out.push({ label: `${label} Hidden`, from: bHid.has(key) ? 'Yes' : 'No', to: aHid.has(key) ? 'Yes' : 'No' });
    }
  }
  const bOrder = (before.fieldOrder || []).join(',');
  const aOrder = (after.fieldOrder || []).join(',');
  if (bOrder !== aOrder && bOrder && aOrder) {
    out.push({
      label: 'Field Order',
      from: (before.fieldOrder || []).map(fieldLabel).join(', '),
      to: (after.fieldOrder || []).map(fieldLabel).join(', '),
    });
  }
}

function diffProject(before, after) {
  const out = [];
  diffPayItemCatalog(before.payItemCatalog, after.payItemCatalog, out);
  diffFieldConfig(before, after, out);
  diffBillingEstimates(before.billingEstimates, after.billingEstimates, out);
  const beforeRest = { ...before };
  const afterRest = { ...after };
  delete beforeRest.payItemCatalog;
  delete afterRest.payItemCatalog;
  delete beforeRest.billingEstimates;
  delete afterRest.billingEstimates;
  diffByLabelMap(beforeRest, afterRest, PROJECT_FIELD_LABELS, PROJECT_DIFF_SKIP, '', out);
  return out;
}

// Company themes (see firebase-sync.js's saveCompanyThemes) don't go
// through storage.js's saveProject/saveReport at all -- one admin action
// can create, edit, and delete several themes in the same call (the whole
// list is saved at once). logThemeChanges, called directly from
// saveCompanyThemes, diffs the old list against the new one by id and
// writes one entry per theme that actually changed -- no coalescing
// needed (see AUDIT_COALESCE_MS's header comment for why reports/projects
// need it and this doesn't): a Theme Builder save is already one
// deliberate action, not a burst of autosaves.
const THEME_DECAL_POSITION_LABELS = {
  'top-left': 'Top Left', 'top-center': 'Top Center', 'top-right': 'Top Right',
  'center-left': 'Center Left', center: 'Center', 'center-right': 'Center Right',
  'bottom-left': 'Bottom Left', 'bottom-center': 'Bottom Center', 'bottom-right': 'Bottom Right',
};
const THEME_DECAL_SIZE_LABELS = { small: 'Small', medium: 'Medium', large: 'Large' };
const THEME_DECAL_LAYER_LABELS = { background: 'Behind the app’s cards and buttons', top: 'In front of the app, over everything' };
const THEME_MODE_LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };
const THEME_FADE_COLOR_LABELS = { none: 'None', dark: 'Dark', light: 'Light' };
const THEME_BLUR_LABELS = { none: 'None', light: 'Light', medium: 'Medium', strong: 'Strong' };

function fmtThemeOpacity(v) {
  return v == null ? '(blank)' : `${Math.round(v * 100)}%`;
}
function fmtThemeBackground(t) {
  return t.backgroundType === 'image' ? 'An uploaded image' : `A solid color (${t.backgroundColor || '(blank)'})`;
}
// Prefixed the same way a report's label leads with "Report #N" -- a
// theme's plain name alone ("LSU") would read as just another project in
// the log; "Theme:" makes what kind of thing changed obvious at a glance.
function themeEntityLabel(theme) {
  return `Theme: ${theme.name || 'Untitled Theme'}`;
}

// Plain-language, one line per thing that actually changed -- written for
// an admin skimming the log, not a developer, per how this whole file's
// output already reads (see REPORT_FIELD_LABELS/PROJECT_FIELD_LABELS
// above for the same spirit). imageChange ({background, decal} booleans)
// comes from saveCompanyThemes, which is the only place that still knows
// whether an upload actually happened -- hasBackgroundImage/hasDecalImage
// alone can't tell "replaced with a different picture" from "left alone",
// since both stay true either way.
function diffTheme(before, after, imageChange) {
  const out = [];
  const push = (label, a, b) => { if (a !== b) out.push({ label, from: a, to: b }); };

  push('Theme Name', before.name || '(blank)', after.name || '(blank)');
  push('Accent Color', before.accent || '(blank)', after.accent || '(blank)');
  push('Style Mode', THEME_MODE_LABELS[before.mode || 'auto'], THEME_MODE_LABELS[after.mode || 'auto']);
  push('Home Screen Background', fmtThemeBackground(before), fmtThemeBackground(after));
  if (after.backgroundType === 'image' && imageChange && imageChange.background) {
    out.push({ label: 'Background Image', from: before.hasBackgroundImage ? 'Previous picture' : '(none)', to: 'New picture uploaded' });
  }
  if (after.backgroundType === 'image') {
    push('Background Fade', THEME_FADE_COLOR_LABELS[before.backgroundFadeColor || 'none'], THEME_FADE_COLOR_LABELS[after.backgroundFadeColor || 'none']);
    if ((after.backgroundFadeColor || 'none') !== 'none') {
      push('Background Fade Amount', fmtThemeOpacity(before.backgroundFadeAmount), fmtThemeOpacity(after.backgroundFadeAmount));
    }
    push('Background Blur', THEME_BLUR_LABELS[before.backgroundBlur || 'none'], THEME_BLUR_LABELS[after.backgroundBlur || 'none']);
  }

  const hadDecal = !!before.hasDecalImage;
  const hasDecal = !!after.hasDecalImage;
  push('Has a Decorative Image', hadDecal ? 'Yes' : 'No', hasDecal ? 'Yes' : 'No');
  if (imageChange && imageChange.decal && hadDecal && hasDecal) {
    out.push({ label: 'Decorative Image', from: 'Previous picture', to: 'Replaced with a new picture' });
  }
  if (hasDecal) {
    push('Decorative Image Position', THEME_DECAL_POSITION_LABELS[before.decalPosition] || before.decalPosition || '(blank)', THEME_DECAL_POSITION_LABELS[after.decalPosition] || after.decalPosition || '(blank)');
    push('Decorative Image Layer', THEME_DECAL_LAYER_LABELS[before.decalLayer || 'background'], THEME_DECAL_LAYER_LABELS[after.decalLayer || 'background']);
    push('Decorative Image Size', THEME_DECAL_SIZE_LABELS[before.decalSize] || before.decalSize || '(blank)', THEME_DECAL_SIZE_LABELS[after.decalSize] || after.decalSize || '(blank)');
    push('Decorative Image Opacity', fmtThemeOpacity(before.decalOpacity), fmtThemeOpacity(after.decalOpacity));
  }
  return out;
}

// `imageChanges` is a plain object keyed by theme id -> {background, decal}
// booleans (see the comment above diffTheme for why saveCompanyThemes has
// to be the one to supply this). Every entry writes immediately -- no
// coalescing, no waiting -- since this only ever runs once per deliberate
// Theme Builder save.
async function logThemeChanges(beforeThemes, afterThemes, imageChanges) {
  const beforeById = new Map(beforeThemes.map((t) => [t.id, t]));
  const afterIds = new Set(afterThemes.map((t) => t.id));

  for (const after of afterThemes) {
    const before = beforeById.get(after.id);
    if (!before) {
      await writeAuditEntry('theme', after.id, themeEntityLabel(after), 'created', []);
      continue;
    }
    const changes = diffTheme(before, after, (imageChanges || {})[after.id]);
    if (changes.length) await writeAuditEntry('theme', after.id, themeEntityLabel(after), 'edited', changes);
  }
  for (const before of beforeThemes) {
    if (!afterIds.has(before.id)) {
      await writeAuditEntry('theme', before.id, themeEntityLabel(before), 'deleted', []);
    }
  }
}

async function reportEntityLabel(report) {
  const project = report.projectId ? await getProject(report.projectId) : null;
  const projectLabel = (project && project.name) || report.projectName || report.projectNo || 'Unassigned Project';
  return `Report #${report.reportNo || '?'} — ${projectLabel}`;
}
function projectEntityLabel(project) {
  return project.name || (project.meta && project.meta.projectNo) || 'Project';
}

// Ties an entry's hash to its own content only (id, timestamp, who/what/
// changed) -- not to any other entry -- so it can be checked in isolation.
// That's a deliberate tradeoff: this app's audit log is written
// independently by whichever device is in someone's hand at the time and
// merged later (see mergeAuditEntry in storage.js), often across devices
// that haven't synced with each other yet. A single running chain across
// all entries would treat that completely normal situation as "tampered"
// every time two people worked at once. A self-hash instead catches the
// more realistic risk -- someone going back and editing what an existing
// entry says happened -- without crying wolf over ordinary concurrent use.
// It can't detect an entry being deleted outright; that would need a
// separate, server-enforced ledger (see Firestore security rules).
async function hashAuditEntryContent(entry) {
  const payload = JSON.stringify({
    id: entry.id, timestamp: entry.timestamp, userName: entry.userName,
    action: entry.action, entityType: entry.entityType, entityId: entry.entityId,
    entityLabel: entry.entityLabel, changes: entry.changes || [],
  });
  return hashText(payload);
}

// null = nothing to check (an entry written before this feature existed --
// not a red flag, just unverifiable). true/false = whether the entry's
// current content still matches what was hashed when it was written.
async function verifyAuditEntry(entry) {
  if (!entry.hash) return null;
  return (await hashAuditEntryContent(entry)) === entry.hash;
}

async function writeAuditEntry(entityType, entityId, entityLabel, action, changes) {
  const userName = (await getUserName()) || 'Unknown User';
  const room = typeof getCompanyRoom === 'function' ? await getCompanyRoom() : null;
  const entry = { id: crypto.randomUUID(), timestamp: Date.now(), userName, action, entityType, entityId, entityLabel, changes: changes || [], companyCode: room ? room.code : null };
  entry.hash = await hashAuditEntryContent(entry);
  await saveAuditEntry(entry);
  if (typeof onCompanySyncAuditEntry === 'function') {
    onCompanySyncAuditEntry(entry).catch((err) => console.error('audit sync:', err));
  }
}

// ---------- Company/account-level events ----------
//
// Everything below is called directly from firebase-sync.js's account-
// management functions (permissions, passwords, custom setups, join/
// create/leave) -- there's no before/after record the way a report or
// project has one, so each call site hands over just what it knows changed.
// A password's own value is never logged, only that it changed -- same
// principle as never storing a password itself, just its hash.
async function logCompanyEvent(action, companyName, changes) {
  await writeAuditEntry('company', 'company', companyName || 'Company', action, changes || []);
}

// A device's own display name changing is worth flagging since it changes
// who future entries (and reports) get attributed to -- but only an actual
// rename, not the very first time a blank device gets a name, which is
// just normal setup, not a change to anything.
async function logDeviceRenamed(before, after) {
  if (!before || !after || before === after) return;
  // entityLabel is a fixed "This Device" rather than the new name -- the
  // change line right below already shows old → new, so using the new
  // name here too would just read as "X renamed X".
  await writeAuditEntry('device', 'device', 'This Device', 'renamed', [{ label: 'Name', from: before, to: after }]);
}

function diffPermissions(before, after, out) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    const label = COMPANY_PERMISSION_LABELS[key] || key;
    const a = !!(before && before[key]);
    const b = !!(after && after[key]);
    if (a !== b) out.push({ label, from: a ? 'On' : 'Off', to: b ? 'On' : 'Off' });
  }
}

async function finalizePendingEdit(entityId) {
  const p = pendingEdits.get(entityId);
  if (!p) return;
  pendingEdits.delete(entityId);
  const changes = p.entityType === 'report' ? diffReport(p.before, p.after) : diffProject(p.before, p.after);
  if (changes.length === 0) return;
  const label = p.entityType === 'report' ? await reportEntityLabel(p.after) : projectEntityLabel(p.after);
  await writeAuditEntry(p.entityType, p.after.id, withBatchSuffix(label, p.batchLabel), 'edited', changes);
}

// Called from storage.js after every report/project save or delete --
// see the file header for why edits are coalesced but create/delete aren't.
async function logAuditableChange(entityType, before, after, deleted) {
  const record = after || before;
  if (!record) return;
  const batchLabel = auditBatchLabel; // see its own comment for why this is captured now, not read later

  if (deleted) {
    await finalizePendingEdit(record.id); // flush whatever led up to the delete first
    const label = entityType === 'report' ? await reportEntityLabel(record) : projectEntityLabel(record);
    await writeAuditEntry(entityType, record.id, withBatchSuffix(label, batchLabel), 'deleted', []);
    return;
  }
  if (!before) {
    const label = entityType === 'report' ? await reportEntityLabel(record) : projectEntityLabel(record);
    await writeAuditEntry(entityType, record.id, withBatchSuffix(label, batchLabel), 'created', []);
    return;
  }

  const existing = pendingEdits.get(record.id);
  if (existing) {
    clearTimeout(existing.timer);
    existing.after = after;
    if (batchLabel) existing.batchLabel = batchLabel;
  } else {
    pendingEdits.set(record.id, { entityType, before, after, timer: null, batchLabel });
  }
  const p = pendingEdits.get(record.id);
  p.timer = setTimeout(() => finalizePendingEdit(record.id), AUDIT_COALESCE_MS);
}

// Best-effort: flush anything still pending if the tab is closed/backgrounded
// before its coalesce timer fires, so a short editing session right before
// closing the tab isn't silently lost from the log.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  for (const entityId of Array.from(pendingEdits.keys())) {
    clearTimeout(pendingEdits.get(entityId).timer);
    finalizePendingEdit(entityId);
  }
});

// ---------- Plain-text formatting -- the actual deliverable ----------
//
// Deliberately not JSON or HTML: this is what both the on-page view and the
// downloaded .txt file render, so what you see on screen is exactly what
// you'd get in the file.

function fmtEntryTimestamp(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const AUDIT_ACTION_VERBS = {
  created: 'Created', edited: 'Edited', deleted: 'Deleted',
  joined: 'Joined', left: 'Left', renamed: 'Renamed',
  'admin-unlocked': 'Unlocked Admin on',
  'permissions-changed': 'Changed Permissions for',
  'dashboard-changed': 'Changed Manager Dashboard Settings for',
  'name-changed': 'Renamed',
  'password-changed': 'Changed the Company Password for',
  'admin-password-changed': 'Changed the Admin Password for',
  'role-created': 'Created Custom Setup on',
  'role-deleted': 'Deleted Custom Setup from',
};

function formatAuditLogAsText(entries) {
  if (entries.length === 0) return 'No activity recorded yet.\n';
  return entries
    .map((e) => {
      const verb = AUDIT_ACTION_VERBS[e.action] || e.action;
      const flag = e.tampered ? '  [!] DOES NOT MATCH ITS ORIGINAL RECORD -- may have been edited after the fact' : '';
      const header = `${fmtEntryTimestamp(e.timestamp)}  ${e.userName}  ${verb} ${e.entityLabel}${flag}`;
      const lines = (e.changes || []).map((c) => `  ${c.label}: ${c.from} → ${c.to}`);
      return [header, ...lines].join('\n');
    })
    .join('\n\n') + '\n';
}
