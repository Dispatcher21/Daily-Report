// Small UI pieces shared by the home, project and Manager pages: option
// sheets (the app's own modal card, shown as a bottom sheet on phones -- see
// style.css's .sheet-overlay) and a short message along the bottom of the
// screen with an optional Undo button. Classic script, plain globals, same
// as common.js; load it after common.js.

// escapeHtml (common.js) leaves quotes alone, which is fine for text but not
// for a value going inside an attribute.
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Opens a sheet with `html` inside and returns its card element. Only one is
// open at a time; opening another replaces it. Tapping outside the card or
// pressing Escape closes it.
function openSheet(html, { wide = false, onMount } = {}) {
  closeSheet();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay sheet-overlay';
  overlay.id = 'app-sheet';
  overlay.innerHTML = `<div class="modal-card${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });
  document.body.appendChild(overlay);
  const card = overlay.querySelector('.modal-card');
  if (onMount) onMount(card);
  const first = card.querySelector('input[type="text"], textarea, select, button');
  if (first) first.focus({ preventScroll: true });
  return card;
}

function closeSheet() {
  const overlay = document.getElementById('app-sheet');
  if (overlay) overlay.remove();
}

function sheetIsOpen() {
  return !!document.getElementById('app-sheet');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetIsOpen()) closeSheet();
});

// `undo`, if given, adds an Undo button that calls it. Messages with Undo
// stay up longer so there's time to reach the button.
let appToastTimer = null;
function showToast(message, undo) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.className = 'app-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = message;
  if (undo) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Undo';
    btn.addEventListener('click', () => {
      el.classList.remove('show');
      el.style.pointerEvents = '';
      undo();
    });
    el.appendChild(btn);
  }
  el.style.pointerEvents = undo ? 'auto' : '';
  el.classList.add('show');
  clearTimeout(appToastTimer);
  appToastTimer = setTimeout(() => {
    el.classList.remove('show');
    el.style.pointerEvents = '';
  }, undo ? 5000 : 2600);
}

// A project picker for "+ New Report": every project this person can see,
// favorites first, each starting today's report on that project.
async function openNewReportPicker() {
  const room = await getCompanyRoom();
  const [projects, favoriteIds, reports] = await Promise.all([getAllProjects(), getFavoriteProjectIds(), getAllReports()]);
  const visible = projects.filter((p) => projectInScope(p, room));
  const fav = new Set(favoriteIds);
  visible.sort((a, b) => (fav.has(b.id) - fav.has(a.id)) || a.name.localeCompare(b.name));
  const today = todayIso();
  const hasToday = new Set(reports.filter((r) => r.date === today).map((r) => r.projectId));
  const rows = visible.map((p) => `
    <a class="sheet-item" href="report-editor.html?project=${encodeURIComponent(p.id)}&report=new">
      <span class="ic">${projectIconHtml(p)}</span>
      <span>${escapeHtml(p.name)}</span>
      <span class="after">${hasToday.has(p.id) ? 'Has a report today' : ''}</span>
    </a>`).join('');
  openSheet(`
    <h3 class="sheet-title">New Report</h3>
    <p class="sheet-sub">Which project is it for? It starts dated today.</p>
    <div class="sheet-list">${rows || '<p class="hint" style="margin:0;">No projects yet.</p>'}</div>
    <div class="sheet-actions"><button type="button" class="btn-secondary" data-close-sheet>Cancel</button></div>`, {
    onMount: (card) => card.querySelector('[data-close-sheet]').addEventListener('click', closeSheet),
  });
}
