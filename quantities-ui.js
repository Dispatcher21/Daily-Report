// Logged vs billed, shared by the Quantities page (quantity-sheet.html), the
// Pay Apps page and the project page's cards, so the three always agree.
//
// Two words, one color each, everywhere:
//   Logged -- what inspectors recorded in their daily reports.
//   Billed -- what the contractor has been paid on Pay Apps (the latest
//             Pay App's itemTotals, which are already totals to date).
//
// Figures are kept in "stored units", same as a Pay App's itemTotals and a
// report's own qty: a dollar amount for a Lump Sum item, a plain quantity
// for everything else (see earnedTotalFor in quantity-calc.js). Needs
// quantity-calc.js loaded first.

const qtyKey = (v) => String(v == null ? '' : v).trim();

function qtyMoney(n) {
  return n == null ? '-' : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
const qtyNum = (n) => (Math.round(n * 10000) / 10000).toLocaleString();

// Every catalog item, plus anything logged or billed that isn't in it.
function qtyItems(project, extraItemNumbers) {
  const flat = (extraItemNumbers || []).map((itemNumber) => ({ itemNumber, qty: 0 }));
  return fullPayItemCatalogOverview(flat, project.payItemCatalog).map((it) => ({
    itemNumber: it.itemNumber,
    description: it.description || '',
    unit: it.unit || '',
    isLump: isLumpSumItem(it),
    price: it.unitPrice != null ? Number(it.unitPrice) : null,
    planned: it.planned,
    contract: it.contractTotal,
  }));
}

// Quantities logged on daily reports by item. With from/to, only dated
// reports in that range (inclusive); without, every report.
function qtyLoggedByItem(reports, from, to) {
  const m = new Map();
  const ranged = from != null || to != null;
  (reports || []).forEach((r) => {
    if (r.deleted) return;
    if (ranged && (!r.date || (from && r.date < from) || (to && r.date > to))) return;
    (r.payItems || []).forEach((p) => {
      const key = qtyKey(p.itemNumber);
      const q = Number(p.qty);
      if (!key || !isFinite(q)) return;
      m.set(key, (m.get(key) || 0) + q);
    });
  });
  return m;
}

// A Pay App's billed totals to date by item (empty when there's none).
function qtyBilledByItem(estimate) {
  const m = new Map();
  Object.entries((estimate && estimate.itemTotals) || {}).forEach(([k, v]) => {
    const n = Number(v);
    if (v != null && v !== '' && isFinite(n)) m.set(qtyKey(k), n);
  });
  return m;
}

function qtyLatestEstimate(project) {
  const sorted = sortedEstimates(project.billingEstimates);
  return sorted.length ? sorted[sorted.length - 1] : null;
}

function qtyCost(it, stored) {
  if (stored == null) return null;
  if (it.isLump) return stored;
  return it.price != null ? stored * it.price : null;
}

// Stored units -> words: "$4,500" for a Lump Sum, "440 TON" otherwise.
function qtyAmountText(it, stored) {
  if (it.isLump) return qtyMoney(stored);
  return `${qtyNum(stored)} ${it.unit}`.trim();
}

// What 100% means for an item, in stored units: its value for a Lump Sum,
// its planned quantity otherwise (null when neither is on file).
function qtyPlanBase(it) {
  if (it.isLump) return it.price > 0 ? it.price : null;
  return it.planned > 0 ? it.planned : null;
}

const qtyEqual = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

// Splits logged L and billed B into: billed and logged, logged but not
// billed yet, and billed ahead of the logs.
function qtySplit(L, B) {
  if (qtyEqual(L, B)) return { both: Math.max(B, 0), ready: 0, ahead: 0 };
  return { both: Math.max(Math.min(L, B), 0), ready: Math.max(L - B, 0), ahead: Math.max(B - L, 0) };
}

function qtyStackBarHtml(split, base, extraClass) {
  const total = base > 0 ? base : Math.max(split.both + split.ready + split.ahead, 1);
  const w = (v) => `${Math.max(Math.min(v / total, 1), 0) * 100}%`;
  return `<span class="qp-stack${extraClass ? ' ' + extraClass : ''}"><i class="qp-seg-billed" style="width:${w(split.both)}"></i><i class="qp-seg-ahead" style="width:${w(split.ahead)}"></i><i class="qp-seg-ready" style="width:${w(split.ready)}"></i></span>`;
}

// Dollar totals across the priced items: contract, and the three splits.
function qtyContractSums(items, logged, billed) {
  const s = { contract: 0, both: 0, ready: 0, ahead: 0, priced: 0 };
  items.forEach((it) => {
    const c = it.contract;
    const sp = qtySplit(logged.get(it.itemNumber) || 0, billed.get(it.itemNumber) || 0);
    const both = qtyCost(it, sp.both), ready = qtyCost(it, sp.ready), ahead = qtyCost(it, sp.ahead);
    if (c == null || both == null) return;
    s.priced++;
    s.contract += c; s.both += both; s.ready += ready; s.ahead += ahead;
  });
  return s;
}

// The contract bar: Billed, Logged not billed yet, Billed ahead of logs,
// Remaining. It doubles as the key for the colors used everywhere.
function qtyContractBarHtml(sums, note) {
  if (!(sums.contract > 0)) {
    return '<p class="hint qp-noprice">Add unit prices in Project Settings to see contract totals here.</p>';
  }
  const billed = sums.both + sums.ahead;
  const remaining = Math.max(sums.contract - sums.both - sums.ready - sums.ahead, 0);
  return `<div class="qp-cbar">
    <div class="qp-cbar-top"><span class="qp-cbar-title">Contract ${qtyMoney(sums.contract)}</span>${note ? `<span class="qp-cbar-note">${escapeHtml(note)}</span>` : ''}</div>
    ${qtyStackBarHtml(sums, sums.contract, 'qp-stack-lg')}
    <div class="qp-cbar-key">
      <span><i class="qp-dot qp-seg-billed"></i><b>Billed</b> ${qtyMoney(billed)} <span class="qp-dim">(${Math.round((billed / sums.contract) * 1000) / 10}%)</span></span>
      ${sums.ready > 0.5 ? `<span><i class="qp-dot qp-seg-ready"></i><b>Logged, not billed yet</b> ${qtyMoney(sums.ready)}</span>` : ''}
      ${sums.ahead > 0.5 ? `<span><i class="qp-dot qp-seg-ahead"></i><b>Billed ahead of logs</b> ${qtyMoney(sums.ahead)}</span>` : ''}
      <span><i class="qp-dot qp-seg-rest"></i><b>Remaining</b> ${qtyMoney(remaining)}</span>
    </div>
    <p class="qp-cbar-help">Logged = what inspectors recorded in daily reports. Billed = what's been paid on Pay Apps.</p>
  </div>`;
}

// One chip saying how logged and billed compare for an item.
function qtyCheckChipHtml(it, L, B) {
  if (qtyEqual(L, B)) return '<span class="qp-chk qp-chk-ok">Matches</span>';
  const d = L - B;
  const amt = it.isLump ? qtyMoney(Math.abs(d)) : `${qtyNum(Math.abs(d))} ${it.unit}`.trim();
  return d > 0
    ? `<span class="qp-chk qp-chk-ready">${amt} to bill</span>`
    : `<span class="qp-chk qp-chk-ahead">${amt} billed ahead</span>`;
}

// An item's progress: one bar against its plan, and the numbers under it.
function qtyProgressHtml(it, L, B) {
  const base = qtyPlanBase(it);
  const show = (v) => (it.isLump ? qtyMoney(v) : qtyNum(v));
  const of = base != null ? ` &middot; of ${it.isLump ? qtyMoney(base) : `${qtyNum(base)} ${escapeHtml(it.unit)}`}` : (it.isLump ? '' : ` ${escapeHtml(it.unit)}`);
  return `${qtyStackBarHtml(qtySplit(L, B), base)}<span class="qp-prog-text">${show(L)} logged &middot; ${show(B)} billed${of}</span>`;
}

// Logged and billed percentages of the contract, for the tabs and cards.
function qtyProjectSummary(project, reports) {
  const latest = qtyLatestEstimate(project);
  const logged = qtyLoggedByItem(reports);
  const billed = qtyBilledByItem(latest);
  const items = qtyItems(project, [...logged.keys(), ...billed.keys()]);
  const sums = qtyContractSums(items, logged, billed);
  const loggedCost = sums.both + sums.ready;
  const billedCost = sums.both + sums.ahead;
  return {
    latest,
    payAppCount: (project.billingEstimates || []).length,
    loggedPct: sums.contract > 0 ? loggedCost / sums.contract : null,
    billedPct: sums.contract > 0 ? billedCost / sums.contract : null,
    loggedCost, billedCost, contract: sums.contract,
  };
}

const qtyPctText = (p) => `${Math.round(p * 1000) / 10}%`;

// The Quantities | Pay Apps tab bar at the top of both pages.
function qtySectionTabsHtml(project, summary, active) {
  const tab = (key, label, href, count) => `<a class="qp-tab${active === key ? ' qp-tab-active' : ''}" href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}${count ? ` <span class="qp-tab-count">${count}</span>` : ''}</a>`;
  return `<nav class="qp-tabs" aria-label="Quantities and Pay Apps">
    ${tab('quantities', 'Quantities', `quantity-sheet.html?project=${encodeURIComponent(project.id)}`, summary.loggedPct != null ? `${Math.round(summary.loggedPct * 100)}% logged` : '')}
    ${tab('payapps', 'Pay Apps', `pay-apps.html?project=${encodeURIComponent(project.id)}`, summary.billedPct != null && summary.payAppCount ? `${Math.round(summary.billedPct * 100)}% billed` : (summary.payAppCount ? String(summary.payAppCount) : ''))}
  </nav>`;
}
