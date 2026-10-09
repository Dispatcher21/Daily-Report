// Dashboards made of widgets each person can arrange -- the home page's
// Manager Dashboard and every project page's dashboard. A board is a list of
// { id, type, size: 'half' | 'full', config } saved per person (see
// getDashboardWidgets/saveDashboardWidgets in storage.js, synced with the
// rest of their layout). The page supplies the widget types and how each
// one draws; this file handles everything around that: drawing them in
// order, Edit Dashboard (move, resize, remove with Undo, add, reset, and
// dragging by the header with a mouse), and the Add a Widget sheet.
//
// Needs page-ui.js (sheets, toast) and common.js.

function createWidgetBoard(opts) {
  // opts: {
  //   board: 'home' | 'project',      which saved list this is
  //   container, editBtn, banner,     elements on the page
  //   addBtn, resetBtn, doneBtn,
  //   types: { key: { tag, title, icon, desc, size, render(body, widget, board), available?() } },
  //   defaults(): [{ type, size }],   the starting set when never customized
  //   customBuilder?(existing, onSave)  opens the "Make your own" sheet
  //   onRendered?()                   after every draw (animations etc.)
  // }
  const state = { widgets: [], editing: false, dragId: null };
  const fine = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  const typeOf = (w) => opts.types[w.type];
  const usable = (w) => !!typeOf(w) && (!typeOf(w).available || typeOf(w).available());
  const newId = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const titleOf = (w) => (w.type === 'custom' && w.config && w.config.title) || (typeOf(w) ? typeOf(w).title : 'Widget');

  async function load() {
    const saved = await getDashboardWidgets(opts.board);
    state.widgets = saved || opts.defaults().map((d) => ({ id: newId(), type: d.type, size: d.size || 'half', config: d.config || {} }));
  }

  function persist() {
    return saveDashboardWidgets(opts.board, state.widgets).catch((err) => console.error('dashboard widgets save:', err));
  }

  function render() {
    const { container } = opts;
    const editing = state.editing;
    const shown = state.widgets.filter(usable);
    container.closest('.dash-col')?.classList.toggle('dash-editing', editing);
    if (opts.editBtn) {
      opts.editBtn.textContent = editing ? 'Done' : 'Edit Dashboard';
      opts.editBtn.setAttribute('aria-pressed', String(editing));
    }
    if (opts.banner) opts.banner.hidden = !editing;

    container.innerHTML = '';
    shown.forEach((w, i) => {
      const t = typeOf(w);
      const el = document.createElement('div');
      el.className = `step widget w-${w.size === 'full' ? 'full' : 'half'}`;
      el.dataset.wid = w.id;
      el.dataset.type = w.type;
      const ctrls = editing ? `<span class="w-ctrls">
          <button type="button" data-w="up" aria-label="Move up"${i === 0 ? ' disabled' : ''}>&#9650;</button>
          <button type="button" data-w="down" aria-label="Move down"${i === shown.length - 1 ? ' disabled' : ''}>&#9660;</button>
          <button type="button" data-w="size">${w.size === 'full' ? 'Half width' : 'Full width'}</button>
          ${w.type === 'custom' && opts.customBuilder ? '<button type="button" data-w="edit" aria-label="Edit widget">&#9881;&#65039;</button>' : ''}
          <button type="button" data-w="remove" aria-label="Remove widget">&#10005;</button>
        </span>` : '';
      el.innerHTML = `
        <div class="step-header"${editing && fine ? ' draggable="true"' : ''}>
          ${editing ? '<span class="w-grip" aria-hidden="true">&#8942;&#8942;</span>' : ''}
          <span class="step-num">${escapeHtml(t.tag)}</span>
          <h2>${escapeHtml(titleOf(w))}</h2>
          ${ctrls}
        </div>
        <div class="step-body"></div>`;
      container.appendChild(el);
      const body = el.querySelector('.step-body');
      // One widget failing to draw (odd data on one project, say) must not
      // take the rest of the dashboard down with it.
      try {
        const out = t.render(body, w, api);
        if (typeof out === 'string') body.innerHTML = out;
      } catch (err) {
        console.error(`widget ${w.type}:`, err);
        body.innerHTML = '<p class="hint" style="margin:0;">This widget couldn\'t be shown right now.</p>';
      }
    });

    if (editing) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'w-add';
      add.dataset.wAdd = '1';
      add.textContent = '+ Add a Widget';
      container.appendChild(add);
    } else if (shown.length === 0) {
      container.insertAdjacentHTML('beforeend', '<div class="dash-empty w-empty">This dashboard is empty. Use Edit Dashboard to add widgets.</div>');
    }
    if (opts.onRendered) opts.onRendered();
  }

  // Re-draws just one widget (e.g. after its own range picker changes).
  function rerender(id) {
    const w = state.widgets.find((x) => x.id === id);
    const el = opts.container.querySelector(`[data-wid="${CSS.escape(id)}"]`);
    if (!w || !el || !usable(w)) return render();
    const body = el.querySelector('.step-body');
    try {
      const out = typeOf(w).render(body, w, api);
      if (typeof out === 'string') body.innerHTML = out;
    } catch (err) {
      console.error(`widget ${w.type}:`, err);
    }
    if (opts.onRendered) opts.onRendered();
  }

  function setEditing(on) {
    state.editing = !!on;
    render();
  }

  function addWidget(type, config) {
    const t = opts.types[type];
    state.widgets.push({ id: newId(), type, size: (t && t.size) || 'half', config: config || {} });
    persist();
    render();
  }

  function openAddSheet() {
    const have = new Set(state.widgets.filter(usable).map((w) => w.type));
    const keys = Object.keys(opts.types).filter((k) => k !== 'custom' && (!opts.types[k].available || opts.types[k].available()));
    const rows = keys.map((k) => {
      const t = opts.types[k];
      const on = have.has(k);
      return `<button type="button" class="sheet-item" data-add="${k}"${on ? ' disabled' : ''}>
          <span class="ic">${t.icon || ''}</span>
          <span class="wg-text"><b>${escapeHtml(t.title)}</b><small>${escapeHtml(t.desc || '')}</small></span>
          <span class="after">${on ? 'On dashboard' : 'Add'}</span>
        </button>`;
    }).join('');
    const custom = opts.customBuilder && opts.types.custom ? `<hr class="sheet-sep">
        <button type="button" class="sheet-item" data-add="custom">
          <span class="ic">${opts.types.custom.icon || ''}</span>
          <span class="wg-text"><b>Make your own&hellip;</b><small>${escapeHtml(opts.types.custom.desc || '')}</small></span>
          <span class="after">&#8250;</span>
        </button>` : '';
    openSheet(`
      <h3 class="sheet-title">Add a Widget</h3>
      <p class="sheet-sub">Widgets already on your dashboard are marked.</p>
      <div class="sheet-list">${rows}${custom}</div>
      <div class="sheet-actions"><button type="button" class="btn-secondary" data-close-sheet>Close</button></div>`, {
      onMount: (card) => {
        card.querySelector('[data-close-sheet]').addEventListener('click', closeSheet);
        card.addEventListener('click', (e) => {
          const b = e.target.closest('[data-add]');
          if (!b || b.disabled) return;
          if (b.dataset.add === 'custom') {
            opts.customBuilder(null, (config) => { addWidget('custom', config); showToast('Widget added to the end of your dashboard'); });
            return;
          }
          closeSheet();
          addWidget(b.dataset.add);
          showToast(`Added ${opts.types[b.dataset.add].title}`);
        });
      },
    });
  }

  function reset() {
    const before = state.widgets;
    state.widgets = opts.defaults().map((d) => ({ id: newId(), type: d.type, size: d.size || 'half', config: d.config || {} }));
    persist();
    render();
    showToast('Dashboard reset to the default widgets', () => { state.widgets = before; persist(); render(); });
  }

  // Edit controls on each widget.
  opts.container.addEventListener('click', (e) => {
    if (e.target.closest('[data-w-add]')) return openAddSheet();
    const ctl = e.target.closest('[data-w]');
    if (!ctl || !state.editing) return;
    const el = ctl.closest('[data-wid]');
    const w = state.widgets.find((x) => x.id === el.dataset.wid);
    if (!w) return;
    const action = ctl.dataset.w;
    // Moves are between the widgets actually shown, so a saved widget this
    // person can't use right now (a permission they lost) never blocks one.
    const shown = state.widgets.filter(usable);
    const i = shown.indexOf(w);
    if (action === 'up' || action === 'down') {
      const other = shown[i + (action === 'up' ? -1 : 1)];
      if (!other) return;
      const a = state.widgets.indexOf(w), b = state.widgets.indexOf(other);
      [state.widgets[a], state.widgets[b]] = [state.widgets[b], state.widgets[a]];
    } else if (action === 'size') {
      w.size = w.size === 'full' ? 'half' : 'full';
    } else if (action === 'edit' && opts.customBuilder) {
      opts.customBuilder(w, (config) => { w.config = config; persist(); render(); showToast('Widget saved'); });
      return;
    } else if (action === 'remove') {
      const at = state.widgets.indexOf(w);
      state.widgets.splice(at, 1);
      persist();
      render();
      showToast(`Removed ${titleOf(w)}`, () => { state.widgets.splice(Math.min(at, state.widgets.length), 0, w); persist(); render(); });
      return;
    }
    persist();
    render();
  });

  // Dragging a widget by its header (mouse only, edit mode only).
  opts.container.addEventListener('dragstart', (e) => {
    const header = e.target.closest && e.target.closest('.step-header');
    const el = header && header.closest('[data-wid]');
    if (!el || !state.editing) return;
    state.dragId = el.dataset.wid;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', state.dragId);
  });
  opts.container.addEventListener('dragend', () => {
    state.dragId = null;
    $$('.dragging, .w-drop', opts.container).forEach((x) => x.classList.remove('dragging', 'w-drop'));
  });
  opts.container.addEventListener('dragover', (e) => {
    if (!state.dragId) return;
    const target = e.target.closest('[data-wid]');
    $$('.w-drop', opts.container).forEach((x) => { if (x !== target) x.classList.remove('w-drop'); });
    if (!target || target.dataset.wid === state.dragId) return;
    e.preventDefault();
    target.classList.add('w-drop');
  });
  opts.container.addEventListener('drop', (e) => {
    if (!state.dragId) return;
    const target = e.target.closest('[data-wid]');
    if (!target) return;
    e.preventDefault();
    const from = state.widgets.findIndex((x) => x.id === state.dragId);
    const [moved] = state.widgets.splice(from, 1);
    state.widgets.splice(state.widgets.findIndex((x) => x.id === target.dataset.wid), 0, moved);
    state.dragId = null;
    persist();
    render();
  });

  if (opts.editBtn) opts.editBtn.addEventListener('click', () => setEditing(!state.editing));
  if (opts.doneBtn) opts.doneBtn.addEventListener('click', () => setEditing(false));
  if (opts.addBtn) opts.addBtn.addEventListener('click', openAddSheet);
  if (opts.resetBtn) opts.resetBtn.addEventListener('click', reset);

  const api = {
    load, render, rerender, setEditing, persist,
    get widgets() { return state.widgets; },
    get editing() { return state.editing; },
    has: (type) => state.widgets.some((w) => w.type === type && usable(w)),
  };
  return api;
}

// ---------- Widget helpers shared by both dashboards ----------

// A horizontal bar per row: [[labelHtml, value], ...], longest first.
function widgetBarRows(rows, fmt) {
  if (!rows.length) return '<p class="hint" style="margin:0;">Nothing to show for this range yet.</p>';
  const max = Math.max(...rows.map((r) => r[1])) || 1;
  return `<div class="md-bars">${rows.map(([label, v]) => `
    <div class="md-bar-row">
      <span class="md-bar-name">${label}</span>
      <div class="md-bar-track"><div class="md-bar-fill" style="width:${Math.max(2, (v / max) * 100)}%"></div></div>
      <span class="md-bar-value">${fmt ? fmt(v) : v}</span>
    </div>`).join('')}</div>`;
}

// The earliest date (inclusive) for a range key used by the widgets: '7',
// '30', 'week' (since Sunday), 'month' (since the 1st), anything else = all.
function widgetRangeStart(range) {
  const d = new Date();
  if (range === '7') d.setDate(d.getDate() - 6);
  else if (range === '30') d.setDate(d.getDate() - 29);
  else if (range === 'week') d.setDate(d.getDate() - d.getDay());
  else if (range === 'month') d.setDate(1);
  else return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const WIDGET_RANGE_LABELS = { 7: 'last 7 days', 30: 'last 30 days', week: 'this week', month: 'this month', all: 'all time' };

// Each inspector's hours on one report: the per-inspector list where the
// report has one, the older single representative/hours pair otherwise.
function reportInspectorHours(r) {
  const list = Array.isArray(r.inspectors) && r.inspectors.length ? r.inspectors : [{ name: r.representative, hours: r.hours }];
  return list
    .map((insp) => ({ name: (insp.name || '').trim() || 'Unassigned', hours: Number(insp.hours) || 0 }))
    .filter((x) => x.hours > 0);
}

// How many photos a report holds (fetched or known to exist remotely).
function reportPhotoCount(r) {
  return (r.photos || []).filter((p, i) => p || (r.photosFetched && r.photosFetched[i] === false)).length;
}

// projectContractTimeline lives in contract-time.js.

// On pace / slightly behind / behind, same thresholds as the Schedule Used
// ring: 'ok' | 'warn' | 'danger', or null without enough on file.
function scheduleStatusFor(overall, timeline) {
  if (overall == null || !timeline) return null;
  if (overall + 0.05 >= timeline.frac) return 'ok';
  if (overall + 0.2 >= timeline.frac) return 'warn';
  return 'danger';
}
const SCHEDULE_STATUS_LABELS = { ok: 'On pace', warn: 'Slightly behind', danger: 'Behind' };

// "Oct 7" from an ISO date.
function shortDateLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Weekdays (Mon-Fri) after `iso` up to and including today.
function workdaysSince(iso) {
  if (!iso) return Infinity;
  let n = 0;
  const d = new Date(iso + 'T12:00:00');
  const today = todayIso();
  for (;;) {
    d.setDate(d.getDate() + 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (k > today) break;
    if (d.getDay() !== 0 && d.getDay() !== 6) n++;
  }
  return n;
}

// Percent complete against percent of contract time used, one line per
// project, with a dashed on-pace diagonal, ahead/behind shading and Pay App
// stars. series: [{ label, color, points: [{ frac, pct, date, payApp }] }]
// where frac is days since NTP over Total Contract Length.
function paceChartSvg(series, { focusLabel } = {}) {
  const W = 560, H = 300, pl = 38, pr = 14, pt = 10, pb = 34;
  const x = (t) => pl + Math.max(0, Math.min(1, t)) * (W - pl - pr);
  const y = (v) => pt + (1 - Math.max(0, Math.min(1, v || 0))) * (H - pt - pb);
  let g = `<polygon class="pace-zone-a" points="${x(0)},${y(0)} ${x(1)},${y(1)} ${x(0)},${y(1)}"></polygon>`
    + `<polygon class="pace-zone-b" points="${x(0)},${y(0)} ${x(1)},${y(0)} ${x(1)},${y(1)}"></polygon>`;
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    g += `<line class="trend-grid" x1="${x(0)}" x2="${x(1)}" y1="${y(v)}" y2="${y(v)}"></line>`
      + `<text class="trend-axis-label" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${v * 100}%</text>`
      + `<text class="trend-axis-label" x="${x(v)}" y="${H - pb + 14}" text-anchor="middle">${v === 0 ? 'NTP' : v * 100 + '%'}</text>`;
  });
  g += `<line class="pace-line" x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}"></line>`
    + `<text class="trend-axis-label" x="${x(0.5)}" y="${H - 4}" text-anchor="middle">Contract time used</text>`
    + `<text class="pace-label" x="${x(0.03)}" y="${y(0.92)}">Ahead</text>`
    + `<text class="pace-label" x="${x(0.97)}" y="${y(0.05)}" text-anchor="end">Behind</text>`;
  series.forEach((s) => {
    if (!s.points.length) return;
    const dim = focusLabel && focusLabel !== s.label;
    const pts = s.points.map((p) => `${x(p.frac).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ');
    g += `<g style="opacity:${dim ? 0.12 : 1}"><polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"></polyline>`;
    s.points.forEach((p) => {
      if (!p.payApp) return;
      g += `<polygon class="trend-star" points="${starPoints(x(p.frac), y(p.pct), 5.5)}" style="fill:${s.color}"><title>${escapeHtml(s.label)}, Pay App (${escapeHtml(p.date)}): ${((p.pct || 0) * 100).toFixed(1)}% complete</title></polygon>`;
    });
    const last = s.points[s.points.length - 1];
    g += `<circle cx="${x(last.frac)}" cy="${y(last.pct)}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"><title>${escapeHtml(s.label)}: ${Math.round((last.pct || 0) * 100)}% complete, ${Math.round(last.frac * 100)}% of contract time used</title></circle></g>`;
  });
  return `<div class="pace-chart"><svg class="trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Percent complete against contract time used, stars mark Pay Apps">${g}</svg></div>`;
}

const PACE_STAR_KEY = '<span class="trend-legend-item"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><polygon points="6,0.5 7.6,4.2 11.6,4.4 8.5,7 9.5,11 6,8.8 2.5,11 3.5,7 0.4,4.4 4.4,4.2" fill="var(--text-dim)"></polygon></svg>Pay App</span>';
