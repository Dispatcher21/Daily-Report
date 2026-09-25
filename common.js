// Small shared helpers used across every page. No page-specific logic here.

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// The app's version, shown at the bottom of every page as a link to the
// patch notes. Bump it together with each new patch-notes.txt entry.
const APP_VERSION = '0.043';
document.addEventListener('DOMContentLoaded', () => {
  const main = document.querySelector('main');
  if (!main) return;
  main.insertAdjacentHTML('beforeend',
    `<a class="app-version" href="patch-notes.txt" target="_blank" rel="noopener">v${APP_VERSION}</a>`);
});

// The icon a project shows on its home-screen card, hamburger-menu row,
// and (project.html's own Project Settings > Appearance step) itself --
// settings.html's Projects list and project.html both pick from this same
// list, via their own local icon-picker modal each wires up.
const PROJECT_ICON_OPTIONS = [
  '\u{1F3D7}\u{FE0F}', '\u{1F6A7}', '\u{1F6E3}\u{FE0F}', '\u{1F309}', '\u{1F6A6}',
  '\u{1F6B0}', '\u{1F3E2}', '\u{2699}\u{FE0F}', '\u{1F4D0}', '\u{1F9F1}',
  '\u{1F687}', '\u{26A1}', '\u{1F527}', '\u{1F3ED}', '\u{1F4E1}',
  '\u{1FAA7}', '\u{1F30A}', '\u{1F69B}', '\u{1F9BA}', '\u{1F4CD}', '\u{1F4C1}',
  // Added later, same theme (civil/construction/inspection) -- tractor,
  // railway, fuel pump, parking, bus stop, tools, houses, school, hospital,
  // fountain, deciduous/evergreen tree, station, ladder, toolbox, mountain,
  // fire engine, stadium, map, electric plug.
  '\u{1F69C}', '\u{1F6E4}\u{FE0F}', '\u{26FD}', '\u{1F17F}\u{FE0F}', '\u{1F68F}',
  '\u{1F6E0}\u{FE0F}', '\u{1F3D8}\u{FE0F}', '\u{1F3EB}', '\u{1F3E5}', '\u{26F2}',
  '\u{1F333}', '\u{1F332}', '\u{1F689}', '\u{1FA9C}', '\u{1F9F0}',
  '\u{1F3D4}\u{FE0F}', '\u{1F692}', '\u{1F3DF}\u{FE0F}', '\u{1F5FA}\u{FE0F}', '\u{1F50C}',
];

// ---------- Breadcrumb trail ----------
//
// Every page's back-bar used to be a single "<- Reports"-style link, either
// a fixed parent URL or (via the old goBackOrFallback, since replaced by
// this) wherever the browser's real history happened to lead -- which
// routinely didn't match its own label at all (a report opened from a
// search result or the Manager dashboard still said "<- Reports", but
// clicking it landed you back on whatever you'd actually come from). A
// real, deterministic path instead: Home / Project Name / Reports /
// Report #NNN, built from what page this actually is, never from history.
// Every segment but the last is a genuine link to that exact page; the
// last is the current page, shown but not a link.
//
// containerSelector should point at a plain, otherwise-empty element (an
// inner span, not the whole .back-bar) so this can safely overwrite its
// innerHTML on every call without touching sibling elements the page keeps
// in the same bar (an Edit/Download/View Report button, usually pinned
// right via margin-left:auto) -- see any of report-viewer.html/
// report-photos.html's own #bb-trail usage.
function renderBreadcrumb(containerSelector, segments) {
  const container = typeof containerSelector === 'string' ? document.querySelector(containerSelector) : containerSelector;
  if (!container) return;
  container.innerHTML = segments.map((seg, i) => {
    const isLast = i === segments.length - 1;
    const label = (i === 0 ? '&larr; ' : '') + escapeHtml(seg.label);
    const crumb = (seg.href && !isLast)
      ? `<a href="${escapeHtml(seg.href)}">${label}</a>`
      : `<span class="${isLast ? 'bb-cur' : ''}">${label}</span>`;
    return i === 0 ? crumb : `<span class="bb-sep"> // </span>${crumb}`;
  }).join('');
}

// ---------- Hamburger menu ----------
//
// Global nav: Home, every project the current company room can see, Settings,
// and Log out. Self-initializes off a #hamburger-btn in the page's <header>
// (see style.css's .hamburger-btn/.hb-panel) -- adding that button markup is
// the only per-page change needed; the panel itself is built here so it
// isn't duplicated in every page's HTML. login.html has no #hamburger-btn
// (nothing to navigate to before a name is on file), so this is a no-op there.
document.addEventListener('DOMContentLoaded', initHamburgerMenu);

async function initHamburgerMenu() {
  const btn = document.getElementById('hamburger-btn');
  if (!btn) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'hb-backdrop';
  backdrop.hidden = true;

  const panel = document.createElement('nav');
  panel.className = 'hb-panel';
  panel.id = 'hamburger-menu';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Main menu');
  panel.innerHTML = `
    <div class="hb-panel-header">
      <div class="hb-panel-user">Signed in as<strong id="hb-user-name">&hellip;</strong></div>
      <button type="button" class="hb-panel-close" id="hb-panel-close" aria-label="Close menu">&#10005;</button>
    </div>
    <div class="hb-panel-body">
      <a class="hb-row" href="index.html"><span class="hb-row-icon" aria-hidden="true">&#127968;</span><span class="hb-row-label">Home</span></a>
      <a class="hb-row" href="manager.html" id="hb-manager-row" hidden><span class="hb-row-icon" aria-hidden="true">&#128276;</span><span class="hb-row-label">Manager</span></a>
      <hr>
      <div class="hb-section-label">Projects</div>
      <div id="hb-projects"><div class="hb-empty">Loading&hellip;</div></div>
      <hr>
      <a class="hb-row" href="settings.html"><span class="hb-row-icon" aria-hidden="true">&#9881;&#65039;</span><span class="hb-row-label">Settings</span></a>
      <button type="button" class="hb-row hb-danger" id="hb-logout"><span class="hb-row-icon" aria-hidden="true">&#128682;</span><span class="hb-row-label">Log out</span></button>
    </div>
  `;
  document.body.append(backdrop, panel);
  panel.querySelector('#hb-panel-close').addEventListener('click', closeMenu);
  if (typeof getUserName === 'function') {
    getUserName().then((name) => {
      panel.querySelector('#hb-user-name').textContent = name || 'this device';
    }).catch(() => {});
  }
  btn.setAttribute('aria-controls', 'hamburger-menu');

  // .app-header is its own stacking context (position: sticky + z-index),
  // so no z-index on the button could ever put it above a fixed, higher-
  // z-index panel that starts at the very top of the viewport -- the open
  // panel would sit over the button with no way to tap it again to close.
  // Starting the panel/backdrop below the header instead (same technique
  // theme.js's own search dropdown uses) sidesteps that entirely: they
  // never overlap the header, so the button stays reachable the whole time.
  function positionBelowHeader() {
    const header = document.querySelector('.app-header');
    const top = header ? header.getBoundingClientRect().bottom : 0;
    backdrop.style.top = `${top}px`;
    panel.style.top = `${top}px`;
  }

  function openMenu() {
    positionBelowHeader();
    backdrop.hidden = false;
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add('open'));
    btn.setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    panel.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    // Matches the .hb-panel transform transition in style.css -- hidden
    // only once the slide-out animation has actually finished.
    setTimeout(() => { backdrop.hidden = true; panel.hidden = true; }, 220);
  }
  btn.addEventListener('click', () => {
    if (btn.getAttribute('aria-expanded') === 'true') closeMenu(); else openMenu();
  });
  backdrop.addEventListener('click', closeMenu);
  window.addEventListener('resize', () => { if (!panel.hidden) positionBelowHeader(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') closeMenu();
  });

  // Same two permissions that gate the review panels on report-viewer.html
  // and pay-apps.html, and the Manager page itself -- no point showing a
  // link to a page that would just tell you you don't have access. Either
  // one alone is enough (a company might grant just report review, just
  // Pay App review, or both). Also hidden with zero managed projects --
  // permission alone doesn't mean there's anything there yet to look at
  // (and defaults to granted on a solo device with no company at all,
  // where "Manager" doesn't mean anything in the first place). Someone
  // newly granted the permission reaches manager.html the first time by a
  // direct link from whoever granted it, not through this menu -- once
  // they've picked their first project there, this row appears from then on.
  if (typeof companyCan === 'function' && typeof getManagedProjectIds === 'function') {
    Promise.all([companyCan('approveReports'), companyCan('approvePayApps'), getManagedProjectIds()])
      .then(([canReports, canPayApps, managedIds]) => {
        panel.querySelector('#hb-manager-row').hidden = !((canReports || canPayApps) && managedIds.length > 0);
      }).catch(() => {});
  }

  // Same company-room scoping every project page already uses to decide
  // what it's allowed to open -- an admin/member sees every project on the
  // device, a project-scoped guest login sees only theirs.
  const projectsEl = panel.querySelector('#hb-projects');
  try {
    const room = typeof getCompanyRoom === 'function' ? await getCompanyRoom() : null;
    const all = typeof getAllProjects === 'function' ? await getAllProjects() : [];
    const visible = all.filter((p) => (typeof projectInScope === 'function' ? projectInScope(p, room) : true));
    // Every project-scoped page uses either ?id= (project.html itself) or
    // ?project= (every other project page) -- highlighting whichever
    // project that resolves to as "current" needs both.
    const currentId = (typeof queryParam === 'function' && (queryParam('id') || queryParam('project'))) || null;
    projectsEl.innerHTML = renderHbProjectsHtml(visible, currentId, await buildDisplayLayout(visible));
  } catch (err) {
    console.error('hamburger menu: loading projects', err);
    projectsEl.innerHTML = '<div class="hb-empty">Couldn\'t load projects.</div>';
  }

  panel.querySelector('#hb-logout').addEventListener('click', async () => {
    if (!confirm("Log out on this device? You'll need to enter your name again next time.")) return;
    if (typeof saveUserName === 'function') await saveUserName('');
    location.href = 'login.html';
  });
}

// Read-only mirror of index.html's own buildHubLayout: same saved order and
// folder grouping (getProjectLayout, index.html's only writer), same
// favorites-first fallback when nothing's ever been customized, but never
// persists a reconciled result -- index.html already self-heals that layout
// (dropped/added projects, emptied folders) every time it's visited, so
// there's no need for every other page's menu to also write to it, just to
// display it consistently with whatever index.html currently has stored.
async function buildDisplayLayout(visible) {
  const saved = typeof getProjectLayout === 'function' ? await getProjectLayout() : null;
  const existingIds = new Set(visible.map((p) => p.id));

  if (!saved) {
    const favoriteIds = typeof getFavoriteProjectIds === 'function' ? await getFavoriteProjectIds() : [];
    const favoriteSet = new Set(favoriteIds);
    const ordered = [...visible].sort((a, b) => (favoriteSet.has(b.id) ? 1 : 0) - (favoriteSet.has(a.id) ? 1 : 0));
    return ordered.map((p) => ({ type: 'project', id: p.id }));
  }

  const placed = new Set();
  const reconciled = [];
  for (const entry of saved) {
    if (entry.type === 'project') {
      if (!existingIds.has(entry.id)) continue;
      placed.add(entry.id);
      reconciled.push(entry);
    } else if (entry.type === 'folder') {
      const kept = entry.projectIds.filter((id) => existingIds.has(id));
      kept.forEach((id) => placed.add(id));
      if (kept.length === 0) continue;
      if (kept.length === 1) {
        reconciled.push({ type: 'project', id: kept[0] });
        continue;
      }
      reconciled.push({ ...entry, projectIds: kept });
    }
  }
  for (const p of visible) {
    if (!placed.has(p.id)) reconciled.push({ type: 'project', id: p.id });
  }
  return reconciled;
}

function renderHbProjectsHtml(visible, currentId, layout) {
  if (!visible.length) return '<div class="hb-empty">No projects yet.</div>';
  const projectsById = new Map(visible.map((p) => [p.id, p]));
  const projectRow = (p, nested) => {
    const current = p.id === currentId;
    // Same per-project icon (or the same folder-glyph fallback) as its
    // hub-card on the home screen -- see index.html's own projectCardHtml.
    const icon = escapeHtml(p.icon || '\u{1F4C1}');
    return `<a class="hb-row${nested ? ' hb-row-nested' : ''}${current ? ' hb-current' : ''}" href="project.html?id=${encodeURIComponent(p.id)}"><span class="hb-row-icon" aria-hidden="true">${icon}</span><span class="hb-row-label">${escapeHtml(p.name || 'Untitled Project')}</span></a>`;
  };
  return layout.map((entry) => {
    if (entry.type === 'folder') {
      const members = entry.projectIds.map((id) => projectsById.get(id)).filter(Boolean);
      if (!members.length) return '';
      return `<div class="hb-folder-label"><span class="hb-row-icon" aria-hidden="true">&#128194;</span><span class="hb-row-label">${escapeHtml(entry.name || 'Folder')}</span></div>`
        + members.map((p) => projectRow(p, true)).join('');
    }
    const p = projectsById.get(entry.id);
    return p ? projectRow(p, false) : '';
  }).join('');
}

// Nothing in this app uses a real <form>, so Enter does nothing by default
// in any single-button input group (name/password entry, join/create company,
// search-and-go, etc.) -- this wires Enter (pressed in a text/password/number/
// date input, never a textarea) under `container` to trigger the same action
// as clicking `button`. Uses button.click() rather than calling the handler
// directly so a disabled button (e.g. required fields still blank) correctly
// still does nothing on Enter, exactly like it does on a real click.
function onEnterSubmit(container, button) {
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    button.click();
  });
}

// ---------- Shared progress banner ----------
//
// One banner, injected once per page directly under the header, used by
// every multi-step background job (join/create/sync a company, change its
// password, build a PDF) -- replaces each page's own spinner+text copy so
// they all look and behave the same way. Not modal: it never blocks the
// rest of the page.
let pbCurrentStepEl = null;
let pbCurrentStepKey = null;

function ensureProgressBanner() {
  let el = document.getElementById('global-progress-banner');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'global-progress-banner';
  el.className = 'progress-banner';
  el.hidden = true;
  el.innerHTML = `
    <div class="pb-bar-track"><div class="pb-bar-fill" id="pb-bar-fill"></div></div>
    <div class="pb-steps" id="pb-steps"></div>
    <div class="pb-error-row" id="pb-error-row" hidden>
      <span id="pb-error-text"></span>
      <button type="button" id="pb-dismiss" aria-label="Dismiss">&times;</button>
    </div>`;
  const header = document.querySelector('.app-header');
  if (header && header.parentNode) header.parentNode.insertBefore(el, header.nextSibling);
  else document.body.insertBefore(el, document.body.firstChild);
  el.querySelector('#pb-dismiss').addEventListener('click', hideProgressBanner);
  return el;
}

function startProgressBanner() {
  const el = ensureProgressBanner();
  el.hidden = false;
  el.classList.remove('pb-error', 'pb-done');
  el.querySelector('#pb-steps').innerHTML = '';
  el.querySelector('#pb-error-row').hidden = true;
  const bar = el.querySelector('#pb-bar-fill');
  bar.style.width = '6%';
  bar.classList.add('pb-indeterminate');
  pbCurrentStepEl = null;
  pbCurrentStepKey = null;
}

// Call once per distinct thing happening, in plain everyday words -- e.g.
// progressStep('reports', 'Getting your reports', '3 of 50'). Calling again
// with the same `key` updates that same line (the running count) instead of
// adding a new one; a new `key` checks off the previous line and starts a
// fresh one. `detail` in the exact shape "X of Y" switches the bar from an
// indeterminate shimmer to a real, accurate fill -- everything else keeps
// the shimmer, since there's no honest way to know how far through an
// unknown-length step this is.
function progressStep(key, label, detail) {
  const el = ensureProgressBanner();
  if (el.hidden) startProgressBanner();
  const steps = el.querySelector('#pb-steps');
  const bar = el.querySelector('#pb-bar-fill');

  if (key !== pbCurrentStepKey) {
    if (pbCurrentStepEl) pbCurrentStepEl.classList.replace('pb-step-active', 'pb-step-done');
    const row = document.createElement('div');
    row.className = 'pb-step pb-step-active';
    row.innerHTML = `<span class="pb-step-mark"></span><span class="pb-step-text"></span>`;
    steps.appendChild(row);
    pbCurrentStepEl = row;
    pbCurrentStepKey = key;
  }
  pbCurrentStepEl.querySelector('.pb-step-text').textContent = detail ? `${label} — ${detail}` : label;

  const frac = detail && /^(\d+) of (\d+)$/.exec(detail);
  if (frac) {
    bar.classList.remove('pb-indeterminate');
    bar.style.width = Math.min(96, Math.round((Number(frac[1]) / Number(frac[2])) * 100)) + '%';
  }
}

// Checks off the last step, fills the bar, and fades the banner out after a
// beat -- `label`, if given, is one last friendly line (e.g. "You're all
// caught up!").
function finishProgressBanner(label) {
  const el = document.getElementById('global-progress-banner');
  if (!el) return;
  if (pbCurrentStepEl) pbCurrentStepEl.classList.replace('pb-step-active', 'pb-step-done');
  const bar = el.querySelector('#pb-bar-fill');
  bar.classList.remove('pb-indeterminate');
  bar.style.width = '100%';
  el.classList.add('pb-done');
  if (label) {
    const row = document.createElement('div');
    row.className = 'pb-step pb-step-done';
    row.innerHTML = `<span class="pb-step-mark">&#10003;</span><span class="pb-step-text"></span>`;
    row.querySelector('.pb-step-text').textContent = label;
    el.querySelector('#pb-steps').appendChild(row);
  }
  setTimeout(() => {
    if (!el.classList.contains('pb-error')) el.hidden = true;
  }, 1400);
}

// Marks the banner failed and keeps it on screen (with a dismiss button)
// rather than auto-hiding -- see userError() for how `message` gets its
// reference code appended.
function progressBannerError(message) {
  const el = ensureProgressBanner();
  el.hidden = false;
  el.classList.add('pb-error');
  if (pbCurrentStepEl) pbCurrentStepEl.classList.replace('pb-step-active', 'pb-step-error');
  el.querySelector('#pb-bar-fill').classList.remove('pb-indeterminate');
  const errRow = el.querySelector('#pb-error-row');
  errRow.hidden = false;
  el.querySelector('#pb-error-text').textContent = message;
}

function hideProgressBanner() {
  const el = document.getElementById('global-progress-banner');
  if (el) el.hidden = true;
}

// One line in a live-updating per-item log -- the report-import batch (see
// project-setup.html's Import Reports tab and project.html's own upload
// zone) is the first user, but generic enough for anything that processes
// a list of files/records one at a time and wants each one to show up as
// it finishes rather than only in a summary at the end. `cls` picks the
// status color via CSS (ir-ok/ir-dupe/ir-error); user-derived text (a file
// name, an error message) goes in through textContent, never the row's own
// innerHTML, so it can never be read back as markup.
function irLogRow(cls, icon, label, detail) {
  const row = document.createElement('div');
  row.className = `ir-log-row ${cls}`;
  row.innerHTML = '<span class="ir-log-icon"></span><span class="ir-log-file"></span><span class="ir-log-detail"></span>';
  row.querySelector('.ir-log-icon').textContent = icon;
  row.querySelector('.ir-log-file').textContent = label;
  row.querySelector('.ir-log-detail').textContent = detail || '';
  return row;
}

// Feeds firebase-sync.js's {phase, index, total, count} progress shape
// (used by join/create/sync/change-company-password) into the banner --
// one mapping, reused by every flow that reports progress this way, so
// they all show the same plain-language wording instead of four slightly
// different copies of the same table.
function reportCompanyProgress(progress) {
  const p = progress || {};
  switch (p.phase) {
    case 'signing-in': progressStep('signing-in', 'Signing you in'); break;
    case 'looking-up': progressStep('looking-up', 'Finding your company'); break;
    case 'pulling': progressStep('pulling', 'Getting the latest company data'); break;
    case 'creating': progressStep('creating', 'Setting up your new address'); break;
    case 'roles': progressStep('roles', 'Carrying over your custom setups'); break;
    case 'logo': progressStep('logo', 'Getting your company logo'); break;
    case 'projects':
      progressStep(
        'projects',
        p.count != null ? 'Sending your projects' : 'Getting your projects',
        p.count != null ? `${p.count} sent` : null
      );
      break;
    case 'reports':
      progressStep('reports', 'Syncing your reports', p.total ? `${p.index} of ${p.total}` : null);
      break;
    case 'deletions': progressStep('deletions', 'Checking for anything removed elsewhere'); break;
    case 'audit':
      progressStep('audit', p.count != null ? 'Sending your activity log' : 'Getting the activity log', p.count != null ? `${p.count} sent` : null);
      break;
    default:
      progressStep('working', 'Working on it');
  }
}

// ---------- Fun error reference codes ----------
//
// Every user-facing error gets a short code from this list so a report like
// "I got BUMBLEBEE" can be matched straight back to exactly which catch
// block fired, without a screenshot or a stack trace. See error-codes.txt
// (repo root) for the full table -- codes never get reassigned, even if the
// wording of the message they're attached to changes later, so an old
// report stays lookup-able. The same underlying operation (e.g. joining a
// company, or reading an uploaded Excel file) keeps the same code no
// matter which page it was triggered from.
const ERROR_CODES = {
  JOIN_COMPANY: 'BUMBLEBEE',
  CONTINUE_LOCAL: 'CLIFFJUMPER',
  CREATE_COMPANY: 'OPTIMUS',
  COMPANY_LOGO: 'IRONHIDE',
  UNLOCK_ADMIN: 'RATCHET',
  SYNC_NOW: 'JAZZ',
  PARSE_EXCEL: 'WHEELJACK',
  SAVE_COMPANY_NAME: 'HOUND',
  PERMISSION_TOGGLE: 'PROWL',
  CUSTOM_SETUP: 'MIRAGE',
  ADMIN_PASSWORD: 'GRIMLOCK',
  COMPANY_PASSWORD: 'SOUNDWAVE',
  REFRESH_ACTIVITY: 'COSMOS',
  PROJECT_BACKGROUND: 'TRAILBREAKER',
  SAVE_PROJECT: 'STARSCREAM',
  SHARED_SETUP_READ: 'SKYWARP',
  SHARED_SETUP_APPLY: 'THUNDERCRACKER',
  DOWNLOAD_PROJECT_FILE: 'WHEELIE',
  IMPORT_REPORT_BUNDLES: 'BLASTER',
  DELETE_REPORTS: 'SIDESWIPE',
  MASS_EDIT: 'SUNSTREAKER',
  QUANTITY_SHEET: 'LONGHAUL',
  SAVE_QUANTITIES: 'ARCEE',
  BUILD_PDF: 'MEGATRON',
  REFRESH_REPORTS: 'BLURR',
  IMPORT_REPORT_SYNC: 'SHOCKWAVE',
  SAVE_SYNC_CONFIRM: 'SKIDS',
  THEME_SAVE: 'WHIRL',
  HEADER_SYNC: 'BRAWN',
  FOLDER_SYNC: 'HOTROD',
  DOWNLOAD_PAYAPP_FILE: 'PERCEPTOR',
  PARSE_PAYAPP_EXCEL: 'WARPATH',
};

// Appends a reference code to a user-facing error message -- use for every
// alert()/error-div that shows a caught error. `key` should be one of
// ERROR_CODES above; an unrecognized or missing key falls back to a generic
// code rather than showing no code at all.
function userError(message, key) {
  const code = ERROR_CODES[key] || 'SPARKPLUG';
  return `${message}\n\nReference code: ${code} (see error-codes.txt if you need to report this)`;
}

// Slows down repeated wrong-password guesses against a company/admin
// password screen. This is a per-device speed bump, not real protection --
// anyone in devtools can call the underlying function directly and skip it
// -- but it raises the cost of someone sitting at the login/unlock screen
// itself trying passwords by hand. `key` scopes the counter to a specific
// screen+target (e.g. 'admin-unlock:ABC123') so guessing one company's
// admin password doesn't lock out a different company on the same device.
const LOGIN_THROTTLE_PREFIX = 'dwr_throttle_';
const LOGIN_THROTTLE_BASE_MS = 1500;
const LOGIN_THROTTLE_MAX_MS = 60000;
const LOGIN_THROTTLE_FREE_ATTEMPTS = 2;

function loginThrottleState(key) {
  try {
    return JSON.parse(localStorage.getItem(LOGIN_THROTTLE_PREFIX + key) || 'null') || { fails: 0, until: 0 };
  } catch {
    return { fails: 0, until: 0 };
  }
}
function saveLoginThrottleState(key, state) {
  try { localStorage.setItem(LOGIN_THROTTLE_PREFIX + key, JSON.stringify(state)); } catch {}
}

// Returns seconds still remaining on an active lockout, or 0 if a guess can
// proceed right now.
function loginThrottleRemaining(key) {
  const { until } = loginThrottleState(key);
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}
// Call after a failed password attempt. Doubles the lockout each fail past
// the first couple of free tries, capped at a minute.
function loginThrottleRecordFailure(key) {
  const state = loginThrottleState(key);
  state.fails += 1;
  const extraFails = Math.max(0, state.fails - LOGIN_THROTTLE_FREE_ATTEMPTS);
  if (extraFails > 0) {
    const delay = Math.min(LOGIN_THROTTLE_BASE_MS * 2 ** (extraFails - 1), LOGIN_THROTTLE_MAX_MS);
    state.until = Date.now() + delay;
  }
  saveLoginThrottleState(key, state);
}
// Call after a successful attempt to clear the counter for that screen.
function loginThrottleReset(key) {
  saveLoginThrottleState(key, { fails: 0, until: 0 });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// iPhones save camera photos as HEIC/HEIF by default. Safari can decode
// those natively, but createImageBitmap() throws on them in every other
// browser (Chrome, Firefox, Edge), which used to mean compressImage() and
// capImageDimensions() would silently fall back to storing the raw,
// undecodable HEIC blob -- it'd save fine, then show a broken-image icon
// forever since no non-Safari <img> can render it. Converting to JPEG here,
// before either of those functions ever sees the file, fixes that. Anything
// that isn't HEIC/HEIF (checked by MIME type, then by extension since some
// browsers hand HEIC files over with an empty/generic type) passes through
// untouched; any conversion failure falls back to the original file rather
// than blocking the upload, same policy as the rest of this file.
async function convertHeicIfNeeded(file) {
  if (!file) return file;
  const isHeic =
    /^image\/hei[cf]/i.test(file.type || '') || /\.hei[cf]$/i.test(file.name || '');
  if (!isHeic) return file;
  try {
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
    const newName = (file.name || 'photo').replace(/\.hei[cf]$/i, '.jpg');
    return new File([jpegBlob], newName, { type: 'image/jpeg' });
  } catch (err) {
    console.error('convertHeicIfNeeded:', err); // fall back to the original rather than blocking the upload
    return file;
  }
}

// Downscales and re-encodes a photo as JPEG so on-device storage (and later,
// sync) never has to carry full-resolution phone camera output -- a 4000px,
// 6MB original becomes roughly 150-400KB. Non-image files (or anything the
// browser can't decode, e.g. HEIC without native support) are passed through
// unchanged rather than dropped, since a failed compression shouldn't cost
// the user their photo.
async function compressImage(file, { maxDim = 1600, quality = 0.7 } = {}) {
  if (!file || !file.type || !file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return file;
    return blob.size < file.size ? blob : file; // never trade a smaller original for a bigger "compressed" copy
  } catch (err) {
    console.error('compressImage:', err); // fall back to the original rather than blocking the upload
    return file;
  }
}

// Caps a logo's pixel dimensions without re-encoding it -- unlike
// compressImage, this never changes format or applies lossy quality, so a
// PNG's transparency and a logo's sharp edges/text survive untouched. Only
// kicks in if the file actually exceeds maxDim; a normal-sized logo passes
// through byte-for-byte. This exists purely to stop someone accidentally
// uploading a multi-MB screenshot as the "logo" from becoming a recurring
// download cost for every device that syncs it -- it's shown in a small
// fixed-size box on the report, so pixels beyond maxDim buy nothing.
async function capImageDimensions(file, { maxDim = 800 } = {}) {
  if (!file || !file.type || !file.type.startsWith('image/')) return file;
  // The resize path below decodes to a single frame (createImageBitmap) and
  // re-encodes through <canvas> -- fine for a photo, but it would silently
  // flatten an animated GIF down to one still frame. Pass it through
  // untouched instead; a big GIF just uploads at its real size rather than
  // getting "resized" into something that no longer animates.
  if (file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    if (Math.max(bitmap.width, bitmap.height) <= maxDim) {
      bitmap.close();
      return file;
    }
    const scale = maxDim / Math.max(bitmap.width, bitmap.height);
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, file.type));
    return blob || file;
  } catch (err) {
    console.error('capImageDimensions:', err); // fall back to the original rather than blocking the upload
    return file;
  }
}

// Reads ?key=value params from the current page URL.
function queryParam(key) {
  return new URLSearchParams(location.search).get(key);
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  // Whether this page load was already under an existing service worker's
  // control -- decides how to read the very first controllerchange event
  // below, which fires in two very different situations that otherwise
  // look identical: a brand-new install claiming an until-now-uncontrolled
  // page (not "a new version" -- nothing to tell anyone), versus an
  // already-controlled page having its controller REPLACED because a
  // newer service worker just activated (a real update, worth a prompt).
  const hadControllerAtLoad = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('service-worker.js').catch(console.error);

  // A new service worker just took over -- the page already open is still
  // running whatever JS it loaded with, which is now stale relative to
  // what's actually cached (this is exactly the "worked in my browser tab
  // but the installed app looked broken" gap: an installed PWA can sit
  // resumed-from-background for days without ever doing a real navigation,
  // so the update installs in the background but the visible page never
  // gets the one reload it needs to actually show it). Prompting rather
  // than reloading outright, since this can fire while someone's mid-report.
  let sawFirstClaim = hadControllerAtLoad;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!sawFirstClaim) {
      sawFirstClaim = true; // the initial claim on a previously-uncontrolled page -- not a "new version"
      return;
    }
    if (confirm('A new version of the app is ready. Reload now to use it?')) {
      location.reload();
    }
  });
}

// Deferred to DOMContentLoaded because applyHeaderLogo lives in storage.js,
// which every page loads after this file.
function applyBranding() {
  if (typeof applyHeaderLogo === 'function') applyHeaderLogo();
}
document.addEventListener('DOMContentLoaded', applyBranding);

// ---------- Global "out of sync" banner ----------
//
// Used to be reports.html's own #folder-sync-banner, scoped to whichever
// one project you happened to be looking at -- a device could sit on
// index.html for days with a project's reports piling up unsynced to its
// linked folder and never see anything about it. This checks every
// project's own local-folder sync state (storage.js) and shows one banner,
// right under the header, on every page, the moment anything's behind.
//
// login.html has no header for this to sit under and nothing meaningful to
// report before a name's even on file, so it's skipped there the same way
// the hamburger menu already is (no #global-sync-banner-slot in its markup).
//
// Every project on this device linked to a local folder, with how many of
// its reports still haven't made it there -- the shared read behind both
// the banner's own count and the "Sync All" button's own worklist, so the
// two can never disagree about what's actually pending.
async function getProjectsPendingFolderSync() {
  const projects = await getAllProjects();
  const linked = [];
  for (const p of projects) {
    const folderName = await getLinkedSyncFolderName(p.id);
    if (folderName) linked.push(p);
  }
  if (!linked.length) return [];

  // One getAllReports() call, not one per linked project -- same reasoning
  // as index.html's renderProjectCards.
  const allReports = await getAllReports();
  const rows = [];
  for (const p of linked) {
    const state = await getFolderSyncState(p.id);
    const pending = allReports.reduce((n, r) => n + (r.projectId === p.id && !isReportFolderSynced(r, state) ? 1 : 0), 0);
    if (pending > 0) rows.push({ project: p, pending });
  }
  return rows;
}

async function refreshGlobalSyncBanner() {
  if (typeof getAllProjects !== 'function' || typeof getLinkedSyncFolderName !== 'function') return;
  const header = document.querySelector('.app-header');
  if (!header) return;

  try {
    const rows = await getProjectsPendingFolderSync();
    let banner = document.getElementById('global-sync-banner');
    if (!rows.length) {
      if (banner) banner.hidden = true;
      return;
    }

    const totalPending = rows.reduce((n, r) => n + r.pending, 0);
    const projectsAffected = rows.length;

    if (!banner) {
      banner = document.createElement('button');
      banner.type = 'button';
      banner.id = 'global-sync-banner';
      banner.className = 'global-sync-banner';
      banner.addEventListener('click', () => syncAllPendingFolders(banner));
      header.insertAdjacentElement('afterend', banner);
    }
    const reportWord = totalPending === 1 ? 'report hasn’t' : 'reports haven’t';
    const where = projectsAffected === 1
      ? 'its linked folder'
      : `their linked folders across ${projectsAffected} projects`;
    banner.textContent = `⚠ ${totalPending} ${reportWord} synced to ${where} yet. Tap to sync all →`;
    banner.hidden = false;
  } catch (err) {
    console.error('global sync banner:', err);
  }
}
document.addEventListener('DOMContentLoaded', refreshGlobalSyncBanner);
// Both already fire globally (theme.js's header sync button after a
// company pull / folder resync) -- same signal that used to just refresh
// reports.html's own per-project banner now refreshes this one everywhere.
window.addEventListener('company-data-pulled', refreshGlobalSyncBanner);
window.addEventListener('folder-sync-completed', refreshGlobalSyncBanner);

// Most pages that can show this banner never loaded local-sync.js (see its
// own file header -- only the project-scoped pages that actually write
// files do) -- fetched here on demand, the moment someone actually taps
// "Sync All", the same on-demand technique local-sync.js already uses
// internally for its own PDF libs. A no-op once loaded, on this page or a
// previous click.
let localSyncLoadPromise = null;
function ensureLocalSyncLoaded() {
  if (typeof syncCurrentProjectToFolderIfLinked === 'function') return Promise.resolve();
  if (!localSyncLoadPromise) {
    localSyncLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'local-sync.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load local-sync.js'));
      document.head.appendChild(s);
    });
  }
  return localSyncLoadPromise;
}

// The banner's own click handler: catches up every linked project with
// something pending, right here, rather than sending someone to Settings'
// own Sync to Folder section just to click one more button -- that section
// still exists for picking specific projects, this is the "just sync
// everything" fast path. Narrated on the same shared progress banner the
// header sync button uses, so it looks and feels like every other
// multi-step job in the app instead of a silent wait behind a disabled
// button.
let syncAllRunning = false;
async function syncAllPendingFolders(banner) {
  if (syncAllRunning) return;
  syncAllRunning = true;
  banner.disabled = true;
  const showProgress = typeof startProgressBanner === 'function';
  if (showProgress) startProgressBanner();
  try {
    await ensureLocalSyncLoaded();
    const rows = await getProjectsPendingFolderSync();
    const lapsed = [];
    for (let i = 0; i < rows.length; i++) {
      const { project } = rows[i];
      if (showProgress) progressStep('sync-all', `Syncing "${project.name}"`, `${i + 1} of ${rows.length}`);
      // Never prompts for a folder -- same silent-if-not-permitted contract
      // as the header sync button's own ridealong and Settings' bulk sync,
      // see getSyncDirectoryIfPermitted's own comment.
      const dirHandle = await getSyncDirectoryIfPermitted(project.id);
      if (!dirHandle) { lapsed.push(project.name); continue; }
      await syncCurrentProjectToFolderIfLinked(project.id);
    }
    // The listener above picks this up and re-checks -- hides the banner if
    // that was everything, or updates its count if some were skipped
    // (lapsed folder permission).
    window.dispatchEvent(new CustomEvent('folder-sync-completed'));

    if (showProgress) {
      if (lapsed.length) {
        finishProgressBanner(
          `Synced ${rows.length - lapsed.length} of ${rows.length} project(s). Folder access needs renewing for: ${lapsed.join(', ')} -- open that project and click "Sync to Folder" once to restore it.`
        );
      } else {
        finishProgressBanner("You're all caught up!");
      }
    }
  } catch (err) {
    console.error('sync all:', err);
    const message = typeof userError === 'function'
      ? userError("Couldn't sync: " + err.message, 'SYNC_ALL')
      : "Couldn't sync: " + err.message;
    if (showProgress && typeof progressBannerError === 'function') progressBannerError(message);
  } finally {
    syncAllRunning = false;
    banner.disabled = false;
  }
}

// ---------- Global "managed projects" alert banner ----------
//
// Same idea and same visual treatment as the out-of-sync banner above, but
// for the Manager role: tells someone with the approveReports and/or
// approvePayApps permission that a project they manage has activity (a new
// report, a recorded/edited Pay App, a comment) they haven't looked at yet.
// "Unseen" is measured by each item's own updatedAt against
// getManagedProjectsLastSeenAt() -- there's no separate createdAt to
// distinguish a brand new item from an edited one, so this reads as
// "something changed", the same signal the rest of the app already treats
// updatedAt as carrying.
//
// Unlike the out-of-sync banner (a plain link), this is a button: clicking
// it opens a dropdown listing the actual items, right there, using the
// exact same .global-search-panel/.gsp-* component theme.js's header search
// already built (see buildManagedActivityPanel below) -- rather than
// forcing a trip to manager.html just to see what changed. That page is
// still the one place that actually clears this (its own
// markManagedProjectsSeen call, see the dropdown's own "Open Manager page"
// row for a way there without leaving this page first).
async function refreshManagedProjectsAlertBanner() {
  if (typeof getManagedProjectIds !== 'function' || typeof companyCan !== 'function') return;
  const header = document.querySelector('.app-header');
  if (!header) return;

  try {
    let banner = document.getElementById('managed-projects-alert-banner');
    const [canReports, canPayApps] = await Promise.all([companyCan('approveReports'), companyCan('approvePayApps')]);
    if (!canReports && !canPayApps) {
      if (banner) banner.hidden = true;
      return;
    }

    const managedIds = new Set(await getManagedProjectIds());
    if (!managedIds.size) {
      if (banner) banner.hidden = true;
      return;
    }

    const lastSeenAt = await getManagedProjectsLastSeenAt();
    let newCount = 0;
    if (canReports) {
      const allReports = await getAllReports();
      newCount += allReports.reduce((n, r) => (
        n + (managedIds.has(r.projectId) && !r.deleted && (r.updatedAt || 0) > lastSeenAt ? 1 : 0)
      ), 0);
    }
    if (canPayApps) {
      const allProjects = await getAllProjects();
      newCount += allProjects.reduce((n, p) => (
        n + (managedIds.has(p.id) ? (p.billingEstimates || []).filter((e) => (e.updatedAt || 0) > lastSeenAt).length : 0)
      ), 0);
    }

    if (!newCount) {
      if (banner) banner.hidden = true;
      return;
    }

    if (!banner) {
      banner = document.createElement('button');
      banner.type = 'button';
      banner.id = 'managed-projects-alert-banner';
      banner.className = 'global-sync-banner managed-projects-alert-banner';
      banner.addEventListener('click', () => {
        if (managedActivityPanelOpen) closeManagedActivityPanel();
        else openManagedActivityPanel();
      });
      // After the out-of-sync banner when both are present, so the stack
      // reads in a stable order no matter which refresh fired last.
      const anchor = document.getElementById('global-sync-banner') || header;
      anchor.insertAdjacentElement('afterend', banner);
    }
    const itemWord = newCount === 1 ? 'item has' : 'items have';
    banner.textContent = `\u{1F514} ${newCount} ${itemWord} new activity in projects you manage. Tap to view →`;
    banner.hidden = false;
  } catch (err) {
    console.error('managed projects alert banner:', err);
  }
}

// ---------- Managed activity dropdown ----------
//
// The list behind the button above -- same component as theme.js's header
// search (.global-search-panel/.gsp-*), same fixed-under-header positioning
// and outside-click/Escape close, just populated with report/Pay App rows
// grouped by project instead of search matches.
let managedActivityPanelEl = null;
let managedActivityPanelOpen = false;

function onManagedActivityKeydown(e) {
  if (e.key === 'Escape') closeManagedActivityPanel();
}
function onManagedActivityDocClick(e) {
  const banner = document.getElementById('managed-projects-alert-banner');
  if ((managedActivityPanelEl && managedActivityPanelEl.contains(e.target)) || (banner && banner.contains(e.target))) return;
  closeManagedActivityPanel();
}
function closeManagedActivityPanel() {
  if (managedActivityPanelEl) {
    managedActivityPanelEl.hidden = true;
    managedActivityPanelEl.innerHTML = '';
  }
  managedActivityPanelOpen = false;
  document.removeEventListener('keydown', onManagedActivityKeydown);
  document.removeEventListener('click', onManagedActivityDocClick, true);
}

async function openManagedActivityPanel() {
  const header = document.querySelector('.app-header');
  if (!header) return;
  if (!managedActivityPanelEl) {
    managedActivityPanelEl = document.createElement('div');
    managedActivityPanelEl.className = 'global-search-panel';
    managedActivityPanelEl.id = 'managed-activity-panel';
    managedActivityPanelEl.hidden = true;
    document.body.appendChild(managedActivityPanelEl);
  }
  managedActivityPanelEl.style.top = `${header.getBoundingClientRect().bottom}px`;
  managedActivityPanelEl.innerHTML = '<div class="gsp-empty">Loading…</div>';
  managedActivityPanelEl.hidden = false;
  managedActivityPanelOpen = true;
  document.addEventListener('keydown', onManagedActivityKeydown);
  document.addEventListener('click', onManagedActivityDocClick, true);

  try {
    const [managedIds, lastSeenAt, canReports, canPayApps, allProjects] = await Promise.all([
      getManagedProjectIds().then((ids) => new Set(ids)),
      getManagedProjectsLastSeenAt(),
      companyCan('approveReports'),
      companyCan('approvePayApps'),
      getAllProjects(),
    ]);
    const projectsById = new Map(allProjects.map((p) => [p.id, p]));

    const rows = []; // { projectId, date, html }
    if (canReports) {
      const allReports = await getAllReports();
      allReports
        .filter((r) => managedIds.has(r.projectId) && !r.deleted && (r.updatedAt || 0) > lastSeenAt)
        .forEach((r) => {
          rows.push({
            projectId: r.projectId,
            date: r.date || '',
            html: `
              <a class="gsp-row" href="report-viewer.html?project=${r.projectId}&report=${r.id}">
                <span class="gsp-row-date">${escapeHtml(r.date || '(no date)')}</span>
                <span class="gsp-row-main"><span class="gsp-row-no">Report #${escapeHtml(String(r.reportNo ?? ''))}</span></span>
              </a>`,
          });
        });
    }
    if (canPayApps) {
      allProjects
        .filter((p) => managedIds.has(p.id))
        .forEach((p) => {
          (p.billingEstimates || [])
            .filter((e) => (e.updatedAt || 0) > lastSeenAt)
            .forEach((e) => {
              rows.push({
                projectId: p.id,
                date: e.date || '',
                html: `
                  <a class="gsp-row" href="pay-apps.html?project=${p.id}&estimate=${e.id}">
                    <span class="gsp-row-date">${escapeHtml(e.date || '(no date)')}</span>
                    <span class="gsp-row-main"><span class="gsp-row-no">Pay App #${escapeHtml(e.estimateNo || '?')}</span></span>
                  </a>`,
              });
            });
        });
    }

    if (!rows.length) {
      // Can genuinely happen: the banner's own count and this list are both
      // read fresh, but something else (another tab, a background pull)
      // could clear the activity in between the click and this resolving.
      managedActivityPanelEl.innerHTML = '<div class="gsp-empty">Nothing new right now.</div>';
      return;
    }

    const byProject = new Map();
    rows.forEach((row) => {
      if (!byProject.has(row.projectId)) byProject.set(row.projectId, []);
      byProject.get(row.projectId).push(row);
    });
    const projectIds = Array.from(byProject.keys()).sort((a, b) => {
      const pa = projectsById.get(a), pb = projectsById.get(b);
      return (pa ? pa.name : '').localeCompare(pb ? pb.name : '');
    });

    let html = '';
    projectIds.forEach((pid) => {
      const project = projectsById.get(pid);
      const projRows = byProject.get(pid).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      html += `<div class="gsp-group"><div class="gsp-group-title">${escapeHtml(project ? project.name : 'Unknown project')}</div>`;
      projRows.forEach((row) => { html += row.html; });
      html += `</div>`;
    });
    html += `<div class="gsp-more"><a href="manager.html">Open Manager page &rarr;</a></div>`;
    managedActivityPanelEl.innerHTML = html;
  } catch (err) {
    console.error('managed activity panel:', err);
    managedActivityPanelEl.innerHTML = '<div class="gsp-empty">Couldn\'t load activity.</div>';
  }
}

// Clicking through to one of the flagged items counts as having seen the
// activity -- without this the banner only ever cleared via a dedicated
// trip to manager.html, so it looked stuck "on" to anyone who instead
// worked straight from this dropdown. There's no per-item seen state (see
// getManagedProjectsLastSeenAt's own comment), so this clears the whole
// batch, same as manager.html does; that's the right call here too, since
// clicking a row means the user has now looked at this list of what's new.
// The click is intercepted so the seen-write (an IndexedDB transaction)
// actually finishes before the navigation it's racing against unloads it.
document.addEventListener('click', (e) => {
  const row = e.target.closest && e.target.closest('#managed-activity-panel .gsp-row');
  if (!row) return;
  e.preventDefault();
  const href = row.getAttribute('href');
  markManagedProjectsSeen().finally(() => { window.location.href = href; });
});

document.addEventListener('DOMContentLoaded', refreshManagedProjectsAlertBanner);
window.addEventListener('company-data-pulled', refreshManagedProjectsAlertBanner);

// Back/forward into a page restored from bfcache runs no scripts and fires
// no DOMContentLoaded -- both banners above would otherwise keep showing
// whatever they last rendered before the snapshot, even after the thing
// that would clear them (a sync, a visit to manager.html) happened on a
// different tab or a different in-app navigation since. Only worth
// re-checking on the actual bfcache-restore case (event.persisted); an
// ordinary fresh navigation already got both banners from DOMContentLoaded.
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  refreshGlobalSyncBanner();
  refreshManagedProjectsAlertBanner();
});

// ---------- Install-to-home-screen ----------
//
// The browser fires beforeinstallprompt early and only once per page load, so
// it's captured here (on every page) and stashed for the Settings page to use.
// Calling preventDefault suppresses the browser's own mini-infobar so the
// prompt appears when the user actually asks for it.
window.deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.deferredInstallPrompt = e;
  window.dispatchEvent(new CustomEvent('install-availability-changed'));
});

// Remembered because the tab the user installed *from* keeps running in the
// browser, where display-mode is still 'browser' -- without this it would go
// on telling them how to install something they just installed.
let appWasInstalledThisSession = false;

window.addEventListener('appinstalled', () => {
  window.deferredInstallPrompt = null;
  appWasInstalledThisSession = true;
  window.dispatchEvent(new CustomEvent('install-availability-changed'));
  applyBranding(); // harmless if already applied -- cheap enough to just rerun
});

function isAppInstalled() {
  return (
    appWasInstalledThisSession ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    navigator.standalone === true
  );
}

// ---------- [data-tip] hover tooltips: keep the bubble on-screen ----------
//
// [data-tip]'s bubble (style.css) centers itself on whatever it's attached
// to -- fine in the middle of a page, but a trigger sitting close to the
// left or right edge (a narrow dashboard card, a small icon near a column
// edge) centers a bubble that runs off the edge of the screen with the
// first word or two clipped and unreadable (see the UI audit, finding F-2).
// There's no way to know how close to an edge a trigger will land until
// it's actually on screen, so this measures it the moment a tooltip is
// about to show and nudges the bubble back on screen with a CSS custom
// property, instead of hand-tuning a fixed offset per instance the way the
// handful of existing top-row-clipping overrides in style.css already do
// for the vertical case.
function positionTip(el) {
  const BUBBLE_WIDTH = 230; // matches [data-tip]::after's max-width
  const MARGIN = 8;
  // clientWidth, not window.innerWidth -- innerWidth includes the vertical
  // scrollbar's own gutter, which isn't actually available for content, so
  // using it here left the bubble up to a scrollbar-width too far right.
  const viewportWidth = document.documentElement.clientWidth;
  const rect = el.getBoundingClientRect();
  const center = rect.left + rect.width / 2;
  let offset = 0;
  if (center - BUBBLE_WIDTH / 2 < MARGIN) offset = MARGIN - (center - BUBBLE_WIDTH / 2);
  else if (center + BUBBLE_WIDTH / 2 > viewportWidth - MARGIN) offset = (viewportWidth - MARGIN) - (center + BUBBLE_WIDTH / 2);
  el.style.setProperty('--tip-offset', offset + 'px');

  // Same idea, vertically: the bubble opens upward by default, which
  // clips against the top of the viewport -- or renders in front of the
  // sticky app header, or the trigger's own card's .step-header/
  // .rb-group-hd bar, instead of behind it, since the bubble's z-index
  // has to beat ordinary page content to escape its own card -- for
  // anything sitting near the top of the page, or just near the top of a
  // card whose own colored header bar is right above it (the very first
  // field in a card's body, for instance). style.css already has this
  // exact fix hand-coded for two specific known containers (.bar-row-top,
  // the weather calendar's first row); this is the same flip, but
  // measured against the real viewport -- and both header patterns'
  // actual rendered height, not a guess -- so it also covers a trigger in
  // an arbitrary header/card without needing its own one-off selector
  // added every time.
  const header = document.querySelector('.app-header');
  const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
  const card = el.closest('.step, .rb-group');
  const cardHeader = card ? card.querySelector(':scope > .step-header, :scope > .rb-group-hd') : null;
  const cardHeaderBottom = cardHeader ? cardHeader.getBoundingClientRect().bottom : 0;
  const BUBBLE_CLEARANCE = Math.max(60, headerBottom + 20, cardHeaderBottom + 20);
  el.classList.toggle('tip-flip-down', rect.top < BUBBLE_CLEARANCE);
}
document.addEventListener('pointerover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el) positionTip(el);
});
document.addEventListener('focusin', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el) { positionTip(el); return; }
  // Focus landed somewhere that isn't a tooltip trigger -- tabbing past a
  // tapped "i" icon into the very field it was explaining, say. The click
  // that focuses something already closes an open bubble in the common
  // case (see the click handler below), but a focus change with no
  // synthetic click behind it (keyboard nav, autofill, programmatic focus)
  // wouldn't otherwise -- left it stuck open over whatever was just
  // focused instead of closing the way tapping elsewhere already does.
  $$('[data-tip].tip-open').forEach((t) => t.classList.remove('tip-open'));
});
// A bubble that's covering something is exactly what someone would
// instinctively scroll past -- close it the moment that happens rather
// than have it ride along, still covering the same relative spot.
document.addEventListener('scroll', () => {
  $$('[data-tip].tip-open').forEach((t) => t.classList.remove('tip-open'));
}, { passive: true, capture: true });

// ---------- Tap-to-open: every [data-tip]'s bubble opens by tap, not just hover ----------
//
// [data-tip] showing only on :hover/:focus-visible left it with no path at
// all on a touch device -- there's no hover on a phone, and this app mostly
// runs on one. An .info-tip button carries its explanation ONLY in that
// bubble, so it's the clearest case, but a dashboard stat card, a pay item
// bar, or a weather calendar day (all [data-tip], none .info-tip) are just
// as unreachable by touch without this. Tapping any of them now opens the
// same bubble hovering would, closing on a tap elsewhere or on Escape --
// see the matching carve-out in style.css's touch media query, which used
// to hide these bubbles' content on touch instead of relying on this.
document.addEventListener('click', (e) => {
  const tip = e.target.closest('[data-tip]');
  if (tip) {
    const wasOpen = tip.classList.contains('tip-open');
    $$('[data-tip].tip-open').forEach((el) => el.classList.remove('tip-open'));
    if (!wasOpen) {
      positionTip(tip);
      tip.classList.add('tip-open');
    }
    // None of these (.info-tip, or a plain tabindex="0" div like a
    // dashboard stat card/weather calendar day) have a default action of
    // their own to preserve -- preventDefault guards against one
    // belonging to whatever it's nested inside instead, e.g. a <summary>
    // toggling its <details> closed, or a .rb-group-hd/[data-toggle-group]
    // row collapsing a card.
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  $$('[data-tip].tip-open').forEach((el) => el.classList.remove('tip-open'));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $$('[data-tip].tip-open').forEach((el) => el.classList.remove('tip-open'));
});
