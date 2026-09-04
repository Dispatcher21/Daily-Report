// Shared rendering pieces for both project.html's per-project dashboard and
// index.html's company-wide Manager Dashboard -- kept in one place so a
// stat card, ring, or count-up animation looks and behaves identically
// wherever it shows up, rather than two copies quietly drifting apart.

// Deliberately excludes a bare "wind" -- "light wind" or "breezy" in an
// otherwise clear-day description is routine, not a schedule risk. "Windy"
// and qualified wind ("high wind", "strong wind", gusts) still count.
const ADVERSE_WEATHER_RE = /rain|storm|snow|\bice\b|icy|sleet|flood|hurricane|thunder|windy|(high|strong|heavy) wind|gust/i;

// Whole calendar days between two 'YYYY-MM-DD' strings, ignoring time of day.
function daysBetween(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00');
  const b = new Date(isoB + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

function fmtMoney(n) {
  return n == null ? '—' : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

// Real-world comparisons for the physical quantities an inspector actually
// records -- deliberately not dollars (see the project dashboard's rings for
// that side of things). Matched against a pay item's own Unit field, several
// common abbreviations per family; a unit with no natural physical
// comparison (EA, LUMP SUM, HR, DAY...) just isn't included.
//
// Each family carries a list of comparisons rather than just one -- an
// everyday object (football field, dump truck) plus, where a well-sourced
// figure at a sane scale actually exists, a notorious engineering project.
// compareValue is in the item's own recorded unit, no cross-unit conversion,
// so each family stays independent and simple. A comparison whose ratio
// would round away to nothing (see the 0.01 floor in unitFunFacts below) is
// skipped for that render rather than shown as a meaningless "0.00x" --
// mainly matters for the mega-project figures (Hoover Dam's 3.25M cubic
// yards of concrete) against an ordinary-sized project's own quantities.
const UNIT_FUN_FACTS = [
  {
    match: /^(l\.?f\.?|lin\.?\s*ft\.?|linear\s*feet|linear\s*foot|feet|foot|ft\.?)$/i,
    unitLabel: 'Linear Feet',
    comparisons: [
      { icon: '🏈', compareValue: 300, // NFL field of play, goal line to goal line
        sentence: (r) => `That's about ${fmtFunFactRatio(r)}× the length of a football field!` },
      { icon: '🌉', compareValue: 8981, // Golden Gate Bridge, total length incl. approaches
        sentence: (r) => `That's about ${fmtFunFactRatio(r)}× the length of the Golden Gate Bridge!` },
    ],
  },
  {
    match: /^(mi\.?|miles?)$/i,
    unitLabel: 'Miles',
    comparisons: [
      { icon: '🏃', compareValue: 26.2, // marathon
        sentence: (r) => `That's about ${fmtFunFactRatio(r)}× the length of a marathon!` },
      { icon: '🚢', compareValue: 51, // Panama Canal, end to end
        sentence: (r) => `That's about ${fmtFunFactRatio(r)}× the length of the Panama Canal!` },
    ],
  },
  {
    match: /^(s\.?f\.?|sq\.?\s*ft\.?|square\s*feet|square\s*foot)$/i,
    unitLabel: 'Square Feet',
    comparisons: [
      { icon: '🏀', compareValue: 4700, // NBA court, 94x50 ft
        sentence: (r) => `That's about ${fmtFunFactRatio(r)}× the size of an NBA basketball court!` },
      { icon: '🏛️', compareValue: 6600000, // The Pentagon, total office floor area
        sentence: (r) => `That's about ${fmtFunFactRatio(r)}× the floor area of the Pentagon!` },
    ],
  },
  {
    match: /^(s\.?y\.?|sq\.?\s*yd\.?|square\s*yards?)$/i,
    unitLabel: 'Square Yards',
    comparisons: [
      { icon: '🏟️', compareValue: 6400, // football field incl. end zones, 360x160 ft / 9
        sentence: (r) => `That's about ${fmtFunFactRatio(r)}× the size of a football field, end zones included!` },
      { icon: '🔺', compareValue: 63500, // Great Pyramid of Giza, base footprint
        sentence: (r) => `That's about ${fmtFunFactRatio(r)}× the footprint of the Great Pyramid of Giza!` },
    ],
  },
  {
    match: /^(c\.?y\.?|cu\.?\s*yd\.?|cubic\s*yards?)$/i,
    unitLabel: 'Cubic Yards',
    comparisons: [
      { icon: '🚛', compareValue: 10, // standard dump truck load
        sentence: (r) => `That's about ${fmtFunFactRatio(r)} standard dump truck loads!` },
      { icon: '🏗️', compareValue: 3250000, // Hoover Dam, concrete in the dam itself
        sentence: (r) => `That's about ${fmtFunFactRatio(r)}× the concrete poured for Hoover Dam!` },
    ],
  },
  {
    match: /^(tons?)$/i,
    unitLabel: 'Tons',
    comparisons: [
      { icon: '🐘', compareValue: 6, // average adult elephant
        sentence: (r) => `That's as much as ${fmtFunFactRatio(r)} adult elephants!` },
      { icon: '🗽', compareValue: 225, // Statue of Liberty, total weight
        sentence: (r) => `That's about ${fmtFunFactRatio(r)}× the weight of the Statue of Liberty!` },
    ],
  },
  {
    match: /^(gal\.?|gallons?)$/i,
    unitLabel: 'Gallons',
    comparisons: [
      { icon: '🛁', compareValue: 50, // full bathtub
        sentence: (r) => `That's enough to fill ${fmtFunFactRatio(r)} bathtubs!` },
    ],
  },
  {
    match: /^(ac\.?|acres?)$/i,
    unitLabel: 'Acres',
    comparisons: [
      { icon: '🌾', compareValue: 1.32, // football field incl. end zones, in acres
        sentence: (r) => `That's about ${fmtFunFactRatio(r)}× the size of a football field!` },
      { icon: '🏛️', compareValue: 583, // The Pentagon, full site including parking
        sentence: (r) => `That's about ${fmtFunFactRatio(r)}× the size of the Pentagon's entire site!` },
    ],
  },
];

function fmtFunFactRatio(r) {
  if (r < 1) return r.toFixed(2).replace(/\.?0+$/, '') || '0';
  if (r < 10) return (Math.round(r * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
  return Math.round(r).toLocaleString();
}
function fmtFunFactQty(n) {
  return (Math.round(n * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

// One fact per recognized (family, comparison) pair actually meaningful for
// this project, built from the same items list (fullPayItemCatalogOverview)
// the rest of the dashboard already uses -- so it reflects whatever's
// currently recorded, Pay App-superseded totals included, exactly like
// everything else here. A ratio under 0.01 is left out rather than shown as
// a rounds-to-nothing "0.00x" -- see UNIT_FUN_FACTS' own comment.
function unitFunFacts(items) {
  const totals = new Map(); // family index -> summed quantity
  for (const it of items || []) {
    if (!it.unit || !(it.total > 0)) continue;
    const idx = UNIT_FUN_FACTS.findIndex((f) => f.match.test(String(it.unit).trim()));
    if (idx === -1) continue;
    totals.set(idx, (totals.get(idx) || 0) + it.total);
  }
  const facts = [];
  for (const [idx, total] of totals.entries()) {
    const family = UNIT_FUN_FACTS[idx];
    const headline = `${fmtFunFactQty(total)} ${family.unitLabel} Recorded`;
    for (const cmp of family.comparisons) {
      const ratio = total / cmp.compareValue;
      if (ratio < 0.01) continue;
      facts.push({ icon: cmp.icon, headline, sub: cmp.sentence(ratio) });
    }
  }
  return facts;
}

// `strokeColorOverride` lets a caller encode its own health judgement (e.g.
// a schedule ring: more elapsed isn't "good" the way more complete is, so
// it can't reuse this function's default green-at-100% logic).
function ringSvg(pct, strokeColorOverride) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const frac = pct == null ? 0 : Math.max(0, Math.min(1, pct));
  const offset = c * (1 - frac);
  const strokeColor = strokeColorOverride || (pct == null ? 'var(--border-strong)' : pct >= 1 ? 'var(--ok)' : 'var(--brand)');
  // Rendered fully empty (stroke-dashoffset = the whole circumference), the
  // percent text at 0%, with the real values stashed in data attributes --
  // animateDashboardFills brings both up together a beat after this lands
  // in the DOM.
  const pctCountAttrs = pct != null ? ` data-count-target="${pct * 100}" data-count-fmt="pct"` : '';
  return `
    <div class="ring-wrap">
      <svg viewBox="0 0 90 90">
        <circle class="ring-track" cx="45" cy="45" r="${r}"></circle>
        <circle class="ring-fill" cx="45" cy="45" r="${r}" stroke="${strokeColor}"
          stroke-dasharray="${c}" stroke-dashoffset="${c}" data-target-offset="${pct == null ? c : offset}"></circle>
      </svg>
      <span class="ring-pct"${pctCountAttrs}>${pct == null ? '—' : '0%'}</span>
    </div>`;
}

const DASH_COUNT_FORMATS = {
  int: (n) => String(Math.round(n)),
  decimal1: (n) => n.toFixed(1),
  money: (n) => fmtMoney(n),
  pct: (n) => Math.round(n) + '%',
  hours: (n) => n.toFixed(1) + 'h',
};

// `barPct`, if given, draws a slim fill bar under the value -- for a stat
// that's naturally "some amount of a known total" (Earned to Date against
// Total Contract Value) rather than a standalone number. `fmt`, if given
// (a DASH_COUNT_FORMATS key) and `value` is an actual number, renders at
// zero and counts up to `value` -- see animateDashboardFills, which is what
// actually drives it, in lockstep with the ring above and every other
// counted number on the dashboard. A non-numeric `value` (typically '—'
// for "no data") is shown as-is and never animated -- there's nothing to
// count up from.
function statCard(value, label, sub, tip, barPct, fmt) {
  const tipAttrs = tip ? ` data-tip="${escapeHtml(tip)}" tabindex="0"` : '';
  const barHtml = barPct != null
    ? `<div class="dc-bar-track"><div class="dc-bar-fill" style="width:0%;background:${barPct >= 1 ? 'var(--ok)' : 'var(--brand)'};" data-target-width="${Math.max(0, Math.min(100, barPct * 100))}"></div></div>`
    : '';
  const countable = fmt && typeof value === 'number' && Number.isFinite(value);
  const displayValue = countable ? DASH_COUNT_FORMATS[fmt](0) : String(value);
  // finalText is what fitDashboardValues (below) actually measures against
  // -- the zero-state placeholder above is usually shorter than the real
  // value ("$0" vs "$2,245,772"), and shrinking to fit that instead would
  // undershoot: the box would look fine for a moment and then overflow the
  // instant the number finishes counting up to its real, wider width.
  const countAttrs = countable
    ? ` data-count-target="${value}" data-count-fmt="${fmt}" data-final-text="${escapeHtml(DASH_COUNT_FORMATS[fmt](value))}"`
    : '';
  return `
    <div class="dash-card"${tipAttrs}>
      <span class="dc-value"${countAttrs}>${escapeHtml(displayValue)}</span>
      <span class="dc-label">${escapeHtml(label)}</span>
      ${sub ? `<span class="dc-sub">${escapeHtml(sub)}</span>` : ''}
      ${barHtml}
    </div>`;
}

const DASH_ANIM_DURATION = 700; // ms -- shared by every ring, bar, and counted number so they all land at the same moment
const DASH_ANIM_STEPS = 24;

// Brings every ring, bar, and counted number on the dashboard up from zero
// together on one shared clock, so they all finish at the same time instead
// of each running its own animation on its own schedule. setTimeout-driven
// throughout, not requestAnimationFrame, which can stall indefinitely on a
// hidden/backgrounded tab and would leave the whole dashboard stuck at
// zero for a project opened that way.
function animateDashboardFills() {
  const rings = $$('.ring-fill[data-target-offset]').map((el) => ({
    el, from: parseFloat(el.getAttribute('stroke-dasharray')), to: parseFloat(el.dataset.targetOffset),
  }));
  // .dc-bar-fill (the stat-card sub-bar) and .md-bar-fill (Hours per
  // Employee) both animate through the same [data-target-width] mechanism,
  // so a new bar style elsewhere gets this animation for free by just using
  // that attribute -- no changes needed here.
  const bars = $$('[data-target-width]').map((el) => ({ el, to: parseFloat(el.dataset.targetWidth) }));
  const counts = $$('[data-count-target]').map((el) => ({
    el, to: parseFloat(el.dataset.countTarget), fmt: DASH_COUNT_FORMATS[el.dataset.countFmt] || DASH_COUNT_FORMATS.int,
  }));
  if (rings.length === 0 && bars.length === 0 && counts.length === 0) return;

  const applyAt = (eased) => {
    rings.forEach((r) => { r.el.style.strokeDashoffset = r.from - (r.from - r.to) * eased; });
    bars.forEach((b) => { b.el.style.width = b.to * eased + '%'; });
    counts.forEach((c) => { c.el.textContent = c.fmt(c.to * eased); });
  };

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    applyAt(1);
    return;
  }

  setTimeout(() => {
    let step = 0;
    function tick() {
      step++;
      const t = Math.min(1, step / DASH_ANIM_STEPS);
      applyAt(1 - Math.pow(1 - t, 3)); // ease-out cubic
      if (t < 1) setTimeout(tick, DASH_ANIM_DURATION / DASH_ANIM_STEPS);
    }
    tick();
  }, 30);
}

// Shrinks a stat card's value to fit on one line before wrapping -- a plain
// CSS font-size never adapts to how wide the actual figure turns out to be
// (a report count and a dollar total need very different sizes to both look
// intentional), and text-overflow:ellipsis on a number just hides digits.
// Re-run on resize (debounced below), since a card's available width
// changes with it.
function fitDashboardValues() {
  $$('.dash-card .dc-value').forEach((el) => {
    // A counting value renders at "0"/"$0" initially, which is shorter
    // than the real figure it's about to count up to -- measure against
    // the real one (see statCard) so the shrink decision is still right
    // once counting finishes, then put the placeholder back.
    const original = el.textContent;
    if (el.dataset.finalText) el.textContent = el.dataset.finalText;
    el.style.fontSize = '';
    el.style.whiteSpace = 'nowrap';
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth + 0.5 && size > 11) {
      size -= 0.5;
      el.style.fontSize = size + 'px';
    }
    if (el.scrollWidth > el.clientWidth + 0.5) el.style.whiteSpace = 'normal';
    if (el.dataset.finalText) el.textContent = original;
  });
}

let fitDashboardValuesResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(fitDashboardValuesResizeTimer);
  fitDashboardValuesResizeTimer = setTimeout(fitDashboardValues, 150);
});

// ---------- Progress-over-time trend chart (hand-rolled SVG line chart) ----------
// Shared by project.html's own Progress Over Time card and index.html's
// Manager Dashboard trend -- `container` is passed in rather than looked up
// by a fixed id, so each caller keeps its own show/hide-when-empty logic.

function trendDateLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}/${m[3]}` : iso;
}

// A small, fixed categorical palette for telling several lines on the same
// chart apart -- distinct from the semantic ok/warn/danger colors used
// elsewhere (those mean something specific; these just need to be
// distinguishable from each other), and picked to stay legible against
// both a light and a dark --surface.
const TREND_LINE_COLORS = ['#3d6fa8', '#c9622f', '#2f9e6f', '#a13d8f', '#c9a227', '#3d97a1', '#a13d4f', '#6b7c3d'];

// `series`: [{ label, color, points }], points: [{ date, pct, earned }] --
// pct in 0..1, earned in dollars (both optional per-point; the tooltip just
// omits whichever is missing). A single series with no `color` draws like
// the original one-line chart (filled area under the line); 2+ series (or
// one with a color) draw as plain colored lines with a small legend below,
// since overlapping filled areas from several projects would just be
// visual noise. `opts.w`/`opts.h` override the default viewBox size --
// e.g. a shorter `h` for a chart that needs to take up less vertical room.
//
// `opts.xAxis === 'daysSinceStart'` switches the x-axis from actual
// calendar date to elapsed days since each point's own `.day` (e.g. days
// since that project's NTP date). Each series is normalized to ITS OWN
// elapsed range -- day 0 (NTP) at the left edge, that project's own `.maxDay`
// (its current elapsed day count, i.e. "today") at the right edge -- rather
// than one range shared across every series. A shared range would squeeze a
// newer project's entire history into a sliver whenever another included
// project has been running far longer; normalizing per series instead means
// every line spans the full NTP-to-today width regardless of how long that
// project has actually been going, which is what actually makes pace
// comparable at a glance. Points still carry `.date` for the tooltip.
// A 5-point star's polygon coordinates, outer radius fixed relative to the
// dot radii it stands in for (see renderTrendSvg) and inner radius a fixed
// proportion of that -- a real drawn shape rather than a Unicode glyph, so
// it stays crisp and consistently sized across browsers/fonts.
function starPoints(cx, cy, outerR) {
  const innerR = outerR * 0.42;
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function renderTrendSvg(container, series, opts) {
  series = (series || []).filter((s) => s.points && s.points.length > 0);
  if (series.length === 0) { container.innerHTML = ''; return; }

  const w = (opts && opts.w) || 640, h = (opts && opts.h) || 220;
  const padL = 38, padR = 12, padT = 14, padB = 26;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const daysMode = opts && opts.xAxis === 'daysSinceStart';

  let xOf, xStartLabel, xEndLabel;
  if (daysMode) {
    xOf = (p, s) => {
      const maxDay = Math.max(1, s.maxDay || 0);
      return padL + innerW * (Math.max(0, Math.min(maxDay, p.day || 0)) / maxDay);
    };
    xStartLabel = 'NTP';
    xEndLabel = 'Today';
  } else {
    // Positioned by actual calendar date, not point index -- with more than
    // one series, different projects' report dates rarely line up, so index
    // position alone would misalign them.
    const allDates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
    const minMs = new Date(allDates[0] + 'T00:00:00').getTime();
    const maxMs = new Date(allDates[allDates.length - 1] + 'T00:00:00').getTime();
    const span = Math.max(1, maxMs - minMs);
    const xCal = (dateIso) => minMs === maxMs
      ? padL + innerW / 2
      : padL + innerW * ((new Date(dateIso + 'T00:00:00').getTime() - minMs) / span);
    xOf = (p) => xCal(p.date);
    xStartLabel = trendDateLabel(allDates[0]);
    xEndLabel = allDates.length > 1 ? trendDateLabel(allDates[allDates.length - 1]) : null;
  }
  const y = (pct) => padT + innerH * (1 - Math.max(0, Math.min(1, pct || 0)));

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const gy = y(f);
    return `<line x1="${padL}" y1="${gy}" x2="${w - padR}" y2="${gy}" class="trend-grid"></line>
      <text x="${padL - 6}" y="${gy + 3}" class="trend-axis-label" text-anchor="end">${Math.round(f * 100)}%</text>`;
  }).join('');

  const singlePlainSeries = series.length === 1 && !series[0].color;
  const seriesSvg = series.map((s) => {
    const color = s.color || 'var(--brand)';
    const coords = s.points.map((p) => [xOf(p, s), y(p.pct)]);
    let pathSection = '';
    if (coords.length > 1) {
      const linePath = 'M' + coords.map((c) => c.join(',')).join(' L');
      if (singlePlainSeries) {
        const areaPath = `M${coords[0][0]},${padT + innerH} L${coords.map((c) => c.join(',')).join(' L')} L${coords[coords.length - 1][0]},${padT + innerH} Z`;
        pathSection = `<path d="${areaPath}" class="trend-area"></path><path d="${linePath}" class="trend-line"></path>`;
      } else {
        // One <path> per segment rather than a single continuous one, so a
        // segment leading out of a synthetic point (a project's assumed 0%
        // at NTP, stood in for a real report -- see renderMdTrendChart) can
        // be dashed to mark it as "not an actual data point" while the rest
        // of the line stays solid.
        pathSection = coords.slice(1).map((c, i) => {
          const dashed = s.points[i].synthetic ? ' stroke-dasharray:5,4;' : '';
          return `<path d="M${coords[i].join(',')} L${c.join(',')}" class="trend-line" style="stroke:${color};${dashed}"></path>`;
        }).join('');
      }
    }
    const dots = s.points.map((p, i) => {
      const [cx, cy] = coords[i];
      const when = daysMode ? `Day ${p.day} (${p.date})` : p.date;
      const tip = p.synthetic
        ? `${s.label ? s.label + ' — ' : ''}NTP (${p.date}): assumed 0% complete, no report on file yet`
        : `${s.label ? s.label + ' — ' : ''}${when}${p.payApp ? ' — Pay App' : ''}: ${p.pct != null ? (p.pct * 100).toFixed(1) + '% complete' : 'no target set yet'}${p.earned != null ? ', ' + fmtMoney(p.earned) + ' earned' : ''}`;
      const titleTag = `<title>${escapeHtml(tip)}</title>`;
      // A Pay App point is a real jump, not routine report-by-report growth
      // -- marked with a star instead of a dot, in the same gold already
      // used for a favorited project, and left visible even in daysMode
      // (where ordinary dots go invisible-but-still-hoverable to cut
      // clutter across several overlapping project lines): a Pay App is
      // the rarer, more significant event of the two, worth standing out
      // rather than blending into the noise-reduction rule made for dots.
      if (p.payApp) {
        return `<polygon points="${starPoints(cx, cy, daysMode ? 7 : singlePlainSeries ? 6 : 5)}" class="trend-star">${titleTag}</polygon>`;
      }
      // daysMode (the Manager Dashboard's multi-project chart) draws lines
      // only -- visible dots at every report date were noise once several
      // projects' lines were overlapping. The circle still exists, just
      // invisible, so hovering the line's actual points still gets a tooltip.
      const visible = daysMode ? 'fill:transparent;stroke:none' : `fill:${color}`;
      return `<circle cx="${cx}" cy="${cy}" r="${daysMode ? 6 : singlePlainSeries ? 4 : 3}" class="trend-dot" style="${visible}">${titleTag}</circle>`;
    }).join('');
    return pathSection + dots;
  }).join('');

  const xLabels = `<text x="${padL}" y="${h - 6}" class="trend-axis-label" text-anchor="start">${xStartLabel}</text>` +
    (xEndLabel ? `<text x="${w - padR}" y="${h - 6}" class="trend-axis-label" text-anchor="end">${xEndLabel}</text>` : '');

  const legendHtml = series.length > 1
    ? `<div class="trend-legend">${series.map((s) => `
        <span class="trend-legend-item"><span class="trend-legend-dot" style="background:${s.color || 'var(--brand)'}"></span>${escapeHtml(s.label || '')}</span>`).join('')}</div>`
    : '';

  container.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" class="trend-svg" role="img" aria-label="Percent complete over time">
      ${gridLines}${seriesSvg}${xLabels}
    </svg>${legendHtml}`;
}

// ---------- Collapsible sections ----------
// Opt-in per .step via the .step-collapsible class (see style.css) -- click
// the header to fold/unfold the body. Wires any not-yet-wired header found
// under `container` (default: the whole document), so it's safe to call
// again after re-rendering a section that replaces its own DOM.
function setupCollapsibleSteps(container) {
  $$('.step-collapsible > .step-header', container || document).forEach((header) => {
    if (header.dataset.collapsibleWired) return;
    header.dataset.collapsibleWired = '1';
    header.insertAdjacentHTML('beforeend', '<span class="step-chevron">&#9656;</span>');
    header.addEventListener('click', (e) => {
      if (e.target.closest('.info-tip')) return;
      header.closest('.step-collapsible').classList.toggle('collapsed');
    });
  });
}
