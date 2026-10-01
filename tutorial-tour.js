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

// ---------- Scripts, per page ----------
// Each step: `say` (the line), `emotion` (a TOUR_ART.emotions key),
// optional `target` (CSS selector to highlight and point at; skipped if it
// isn't on the page or visible), optional `before` (runs first, e.g. to open
// a collapsed section so the target is visible).
const TOUR_PAGES = {
  'index.html': [
    { emotion: 'happy', say: "Hi there! I'm your site inspector. I'll walk you through the app using an example project, so nothing here touches your real work. Tap Next to keep going, or Skip whenever you like." },
    {
      emotion: 'pointing', target: '#md-overview-step',
      before: () => {
        const toggle = document.querySelector('#md-mobile-toggle');
        if (toggle && getComputedStyle(toggle).display !== 'none' && toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
      },
      say: 'This is the Manager Dashboard. It rolls up every project you manage: total contract value, money earned so far, reports filed this week, and who is behind schedule.',
    },
    { emotion: 'neutral', target: '#md-calendar-step', say: 'The Report Activity calendar shows every report, one month at a time. Use the arrows to move between months, and tap a day to see what was done.' },
    { emotion: 'pointing', target: '#hub-grid .hub-card[data-drag-type="project"]', say: "These are your projects. Each card opens that project's dashboard, reports, and quantities." },
    { emotion: 'neutral', target: '#hamburger-btn', say: 'The menu gets you anywhere fast: home, any project, Settings, and this tutorial.' },
    { emotion: 'thinking', target: '.header-sync-btn', say: "This button syncs with your company and checks for app updates. It's switched off in the tutorial, so nothing ever leaves this device." },
    { emotion: 'happy', target: '.tutorial-banner', say: 'You can leave the tutorial any time from this bar, and tap Tips to hear from me again on any page.' },
    { emotion: 'pointing', target: '#hub-grid .hub-card[data-drag-type="project"]', say: "Let's look inside the example project. Tap DEMO-101 to continue the tour!" },
  ],
};

// ---------- Engine ----------
const TOUR_DONE_PREFIX = 'dr-tour-done:';
const TOUR_TYPE_MS = 18; // per character while the line types out

function tourPageKey() {
  const file = location.pathname.split('/').pop();
  return file || 'index.html';
}

// Fixed bars pinned to the bottom of the page (the report viewer's footer,
// the editor's save row on a phone) -- the tour sits above them.
function tourBottomClearance() {
  let clearance = 0;
  ['#rv-footer', '.save-row'].forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.display === 'none') return;
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.bottom >= window.innerHeight - 2) clearance = Math.max(clearance, window.innerHeight - r.top);
  });
  return clearance;
}

function tourVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

const tour = {
  steps: [], index: 0, root: null, ring: null, hand: null, typing: null, raf: 0, target: null,

  start(force) {
    const key = tourPageKey();
    const steps = TOUR_PAGES[key];
    if (!steps || !steps.length) return false;
    if (!force) {
      try { if (sessionStorage.getItem(TOUR_DONE_PREFIX + key)) return false; } catch (e) {}
    }
    this.end(false);
    this.steps = steps;
    this.index = 0;
    this.build();
    this.show();
    return true;
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
      </div>
      <img class="tour-char" alt="">`;
    this.root.querySelector('.tour-name').textContent = TOUR_ART.name;
    // Preload every emotion so switching expressions doesn't flash.
    Object.values(TOUR_ART.emotions).forEach((src) => { new Image().src = src; });
    document.body.append(this.ring, this.hand, this.root);
    this.root.querySelector('.tour-next').addEventListener('click', () => this.next());
    this.root.querySelector('.tour-back').addEventListener('click', () => this.go(this.index - 1));
    this.root.querySelector('.tour-skip').addEventListener('click', () => this.end(true));
    // Tapping the text while it's still typing finishes the line.
    this.root.querySelector('.tour-text').addEventListener('click', () => this.finishTyping());
    this.onKey = (e) => {
      if (e.key === 'Escape') this.end(true);
      else if (e.key === 'ArrowRight') this.next();
      else if (e.key === 'ArrowLeft') this.go(this.index - 1);
    };
    document.addEventListener('keydown', this.onKey);
    const loop = () => { this.place(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
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
    this.type(step.say);
    this.target = null;
    if (step.target) {
      // A target may still be rendering (or just revealed by `before`) --
      // give it a moment before deciding it isn't there.
      const started = Date.now();
      const find = () => {
        if (this.steps[this.index] !== step || !this.root) return;
        const el = document.querySelector(step.target);
        if (tourVisible(el)) {
          this.target = el;
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
  place() {
    if (!this.root) return;
    this.root.style.bottom = `${tourBottomClearance() + 12}px`;
    const el = this.target;
    if (!el || !tourVisible(el)) { this.ring.hidden = true; this.hand.hidden = true; return; }
    const r = el.getBoundingClientRect();
    const pad = 6;
    Object.assign(this.ring.style, {
      left: `${r.left - pad}px`, top: `${r.top - pad}px`,
      width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
    });
    this.ring.hidden = false;
    // The hand points up-left, so its body hangs down-right of the
    // fingertip. The tip goes to the middle of a small target, or a little
    // way into a big one from its top-left -- aiming at a big panel's
    // bottom-right put the hand right under the dialogue box.
    const art = TOUR_ART.hand;
    const scale = art.displayWidth / art.width;
    const tip = { x: art.tip.x * scale, y: art.tip.y * scale };
    const w = art.width * scale, h = art.height * scale;
    const tipX = Math.min(r.left + Math.min(r.width / 2, 70), window.innerWidth - (w - tip.x) - 4);
    const tipY = Math.min(r.top + Math.min(r.height / 2, 50), window.innerHeight - (h - tip.y) - 4);
    this.hand.style.left = `${tipX - tip.x}px`;
    this.hand.style.top = `${tipY - tip.y}px`;
    this.hand.hidden = false;
  },

  end(markDone) {
    if (markDone) {
      try { sessionStorage.setItem(TOUR_DONE_PREFIX + tourPageKey(), '1'); } catch (e) {}
    }
    clearInterval(this.typing);
    this.typing = null;
    cancelAnimationFrame(this.raf);
    if (this.onKey) document.removeEventListener('keydown', this.onKey);
    [this.root, this.ring, this.hand].forEach((el) => el && el.remove());
    this.root = this.ring = this.hand = this.target = null;
  },
};

// Starts once the page has had a moment to render its own content.
function startTourWhenReady() {
  setTimeout(() => tour.start(false), 900);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startTourWhenReady);
else startTourWhenReady();

// The banner's Tips button (common.js) replays this page's tour -- shown
// only on pages that have one.
function syncTipsButton() {
  const btn = document.querySelector('.tutorial-tips');
  if (btn) btn.hidden = !TOUR_PAGES[tourPageKey()];
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncTipsButton);
else syncTipsButton();
document.addEventListener('click', (e) => {
  if (e.target.closest('.tutorial-tips')) tour.start(true);
});
