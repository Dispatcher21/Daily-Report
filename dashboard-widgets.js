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

// `points`: [{ date, pct, earned }] -- pct in 0..1, earned in dollars (both
// optional per-point; the tooltip just omits whichever is missing).
function renderTrendSvg(container, points) {
  if (points.length === 0) { container.innerHTML = ''; return; }

  const w = 640, h = 220, padL = 38, padR = 12, padT = 14, padB = 26;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const n = points.length;
  const x = (i) => padL + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const y = (pct) => padT + innerH * (1 - Math.max(0, Math.min(1, pct || 0)));

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const gy = y(f);
    return `<line x1="${padL}" y1="${gy}" x2="${w - padR}" y2="${gy}" class="trend-grid"></line>
      <text x="${padL - 6}" y="${gy + 3}" class="trend-axis-label" text-anchor="end">${Math.round(f * 100)}%</text>`;
  }).join('');

  const coords = points.map((p, i) => [x(i), y(p.pct)]);
  let pathSection = '';
  if (n > 1) {
    const linePath = 'M' + coords.map((c) => c.join(',')).join(' L');
    const areaPath = `M${coords[0][0]},${padT + innerH} L${coords.map((c) => c.join(',')).join(' L')} L${coords[n - 1][0]},${padT + innerH} Z`;
    pathSection = `<path d="${areaPath}" class="trend-area"></path><path d="${linePath}" class="trend-line"></path>`;
  }

  const dots = points.map((p, i) => {
    const [cx, cy] = coords[i];
    const tip = `${p.date}: ${p.pct != null ? (p.pct * 100).toFixed(1) + '% complete' : 'no target set yet'}${p.earned != null ? ', ' + fmtMoney(p.earned) + ' earned' : ''}`;
    return `<circle cx="${cx}" cy="${cy}" r="4" class="trend-dot"><title>${escapeHtml(tip)}</title></circle>`;
  }).join('');

  const xLabels = `<text x="${x(0)}" y="${h - 6}" class="trend-axis-label" text-anchor="start">${trendDateLabel(points[0].date)}</text>` +
    (n > 1 ? `<text x="${x(n - 1)}" y="${h - 6}" class="trend-axis-label" text-anchor="end">${trendDateLabel(points[n - 1].date)}</text>` : '');

  container.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" class="trend-svg" role="img" aria-label="Percent complete over time">
      ${gridLines}${pathSection}${dots}${xLabels}
    </svg>`;
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
    header.addEventListener('click', () => {
      header.closest('.step-collapsible').classList.toggle('collapsed');
    });
  });
}
