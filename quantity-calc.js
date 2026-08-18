// Pay-item quantity aggregation shared by the Quantity Sheet and the project
// dashboard, so "how much of each item has been used" and "% complete" are
// computed exactly one way in both places.

// Sums each pay item's quantity across a flat list of pay-item entries
// (first-seen order, so it's on the caller to pass them in whatever order
// "first seen" should mean -- chronological, undated-last, whatever fits),
// then matches each against the project's catalog to attach a planned
// quantity and a percent-complete -- both left null when no planned quantity
// is on file, so callers can show a blank instead of a misleading 0%.
function aggregatePayItemTotals(flatItems, payItemCatalog) {
  const itemOrder = [];
  const itemMeta = new Map();
  const totalQty = new Map();

  for (const it of (flatItems || []).filter((it) => it && String(it.itemNumber || '').trim() !== '')) {
    const key = String(it.itemNumber).trim();
    if (!itemMeta.has(key)) {
      itemMeta.set(key, { itemNumber: key, description: it.description || '', unit: it.unit || '' });
      itemOrder.push(key);
      totalQty.set(key, 0);
    }
    totalQty.set(key, totalQty.get(key) + (Number(it.qty) || 0));
  }

  const catalogByItem = new Map((payItemCatalog || []).map((p) => [String(p.itemNumber).trim(), p]));

  return itemOrder.map((key) => {
    const meta = itemMeta.get(key);
    const total = totalQty.get(key);
    const cat = catalogByItem.get(key);
    const planned = cat && Number(cat.plannedQty) > 0 ? Number(cat.plannedQty) : null;
    return {
      itemNumber: meta.itemNumber,
      description: meta.description,
      unit: meta.unit,
      total,
      planned,
      pct: planned != null ? total / planned : null,
    };
  });
}

// Quantity-weighted aggregate across every item that has planned data on
// file: sum(quantity used) / sum(quantity planned), not a simple average of
// each item's own percentage or a count of "finished" items. Items with no
// planned quantity are excluded from both the numerator and denominator
// rather than silently counted as 0%.
function overallPercentComplete(items) {
  let sumTotal = 0;
  let sumPlanned = 0;
  for (const it of items) {
    if (it.planned != null) {
      sumTotal += it.total;
      sumPlanned += it.planned;
    }
  }
  return sumPlanned > 0 ? sumTotal / sumPlanned : null;
}
