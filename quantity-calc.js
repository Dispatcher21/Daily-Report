// Pay-item quantity aggregation shared by the Quantity Sheet and the project
// dashboard, so "how much of each item has been used" and "% complete" are
// computed exactly one way in both places.

// A catalog's Unit Price cell is free text (same as Per Plans Total) --
// blank, non-numeric, or negative all mean "no price on file", not $0.
function parsedUnitPrice(cat) {
  const n = cat ? Number(cat.unitPrice) : NaN;
  return cat && cat.unitPrice !== '' && cat.unitPrice != null && isFinite(n) && n >= 0 ? n : null;
}

// A Lump Sum item has no physical quantity a daily total is ever really
// counting toward -- "0.25 of 1 LUMP SUM" isn't a meaningful measurement the
// way "0.664 of 12 MILE" is. These are deliberately kept out of % complete
// (per-item band, and the project-wide weighted Overall % Complete) even
// when a Per Plans Total happens to be on file; they still show their raw
// used quantity and can still carry a dollar value if priced.
function isLumpSumUnit(unit) {
  return /^lump\s*sum$|^l\.?s\.?$/i.test(String(unit || '').trim());
}

// A Lump Sum item isn't priced per unit the way "12 MILE @ $500/MILE" is --
// its Unit Price on file already IS the total contract value for that one
// item, and the "quantity" an inspector logs against it on a report is
// already a dollar amount earned that day (e.g. "$20,850" toward a
// $430,000 lump sum), not a multiplier. Multiplying either one by price
// the way every other unit does produces nonsense figures (a $42K running
// total on a $430K item was coming out as $18 BILLION before this).
function contractTotalFor(unit, planned, unitPrice) {
  if (unitPrice == null) return null;
  if (isLumpSumUnit(unit)) return unitPrice;
  return planned != null ? planned * unitPrice : null;
}
function earnedTotalFor(unit, total, unitPrice) {
  if (unitPrice == null) return null;
  return isLumpSumUnit(unit) ? total : total * unitPrice;
}

// Sums each pay item's quantity across a flat list of pay-item entries
// (first-seen order, so it's on the caller to pass them in whatever order
// "first seen" should mean -- chronological, undated-last, whatever fits),
// then matches each against the project's catalog to attach a planned
// quantity, unit price, percent-complete and dollar figures -- all left null
// when the underlying catalog data isn't on file, so callers can show a
// blank instead of a misleading 0.
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
    const unitPrice = parsedUnitPrice(cat);
    // The catalog's own description/unit win over whatever happened to be
    // typed on the report entry (a catalog item is the authoritative source,
    // and it's the only source at all for items with zero usage).
    const unit = (cat && cat.unit) || meta.unit;
    return {
      itemNumber: meta.itemNumber,
      description: (cat && cat.description) || meta.description,
      unit,
      total,
      planned,
      pct: planned != null && !isLumpSumUnit(unit) ? total / planned : null,
      unitPrice,
      contractTotal: contractTotalFor(unit, planned, unitPrice),
      earnedTotal: earnedTotalFor(unit, total, unitPrice),
    };
  });
}

// Every item in the project's pay item catalog, merged with usage totals
// from reports -- unlike aggregatePayItemTotals above (usage-only, since
// that's what the Quantity Sheet export wants), this always includes catalog
// items that haven't shown up on any report yet, so the project dashboard
// can show the full bid item list rather than just what's been touched so
// far. Items used on a report but missing from the catalog entirely are
// still real work performed, so they're appended after the catalog's own
// order rather than dropped.
function fullPayItemCatalogOverview(flatItems, payItemCatalog) {
  const used = aggregatePayItemTotals(flatItems, payItemCatalog);
  const usedByKey = new Map(used.map((it) => [it.itemNumber, it]));

  const overview = (payItemCatalog || [])
    .filter((cat) => String(cat.itemNumber || '').trim() !== '')
    .map((cat) => {
      const key = String(cat.itemNumber).trim();
      const hit = usedByKey.get(key);
      if (hit) return hit;
      const planned = Number(cat.plannedQty) > 0 ? Number(cat.plannedQty) : null;
      const unitPrice = parsedUnitPrice(cat);
      return {
        itemNumber: key,
        description: cat.description || '',
        unit: cat.unit || '',
        total: 0,
        planned,
        pct: planned != null && !isLumpSumUnit(cat.unit) ? 0 : null,
        unitPrice,
        contractTotal: contractTotalFor(cat.unit, planned, unitPrice),
        earnedTotal: earnedTotalFor(cat.unit, 0, unitPrice),
      };
    });

  const catalogKeys = new Set(overview.map((it) => it.itemNumber));
  const uncataloged = used.filter((it) => !catalogKeys.has(it.itemNumber));
  return overview.concat(uncataloged);
}

// Total contract value (sum of planned qty x price, across items that have
// both) and total earned to date (sum of used qty x price, across items
// with a price) for a set of items from the two functions above. Either
// comes back null rather than 0 when nothing in the set has pricing at all,
// so callers can show a blank instead of a misleading $0.
function contractValueSummary(items) {
  let totalContract = 0;
  let totalEarned = 0;
  let hasContract = false;
  let hasEarned = false;
  for (const it of items || []) {
    if (it.contractTotal != null) {
      totalContract += it.contractTotal;
      hasContract = true;
    }
    if (it.earnedTotal != null) {
      totalEarned += it.earnedTotal;
      hasEarned = true;
    }
  }
  return {
    totalContract: hasContract ? totalContract : null,
    totalEarned: hasEarned ? totalEarned : null,
    pctByValue: hasContract && hasEarned && totalContract > 0 ? totalEarned / totalContract : null,
  };
}

// Cumulative pay-item completion by calendar date, replaying each dated
// report's quantities in date order -- powers the dashboard's progress trend
// chart. Reports sharing a date are combined into one point, matching how
// the Quantity Sheet treats "day" as the unit rather than "report". Only
// ever grows more complete moving forward (usage doesn't get undone), so
// each point reflects "as of this date" rather than "on this date".
function progressOverTime(datedReports, payItemCatalog) {
  const byDate = new Map();
  for (const r of datedReports || []) {
    if (!r.date) continue;
    const items = (r.payItems || []).filter((it) => it && String(it.itemNumber || '').trim() !== '');
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(...items);
  }
  const dates = Array.from(byDate.keys()).sort();

  const points = [];
  let running = [];
  for (const date of dates) {
    running = running.concat(byDate.get(date));
    const items = fullPayItemCatalogOverview(running, payItemCatalog);
    const { totalEarned } = contractValueSummary(items);
    points.push({ date, pct: overallPercentComplete(items), earned: totalEarned });
  }
  return points;
}

// Quantity-weighted aggregate across every item that has planned data on
// file: sum(quantity used) / sum(quantity planned), not a simple average of
// each item's own percentage or a count of "finished" items. Items with no
// planned quantity are excluded from both the numerator and denominator
// rather than silently counted as 0% -- as are Lump Sum items, whose
// "quantity" isn't on the same physical scale as everything else being
// summed, even on the rare occasion one has a Per Plans Total on file.
function overallPercentComplete(items) {
  let sumTotal = 0;
  let sumPlanned = 0;
  for (const it of items) {
    if (it.planned != null && !isLumpSumUnit(it.unit)) {
      sumTotal += it.total;
      sumPlanned += it.planned;
    }
  }
  return sumPlanned > 0 ? sumTotal / sumPlanned : null;
}
