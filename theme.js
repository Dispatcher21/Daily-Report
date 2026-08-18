// Light/dark theming. Loaded from <head> on every page so the saved theme is
// applied before first paint -- otherwise a dark-mode user gets a white flash
// on every navigation, which is genuinely unpleasant at night.
//
// Three modes: 'auto' follows the device, 'light' and 'dark' are explicit.
// Field inspectors need a hard override either way: full sun washes out the
// dark theme, and night shifts make the light one blinding.
(function () {
  const KEY = 'daily-report-theme';
  const MODES = ['auto', 'light', 'dark'];
  const LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  const ICONS = { auto: '◐', light: '☀', dark: '☾' };

  function read() {
    try {
      const v = localStorage.getItem(KEY);
      return MODES.indexOf(v) !== -1 ? v : 'auto';
    } catch (e) {
      return 'auto';
    }
  }

  let mode = read();

  function apply(m) {
    const root = document.documentElement;
    if (m === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', m);
  }

  apply(mode);

  function set(m) {
    mode = m;
    apply(m);
    try {
      localStorage.setItem(KEY, m);
    } catch (e) {
      /* private mode -- theme just won't persist */
    }
    render();
  }

  let btn = null;

  function render() {
    if (!btn) return;
    btn.innerHTML = `<span class="tt-icon">${ICONS[mode]}</span><span class="tt-label">${LABELS[mode]}</span>`;
    btn.setAttribute('aria-label', `Theme: ${LABELS[mode]}. Tap to change.`);
    btn.title = `Theme: ${LABELS[mode]} (tap to change)`;
  }

  function mount() {
    const header = document.querySelector('.app-header');
    if (!header || header.querySelector('.theme-toggle')) return;
    // The pages keep an empty <span> as the header's right-hand slot.
    const slot = header.querySelector(':scope > span:empty');
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle';
    btn.addEventListener('click', () => set(MODES[(MODES.indexOf(mode) + 1) % MODES.length]));
    if (slot) slot.replaceWith(btn);
    else header.appendChild(btn);
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  window.appTheme = { get: () => mode, set };
})();
