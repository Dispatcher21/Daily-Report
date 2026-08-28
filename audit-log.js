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
const pendingEdits = new Map(); // entityId -> { entityType, before, after, timer }

// Fields that are either bookkeeping (id, sync/local-only state) or binary
// blobs -- meaningless or unreadable in a text diff, and in several cases
// (photos, thumbnails) never even loaded locally unless someone opened that
// specific report. Signature *presence* still shows up via repSignatureName/
// peSignatureName, which do get diffed normally.
const REPORT_DIFF_SKIP = new Set([
  'id', 'projectId', 'updatedAt', 'createdBy', 'lastEditedBy',
  'photos', 'photosFetched', 'repSignatureImage', 'signatureFetched', 'peSignatureImage',
  'thumbnail', 'thumbnailBack', 'thumbnailAt',
]);
const PROJECT_DIFF_SKIP = new Set([
  'id', 'updatedAt', 'createdAt', 'backgroundImage', 'backgroundImageFetched',
  'requiredFields', 'hiddenFields', 'fieldOrder',
]);

const REPORT_FIELD_LABELS = {
  reportNo: 'Report No.', date: 'Date', hours: 'Hours', activity: 'Activity', notes: 'Notes',
  peName: 'PE Name', projectNo: 'Project No.', projectName: 'Project Name', representative: 'Representative',
  ntpDate: 'NTP Date', contractors: 'Contractors', equipmentRows: 'Equipment', timeEntries: 'Time Worked',
  workSummaryHeader: 'Work Summary (top line)', trafficControlNote: 'Short Work Summary', workSummary: 'Summary of Work Performed',
  payItems: 'Pay Items', controllingItem: 'Controlling Item', commentsOnTime: 'Comments on Time Charged',
  controllingItemTimeFrom: 'Controlling Item Time From', controllingItemTimeTo: 'Controlling Item Time To',
  workingConditions: 'Working Conditions', trafficControlSelect: 'Traffic Control Status',
  workBegin: 'Work Begin', workEnd: 'Work End', repSignatureName: 'Representative Signature',
  peSignatureName: 'PE Signature', weatherDesc: 'Weather', tempHigh: 'Temp High', tempLow: 'Temp Low',
};
const PROJECT_FIELD_LABELS = {
  name: 'Project Display Name', payItemCatalog: 'Pay Item Catalog', defaultContractors: 'Default Contractors',
  defaultEquipmentLabels: 'Default Equipment Labels', billingEstimates: 'Billing Estimates',
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

function diffReport(before, after) {
  const out = [];
  diffPayItems(before.payItems, after.payItems, out);
  const beforeRest = { ...before };
  const afterRest = { ...after };
  delete beforeRest.payItems;
  delete afterRest.payItems;
  diffByLabelMap(beforeRest, afterRest, REPORT_FIELD_LABELS, REPORT_DIFF_SKIP, '', out);
  return out;
}

function diffProject(before, after) {
  const out = [];
  diffPayItemCatalog(before.payItemCatalog, after.payItemCatalog, out);
  const beforeRest = { ...before };
  const afterRest = { ...after };
  delete beforeRest.payItemCatalog;
  delete afterRest.payItemCatalog;
  diffByLabelMap(beforeRest, afterRest, PROJECT_FIELD_LABELS, PROJECT_DIFF_SKIP, '', out);
  return out;
}

async function reportEntityLabel(report) {
  const project = report.projectId ? await getProject(report.projectId) : null;
  const projectLabel = (project && project.name) || report.projectName || report.projectNo || 'Unassigned Project';
  return `Report #${report.reportNo || '?'} — ${projectLabel}`;
}
function projectEntityLabel(project) {
  return project.name || (project.meta && project.meta.projectNo) || 'Project';
}

async function writeAuditEntry(entityType, entityId, entityLabel, action, changes) {
  const userName = (await getUserName()) || 'Unknown User';
  const entry = { id: crypto.randomUUID(), timestamp: Date.now(), userName, action, entityType, entityId, entityLabel, changes: changes || [] };
  await saveAuditEntry(entry);
  if (typeof onCompanySyncAuditEntry === 'function') {
    onCompanySyncAuditEntry(entry).catch((err) => console.error('audit sync:', err));
  }
}

async function finalizePendingEdit(entityId) {
  const p = pendingEdits.get(entityId);
  if (!p) return;
  pendingEdits.delete(entityId);
  const changes = p.entityType === 'report' ? diffReport(p.before, p.after) : diffProject(p.before, p.after);
  if (changes.length === 0) return;
  const label = p.entityType === 'report' ? await reportEntityLabel(p.after) : projectEntityLabel(p.after);
  await writeAuditEntry(p.entityType, p.after.id, label, 'edited', changes);
}

// Called from storage.js after every report/project save or delete --
// see the file header for why edits are coalesced but create/delete aren't.
async function logAuditableChange(entityType, before, after, deleted) {
  const record = after || before;
  if (!record) return;

  if (deleted) {
    await finalizePendingEdit(record.id); // flush whatever led up to the delete first
    const label = entityType === 'report' ? await reportEntityLabel(record) : projectEntityLabel(record);
    await writeAuditEntry(entityType, record.id, label, 'deleted', []);
    return;
  }
  if (!before) {
    const label = entityType === 'report' ? await reportEntityLabel(record) : projectEntityLabel(record);
    await writeAuditEntry(entityType, record.id, label, 'created', []);
    return;
  }

  const existing = pendingEdits.get(record.id);
  if (existing) {
    clearTimeout(existing.timer);
    existing.after = after;
  } else {
    pendingEdits.set(record.id, { entityType, before, after, timer: null });
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
const AUDIT_ACTION_VERBS = { created: 'Created', edited: 'Edited', deleted: 'Deleted' };

function formatAuditLogAsText(entries) {
  if (entries.length === 0) return 'No activity recorded yet.\n';
  return entries
    .map((e) => {
      const verb = AUDIT_ACTION_VERBS[e.action] || e.action;
      const header = `${fmtEntryTimestamp(e.timestamp)}  ${e.userName}  ${verb} ${e.entityLabel}`;
      const lines = (e.changes || []).map((c) => `  ${c.label}: ${c.from} → ${c.to}`);
      return [header, ...lines].join('\n');
    })
    .join('\n\n') + '\n';
}
