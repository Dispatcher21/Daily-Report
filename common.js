// Small shared helpers used across every page. No page-specific logic here.

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
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
};

// Appends a reference code to a user-facing error message -- use for every
// alert()/error-div that shows a caught error. `key` should be one of
// ERROR_CODES above; an unrecognized or missing key falls back to a generic
// code rather than showing no code at all.
function userError(message, key) {
  const code = ERROR_CODES[key] || 'SPARKPLUG';
  return `${message}\n\nReference code: ${code} (see error-codes.txt if you need to report this)`;
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
  navigator.serviceWorker.register('service-worker.js').catch(console.error);
}

// Deferred to DOMContentLoaded because applyHeaderLogo lives in storage.js,
// which every page loads after this file.
function applyBranding() {
  if (typeof applyHeaderLogo === 'function') applyHeaderLogo();
}
document.addEventListener('DOMContentLoaded', applyBranding);

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
  if (el) positionTip(el);
});

// [data-tip]'s bubble is only hidden via opacity/visibility (so it can
// transition in), never display:none -- so even closed, it's still laid
// out at its default centered position and counts toward the page's
// scrollable width. That's invisible and harmless for a trigger away from
// the edges, but an .info-tip pinned to a card's top-right corner defaults
// to a bubble centered on itself, which reaches well past the right edge
// before anything has ever been hovered/tapped to correct it with
// --tip-offset. Positioning every trigger once up front (and again on
// resize) means that corrected offset is already in place before it's
// ever needed, so a never-touched icon doesn't silently widen the page.
function positionAllTips() {
  $$('[data-tip]').forEach(positionTip);
}
document.addEventListener('DOMContentLoaded', positionAllTips);
let tipResizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(tipResizeTimer);
  tipResizeTimer = setTimeout(positionAllTips, 150);
});
// A card that's [hidden] until its data finishes loading (several of the
// Manager Dashboard's) is display:none at the DOMContentLoaded pass above,
// so any tip inside it lays out at zero size and gets --tip-offset: 0 --
// harmless while still hidden, since display:none excludes it from the
// page's scrollable width entirely, but wrong the instant it's revealed at
// its real position without ever having been re-measured. Watching for
// `hidden` coming off anywhere covers every such card on every page
// without needing a re-positioning call added at each one's own reveal
// point.
new MutationObserver((mutations) => {
  if (mutations.some((m) => m.target.hasAttribute && !m.target.hasAttribute('hidden'))) {
    clearTimeout(tipResizeTimer);
    tipResizeTimer = setTimeout(positionAllTips, 50);
  }
}).observe(document.documentElement, { attributes: true, attributeFilter: ['hidden'], subtree: true });

// ---------- .info-tip: a small "i" that opens [data-tip]'s bubble by tap ----------
//
// [data-tip] only shows on :hover/:focus-visible, which -- deliberately,
// see the CSS comment on .report-warn-btn -- is completely inert on a
// touch device: there's no hover on a phone, and this app mostly runs on
// one. A plain descriptive paragraph is always readable regardless, but an
// .info-tip button carries its explanation ONLY in that bubble, so it
// needs a tap-to-open path or the explanation simply doesn't exist for a
// touch user. This adds that, without changing how [data-tip] behaves
// anywhere else it's already used (plain hover/focus, unchanged).
document.addEventListener('click', (e) => {
  const tip = e.target.closest('.info-tip');
  if (tip) {
    const wasOpen = tip.classList.contains('tip-open');
    $$('.info-tip.tip-open').forEach((el) => el.classList.remove('tip-open'));
    if (!wasOpen) {
      positionTip(tip);
      tip.classList.add('tip-open');
    }
    // Always type="button", so there's no default action of its own to
    // preserve -- preventDefault guards against one belonging to whatever
    // it's nested inside instead, e.g. a <summary> toggling its <details>
    // closed, or a .rb-group-hd/[data-toggle-group] row collapsing a card.
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (!e.target.closest('[data-tip]')) $$('.info-tip.tip-open').forEach((el) => el.classList.remove('tip-open'));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $$('.info-tip.tip-open').forEach((el) => el.classList.remove('tip-open'));
});
