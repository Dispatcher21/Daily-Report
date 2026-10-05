// Guided tour for tutorial mode: an inspector character in the bottom-right
// corner talks the person through each page RPG-style, and a floating hand
// points at whatever is being explained. Only loaded in tutorial mode (see
// common.js). Each page's tour plays once per tutorial session, the first
// time that page is opened; the banner's Tips button replays it.

// ---------- Art ----------
// Swap these paths for the real art. Every emotion image should share the
// same canvas size with the character in the same spot, so swapping
// expressions never shifts them. The hand points up-left; `width`/`height`
// are its natural size and `tip` its fingertip in those same pixels, and
// `displayWidth` is how wide it shows on screen.
const TOUR_ART = {
  name: 'Inspector',
  emotions: {
    neutral: 'tutorial/inspector-neutral.svg',
    happy: 'tutorial/inspector-happy.svg',
    thinking: 'tutorial/inspector-thinking.svg',
    surprised: 'tutorial/inspector-surprised.svg',
    pointing: 'tutorial/inspector-pointing.svg',
  },
  hand: { src: 'tutorial/hand.svg', width: 80, height: 80, tip: { x: 9, y: 10 }, displayWidth: 56 },
};

// ---------- Things the hand can point at, per page ----------
// The lines themselves live in tutorial/dialogue.txt, so they can be edited
// without touching code. A line's "Points at:" names one of these. Names
// are matched loosely: case, punctuation, a leading "the", and anything in
// (parentheses) are ignored. `selector` is a CSS selector, or a list tried
// in order (the first one visible wins, e.g. a desktop panel vs. its phone
// stand-in). `before` runs first, e.g. to open a collapsed section. The
// '*' list works on every page. Keep the name lists at the top of
// dialogue.txt in step with these.
function tourExpand(sel) {
  const el = document.querySelector(sel);
  if (el && el.classList.contains('collapsed')) {
    const hd = el.querySelector(':scope > .step-header');
    if (hd) hd.click();
  }
}
function tourOpenDetails(sel) {
  const el = document.querySelector(sel);
  if (el && el.tagName === 'DETAILS' && !el.open) el.open = true;
}
// Pay Apps: open the newest recorded one (if nothing's open yet) so the
// panel's parts are on screen to point at.
function tourOpenFirstPayApp() {
  if (document.querySelector('.pa-list-item.selected')) return;
  const first = document.querySelector('.pa-list-item');
  if (first) first.click();
}
function tourOpenEditorGroup(id) {
  const card = document.querySelector(`#rb-group-${id}`);
  if (card && !card.classList.contains('open')) {
    const hd = card.querySelector('[data-toggle-group]');
    if (hd) hd.click();
  }
}
const TOUR_TARGETS = {
  '*': {
    'menu button': { selector: '#hamburger-btn' },
    'sync button': { selector: '.header-sync-btn' },
    'tutorial bar': { selector: '.tutorial-banner' },
    'tips button': { selector: '.tutorial-tips' },
    'breadcrumb': { selector: '#bb-trail' },
    'activity banner': { selector: '#managed-projects-alert-banner' },
  },
  'index.html': {
    'portfolio panel': {
      selector: '#md-overview-step',
      before: () => {
        const toggle = document.querySelector('#md-mobile-toggle');
        if (toggle && getComputedStyle(toggle).display !== 'none' && toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
      },
    },
    'activity calendar': { selector: '#md-calendar-step' },
    'project card': { selector: '#hub-grid .hub-card[data-drag-type="project"]' },
  },
  'project.html': {
    'new report tile': { selector: '#card-new-report' },
    'view reports tile': { selector: '#card-view-reports' },
    'quick quantity tile': { selector: '#card-quick-quantity' },
    'quantity sheet tile': { selector: '#card-quantity-sheet' },
    'dashboard overview': { selector: '#dash-content > .step:first-child' },
    'pay items panel': { selector: '#dash-content .step-pair > .step:first-child', before: () => tourExpand('#dash-content .step-pair > .step:first-child') },
    'weather panel': { selector: '#dash-weather-step', before: () => tourExpand('#dash-weather-step') },
    'trend chart': { selector: '#dash-trend-step', before: () => tourExpand('#dash-trend-step') },
    'project settings button': { selector: '#btn-toggle-settings' },
  },
  'reports.html': {
    'filters': { selector: '.filter-row' },
    'search box': { selector: '#f-search' },
    'view toggle': { selector: '#view-toggle' },
    'report list': { selector: '#report-list' },
    'first report': { selector: ['#report-list .report-row', '#report-list .report-card'] },
    'checkbox': { selector: '#report-list .report-row-check' },
    'select all': { selector: '#btn-select-all' },
    'comment badge': { selector: '#report-list .report-corner-badge' },
    'new report button': { selector: '#fab-new-report' },
    'deleted reports': { selector: '#trash-step' },
  },
  'report-viewer.html': {
    'report page': { selector: '#rv-preview' },
    'side reports': { selector: ['#rv-side-left:not([hidden])', '#rv-side-right:not([hidden])', '#rv-side-arrow-right', '#rv-side-arrow-left', '#rv-mobile-nav-next', '#rv-mobile-nav-prev'] },
    'details bar': { selector: '#rv-details-toggle' },
    'review bar': { selector: '#rv-review-toggle' },
    'pinned comment': { selector: '.rv-pin-marker:not(.rv-pin-pending)' },
    'edit button': { selector: '#bb-edit-link' },
  },
  'report-editor.html': {
    'no work day button': { selector: '#btn-no-work-day' },
    'weather day button': { selector: '#btn-weather-day' },
    'report info': { selector: '#step-reportInfo' },
    'date field': { selector: '#f-date' },
    'inspectors': { selector: '#inspectors-toggle' },
    'sections': { selector: '#rb-groups' },
    'contractors section': { selector: '#rb-group-contractorsEquipment', before: () => tourOpenEditorGroup('contractorsEquipment') },
    'pay items section': { selector: '#rb-group-payItems', before: () => tourOpenEditorGroup('payItems') },
    'weather section': { selector: '#rb-group-weather', before: () => tourOpenEditorGroup('weather') },
    'fetch weather button': { selector: '#btn-fetch-weather', before: () => tourOpenEditorGroup('weather') },
    'photos section': { selector: '#rb-group-photos', before: () => tourOpenEditorGroup('photos') },
    'live preview': { selector: ['#rb-preview-col', '#rb-mobile-tabs'] },
    'preview tabs': { selector: '#rb-mobile-tabs' },
    'save button': { selector: '#btn-save-report' },
    'generate button': { selector: '#btn-generate' },
    'duplicate button': { selector: '#btn-duplicate-report' },
  },
  'quantity-sheet.html': {
    'report range': { selector: '.step:has(#range-mode-picker)' },
    'range options': { selector: '#range-mode-picker' },
    'manage pay apps link': { selector: '#link-pay-apps' },
    'pay app file': { selector: '#payapp-file-step' },
    'quantities': { selector: '.step:has(#view-picker)' },
    'view tabs': { selector: '#view-picker' },
    'item bars': { selector: '#qty-bars' },
    'excel preview': { selector: '#totals-preview-table' },
    'download button': { selector: '#btn-generate' },
  },
  'quick-quantity.html': {
    'date field': { selector: '#f-date' },
    'item list': { selector: '#catalog-list' },
    'first quantity box': { selector: '#catalog-list input' },
    'add item not in catalog': { selector: '#add-manual-section' },
    'save button': { selector: '#btn-save-quantities' },
  },
  'pay-apps.html': {
    'pay app list': { selector: '#pa-list-step' },
    'first pay app': { selector: '.pa-list-item' },
    'new pay app button': { selector: '#pa-new-btn' },
    'status': { selector: '#pa-status-line', before: tourOpenFirstPayApp },
    'items': { selector: '#payapp-items-list', before: tourOpenFirstPayApp },
    'differences filter': { selector: '#pa-filter', before: tourOpenFirstPayApp },
    'enter by button': { selector: '#payapp-items-list .pac-mode-toggle', before: tourOpenFirstPayApp },
    'totals bar': { selector: '#pa-actionbar', before: tourOpenFirstPayApp },
    'review section': { selector: '#pa-review', before: tourOpenFirstPayApp },
  },
  'download.html': {
    'logo warning': { selector: '#no-logo-warning' },
    'pdf preview': { selector: ['#pdf-preview-wrap', '#pdf-mobile-gallery'] },
    'download button': { selector: '#btn-download-pdf' },
  },
  'report-photos.html': {
    'photos': { selector: '#rp-photo-grid' },
    'view report button': { selector: '#bb-report-link' },
  },
  'manager.html': {
    'reports to review': { selector: '#mgr-review-step' },
    'first report': { selector: '#mgr-review-list .mp-row' },
    'pay apps to review': { selector: '#mgr-payapp-review-step' },
    'managed projects': { selector: '#mgr-projects-step' },
    'project checkboxes': { selector: '#mgr-project-checks' },
  },
  'settings.html': {
    'you tab': { selector: '#tab-you' },
    'company tab': { selector: '#tab-company' },
    'profile': { selector: '.settings-section:has(#f-user-name)', before: () => tourOpenDetails('.settings-section:has(#f-user-name)') },
    'appearance': { selector: '.settings-section:has(#theme-picker)', before: () => tourOpenDetails('.settings-section:has(#theme-picker)') },
    'theme buttons': { selector: '#theme-picker', before: () => tourOpenDetails('.settings-section:has(#theme-picker)') },
    'accent colors': { selector: '#accent-swatches', before: () => tourOpenDetails('.settings-section:has(#theme-picker)') },
    'app section': { selector: '.settings-section:has(#btn-install)' },
    'tutorial section': { selector: '#tutorial-section' },
    'sync to folder': { selector: '#sync-section' },
  },
};

// ---------- Dialogue file ----------
const TOUR_DIALOGUE_URL = 'tutorial/dialogue.txt';

function tourNameKey(name) {
  return String(name || '').toLowerCase().replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
}

// Reads dialogue.txt into { name, pages: { 'index.html': [steps] } }. The
// format is explained at the top of that file. Each step's text lines are
// joined into one paragraph; a blank line inside a step starts a new one.
function parseTourDialogue(text) {
  const out = { name: null, pages: {} };
  let page = null, step = null;
  const finish = () => {
    if (!step) return;
    const paras = step.lines.join('\n').split(/\n\s*\n/).map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean).join(' ')).filter(Boolean);
    step.say = paras.join('\n');
    delete step.lines;
    if (!step.say) page.splice(page.indexOf(step), 1);
    step = null;
  };
  text.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    let m;
    if (line.startsWith('#')) return;
    if ((m = line.match(/^character name:\s*(.*)$/i))) { out.name = m[1].trim() || null; return; }
    if (/^===.*===$/.test(line)) {
      finish();
      m = line.match(/\(([^)]+)\)/);
      const key = m && m[1].trim().toLowerCase();
      page = key ? (out.pages[key] = out.pages[key] || []) : null;
      return;
    }
    if (!page) return;
    if (/^\[\s*\d*\s*\]$/.test(line)) { finish(); step = { emotion: 'neutral', target: null, lines: [] }; page.push(step); return; }
    if (!step) return;
    if (!step.lines.length && (m = line.match(/^emotion:\s*(.*)$/i))) { step.emotion = m[1].trim().toLowerCase(); return; }
    if (!step.lines.length && (m = line.match(/^(walkthrough|explore) button:\s*(.*)$/i))) { step[`${m[1].toLowerCase()}Button`] = m[2].trim(); return; }
    if (!step.lines.length && (m = line.match(/^points at:\s*(.*)$/i))) {
      const t = m[1].trim();
      step.target = /^(nothing|none|-)?$/i.test(t) ? null : t;
      return;
    }
    step.lines.push(raw);
  });
  finish();
  return out;
}

// Turns a "Points at" name into { selector, before }. A name starting with
// # or . is taken as a CSS selector as-is.
function tourResolveTarget(page, name) {
  if (!name) return null;
  if (/^[#.]/.test(name)) return { selector: name };
  const key = tourNameKey(name);
  const found = (TOUR_TARGETS[page] || {})[key] || TOUR_TARGETS['*'][key];
  if (!found) console.warn(`Tutorial: nothing called "${name}" to point at on ${page}`);
  return found || null;
}

let tourDialogue = null;
const tourDialogueReady = fetch(TOUR_DIALOGUE_URL, { cache: 'no-store' })
  .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
  .then((text) => { tourDialogue = parseTourDialogue(text); })
  .catch((e) => { console.error('Tutorial: could not load the dialogue file:', e); });

function tourStepsForPage(page) {
  if (!tourDialogue) return null;
  const steps = tourDialogue.pages[page];
  if (!steps || !steps.length) return null;
  return steps.map((s) => {
    if (!TOUR_ART.emotions[s.emotion]) console.warn(`Tutorial: no "${s.emotion}" emotion image, showing neutral`);
    const t = tourResolveTarget(page, s.target);
    return { emotion: s.emotion, say: s.say, target: t && t.selector, before: t && t.before, walkthroughButton: s.walkthroughButton, exploreButton: s.exploreButton };
  });
}

// ---------- Engine ----------
const TOUR_DONE_PREFIX = 'dr-tour-done:';
// 'guided' (each page's tour plays the first time it opens) or 'explore'
// (only when Tips is tapped). Unset until the person answers the welcome.
// tutorial.html clears it, and the done flags, on every enter and exit.
const TOUR_MODE_KEY = 'dr-tour-mode';

function tourMode() {
  try { return sessionStorage.getItem(TOUR_MODE_KEY); } catch (e) { return null; }
}
function setTourMode(mode) {
  try { sessionStorage.setItem(TOUR_MODE_KEY, mode); } catch (e) {}
}

// Used only if dialogue.txt can't be loaded at all.
const TOUR_FALLBACK = {
  welcome: [{ emotion: 'happy', say: "Hi there! This is a sandbox with an example project, so nothing you do here touches your real work. Want a walkthrough, or would you rather explore on your own?" }],
  'no tips': [{ emotion: 'thinking', say: "I couldn't load my notes. Check your connection and refresh the page." }],
};
function tourSection(key) {
  return tourStepsForPage(key) || (!tourDialogue && TOUR_FALLBACK[key]) || null;
}
const TOUR_TYPE_MS = 18; // per character while the line types out

function tourPageKey() {
  const file = location.pathname.split('/').pop();
  return file || 'index.html';
}

// Bars pinned to the bottom of the screen (the report viewer's footer, the
// editor's save row on a phone, a sticky Download/Save bar) -- the tour
// sits above them.
function tourBottomClearance() {
  let clearance = 0;
  ['#rv-footer', '.save-row', '.export-bar'].forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const cs = getComputedStyle(el);
    if ((cs.position !== 'fixed' && cs.position !== 'sticky') || cs.display === 'none') return;
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.bottom >= window.innerHeight - 2) clearance = Math.max(clearance, window.innerHeight - r.top);
  });
  return clearance;
}

// The sticky header at the top: a target scrolled up under it is hidden,
// so the ring and hand only cover the part of it still showing.
function tourTopClearance(el) {
  const header = document.querySelector('.app-header');
  if (!header || (el && header.contains(el))) return 0;
  const pos = getComputedStyle(header).position;
  if (pos !== 'sticky' && pos !== 'fixed') return 0;
  return Math.max(0, header.getBoundingClientRect().bottom);
}

// True for something inside a bar that's pinned in place (the header, the
// viewer's footer, the editor's tabs or save row): it never slides under
// one of those bars, so it's never clipped by them.
function tourInPinnedBar(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const pos = getComputedStyle(n).position;
    if (pos === 'fixed' || pos === 'sticky') return true;
  }
  return false;
}

// First visible match for a step's selector (or list of selectors).
function tourFindTarget(target) {
  if (!target) return null;
  return [].concat(target).map((sel) => document.querySelector(sel)).find(tourVisible) || null;
}

function tourVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

const tour = {
  steps: [], index: 0, root: null, ring: null, hand: null, typing: null, raf: 0, target: null,

  // This page's tour. Without `force`, only if it hasn't played yet.
  start(force) {
    const key = tourPageKey();
    const steps = tourStepsForPage(key);
    if (!steps) return false;
    if (!force) {
      try { if (sessionStorage.getItem(TOUR_DONE_PREFIX + key)) return false; } catch (e) {}
    }
    this.play(steps, { doneKey: key });
    return true;
  },

  // The first thing shown in a new tutorial: its last line asks whether to
  // take the walkthrough or explore alone.
  welcome() {
    const steps = tourSection('welcome');
    if (!steps) { setTourMode('guided'); this.start(false); return; }
    this.play(steps, { choice: true });
  },

  choose(mode) {
    setTourMode(mode);
    this.end(false);
    if (mode === 'guided') this.start(false);
    else this.playSection('explore');
  },

  playSection(key) {
    const steps = tourSection(key);
    if (steps) this.play(steps, {});
  },

  play(steps, opts) {
    this.end(false);
    this.steps = steps;
    this.opts = opts;
    this.index = 0;
    this.build();
    this.show();
  },

  build() {
    this.ring = document.createElement('div');
    this.ring.className = 'tour-ring';
    this.ring.hidden = true;
    this.hand = document.createElement('img');
    this.hand.className = 'tour-hand';
    this.hand.src = TOUR_ART.hand.src;
    this.hand.alt = '';
    this.hand.style.width = `${TOUR_ART.hand.displayWidth}px`;
    this.hand.hidden = true;
    this.root = document.createElement('div');
    this.root.className = 'tour-root';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-live', 'polite');
    this.root.setAttribute('aria-label', 'Tutorial guide');
    this.root.innerHTML = `
      <div class="tour-box">
        <div class="tour-name"></div>
        <p class="tour-text"></p>
        <div class="tour-controls">
          <span class="tour-count"></span>
          <button type="button" class="tour-btn tour-skip">Skip</button>
          <button type="button" class="tour-btn tour-back">Back</button>
          <button type="button" class="tour-btn tour-next">Next</button>
        </div>
        <div class="tour-choice" hidden>
          <button type="button" class="tour-btn tour-choose-explore"></button>
          <button type="button" class="tour-btn tour-choose-guided"></button>
        </div>
      </div>
      <img class="tour-char" alt="">`;
    this.root.querySelector('.tour-name').textContent = (tourDialogue && tourDialogue.name) || TOUR_ART.name;
    // Preload every emotion so switching expressions doesn't flash.
    Object.values(TOUR_ART.emotions).forEach((src) => { new Image().src = src; });
    document.body.append(this.ring, this.hand, this.root);
    this.root.querySelector('.tour-next').addEventListener('click', () => this.next());
    this.root.querySelector('.tour-back').addEventListener('click', () => this.go(this.index - 1));
    this.root.querySelector('.tour-skip').addEventListener('click', () => this.skip());
    this.root.querySelector('.tour-choose-guided').addEventListener('click', () => this.choose('guided'));
    this.root.querySelector('.tour-choose-explore').addEventListener('click', () => this.choose('explore'));
    // Tapping the text while it's still typing finishes the line.
    this.root.querySelector('.tour-text').addEventListener('click', () => this.finishTyping());
    this.onKey = (e) => {
      if (e.key === 'Escape') this.skip();
      else if (e.key === 'ArrowRight' && !this.onChoice()) this.next();
      else if (e.key === 'ArrowLeft') this.go(this.index - 1);
    };
    document.addEventListener('keydown', this.onKey);
    const loop = () => { this.place(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  },

  // Skipping the welcome counts as choosing to explore.
  skip() {
    if (this.opts && this.opts.choice) { setTourMode('explore'); this.end(false); }
    else this.end(true);
  },

  onChoice() {
    return !!(this.opts && this.opts.choice && this.index === this.steps.length - 1);
  },

  next() {
    if (this.typing) { this.finishTyping(); return; }
    if (this.index >= this.steps.length - 1) this.end(true);
    else this.go(this.index + 1);
  },

  go(i) {
    if (i < 0 || i >= this.steps.length) return;
    this.index = i;
    this.show();
  },

  show() {
    const step = this.steps[this.index];
    if (step.before) { try { step.before(); } catch (e) { console.error('tour step:', e); } }
    const char = this.root.querySelector('.tour-char');
    char.src = TOUR_ART.emotions[step.emotion] || TOUR_ART.emotions.neutral;
    this.root.querySelector('.tour-count').textContent = `${this.index + 1} / ${this.steps.length}`;
    this.root.querySelector('.tour-back').disabled = this.index === 0;
    this.root.querySelector('.tour-next').textContent = this.index === this.steps.length - 1 ? 'Got it' : 'Next';
    const choice = this.onChoice();
    this.root.querySelector('.tour-controls').hidden = choice && this.steps.length === 1;
    this.root.querySelector('.tour-next').hidden = choice;
    this.root.querySelector('.tour-skip').hidden = choice;
    this.root.querySelector('.tour-choice').hidden = !choice;
    if (choice) {
      this.root.querySelector('.tour-choose-guided').textContent = step.walkthroughButton || 'Show me around';
      this.root.querySelector('.tour-choose-explore').textContent = step.exploreButton || "I'll explore";
    }
    this.type(step.say);
    this.target = null;
    if (step.target) {
      // A target may still be rendering (or just revealed by `before`) --
      // give it a moment before deciding it isn't there.
      const started = Date.now();
      const find = () => {
        if (this.steps[this.index] !== step || !this.root) return;
        const el = tourFindTarget(step.target);
        if (el) {
          this.target = el;
          this.glide();
          el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        } else if (Date.now() - started < 1500) setTimeout(find, 100);
      };
      find();
    }
  },

  type(text) {
    const el = this.root.querySelector('.tour-text');
    clearInterval(this.typing);
    this.typing = null;
    this.fullText = text;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = text; return; }
    let n = 0;
    el.textContent = '';
    this.typing = setInterval(() => {
      n += 1;
      el.textContent = text.slice(0, n);
      if (n >= text.length) this.finishTyping();
    }, TOUR_TYPE_MS);
  },

  finishTyping() {
    if (!this.typing) return;
    clearInterval(this.typing);
    this.typing = null;
    this.root.querySelector('.tour-text').textContent = this.fullText;
  },

  // Runs every frame while the tour is open: keeps the box above any fixed
  // footer, and the ring/hand on the target as the page scrolls or reflows.
  // Slides the ring and hand over to a new step's target. Only then:
  // while the page scrolls or shifts they follow it exactly, no lag.
  glide() {
    if (!this.ring || this.ring.hidden) return; // first appearance: no slide from nowhere
    [this.ring, this.hand].forEach((el) => el.classList.add('tour-glide'));
    clearTimeout(this.glideTimer);
    this.glideTimer = setTimeout(() => {
      [this.ring, this.hand].forEach((el) => el && el.classList.remove('tour-glide'));
    }, 400);
  },

  // Runs every frame while the tour is open. Measures the target and hands
  // its box to CSS as variables on the ring and hand (--tour-x/-y/-w/-h,
  // --tour-hand-x/-y/-sx/-sy), which position them -- so they move in step
  // with the page as it scrolls, reflows, or opens and closes sections. A
  // target the page has redrawn since (replaced, or hidden and shown again)
  // is looked up again from the step's selector.
  place() {
    if (!this.root) return;
    const step = this.steps[this.index];
    if (this.target && (!this.target.isConnected || !tourVisible(this.target))) {
      this.target = tourFindTarget(step && step.target) || this.target;
    }
    const el = this.target;
    const bottomBars = tourBottomClearance();
    let r = null;
    if (el && el.isConnected && tourVisible(el)) {
      // Only the part of the target that isn't under the sticky header or a
      // bar pinned to the bottom.
      const b = el.getBoundingClientRect();
      const pinned = tourInPinnedBar(el);
      const top = pinned ? b.top : Math.max(b.top, tourTopClearance(el));
      const bottom = pinned ? b.bottom : Math.min(b.bottom, window.innerHeight - bottomBars);
      if (bottom - top >= 8) r = { left: b.left, right: b.right, top, bottom, width: b.width, height: bottom - top };
    }
    // The box lives in the bottom-right corner, but moves to the top when it
    // would sit on top of the thing being pointed at (a button at the very
    // bottom of the page) and the top is clear.
    const gap = bottomBars + 12;
    let atTop = false;
    if (r) {
      const h = this.root.offsetHeight, w = this.root.offsetWidth;
      const covers = (top) => r.right > window.innerWidth - 12 - w && r.left < window.innerWidth - 12 && r.bottom > top && r.top < top + h;
      atTop = covers(window.innerHeight - gap - h) && !covers(12);
    }
    this.root.style.bottom = atTop ? 'auto' : `${gap}px`;
    this.root.style.top = atTop ? '12px' : 'auto';
    if (!r) { this.ring.hidden = true; this.hand.hidden = true; return; }
    const ring = this.ring.style;
    ring.setProperty('--tour-x', `${r.left}px`);
    ring.setProperty('--tour-y', `${r.top}px`);
    ring.setProperty('--tour-w', `${r.width}px`);
    ring.setProperty('--tour-h', `${r.height}px`);
    this.ring.hidden = false;
    // The hand points up-left, so its body hangs down-right of the
    // fingertip. The tip goes to the middle of a small target, or a little
    // way into a big one from its top-left -- aiming at a big panel's
    // bottom-right put the hand right under the dialogue box.
    // Near the bottom or right edge there's no room for the hand's body, so
    // it flips to point down or left from the other side instead.
    const art = TOUR_ART.hand;
    const scale = art.displayWidth / art.width;
    const w = art.width * scale, h = art.height * scale;
    const tipX = r.left + Math.min(r.width / 2, 70);
    const tipY = r.top + Math.min(r.height / 2, 50);
    const flipX = tipX + (w - art.tip.x * scale) > window.innerWidth - 4;
    const flipY = tipY + (h - art.tip.y * scale) > window.innerHeight - 4;
    const tip = {
      x: (flipX ? art.width - art.tip.x : art.tip.x) * scale,
      y: (flipY ? art.height - art.tip.y : art.tip.y) * scale,
    };
    const hand = this.hand.style;
    hand.setProperty('--tour-hand-x', `${tipX - tip.x}px`);
    hand.setProperty('--tour-hand-y', `${tipY - tip.y}px`);
    hand.setProperty('--tour-hand-sx', flipX ? -1 : 1);
    hand.setProperty('--tour-hand-sy', flipY ? -1 : 1);
    this.hand.hidden = false;
  },

  end(markDone) {
    if (markDone && this.opts && this.opts.doneKey) {
      try { sessionStorage.setItem(TOUR_DONE_PREFIX + this.opts.doneKey, '1'); } catch (e) {}
    }
    clearInterval(this.typing);
    this.typing = null;
    clearTimeout(this.glideTimer);
    cancelAnimationFrame(this.raf);
    if (this.onKey) document.removeEventListener('keydown', this.onKey);
    [this.root, this.ring, this.hand].forEach((el) => el && el.remove());
    this.root = this.ring = this.hand = this.target = this.opts = null;
  },
};

// Once the dialogue is loaded and the page has had a moment to render: a
// new tutorial opens with the welcome; after that, page tours play by
// themselves only for someone who chose the walkthrough.
function startTourWhenReady() {
  Promise.all([tourDialogueReady, new Promise((r) => setTimeout(r, 900))]).then(() => {
    const mode = tourMode();
    if (mode === 'guided') tour.start(false);
    else if (mode !== 'explore') tour.welcome();
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startTourWhenReady);
else startTourWhenReady();

// The banner's Tips button (common.js) replays this page's tour, or says
// there's nothing for this page yet.
function showTipsButton() {
  const btn = document.querySelector('.tutorial-tips');
  if (btn) btn.hidden = false;
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showTipsButton);
else showTipsButton();
document.addEventListener('click', (e) => {
  if (!e.target.closest('.tutorial-tips')) return;
  if (!tour.start(true)) tour.playSection('no tips');
});
