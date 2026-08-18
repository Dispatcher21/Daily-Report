// Light/dark theming. Loaded from <head> on every page so the saved theme is
// applied before first paint -- otherwise a dark-mode user gets a white flash
// on every navigation, which is genuinely unpleasant at night.
//
// Three modes: 'auto' follows the device, 'light' and 'dark' are explicit.
// Field inspectors need a hard override either way: full sun washes out the
// dark theme, and night shifts make the light one blinding. The picker itself
// lives on the Settings page; every other page just gets a gear linking to it.
(function () {
  const KEY = 'daily-report-theme';
  const MODES = ['auto', 'light', 'dark'];

  function read() {
    try {
      const v = localStorage.getItem(KEY);
      return MODES.indexOf(v) !== -1 ? v : 'auto';
    } catch (e) {
      return 'auto';
    }
  }

  let mode = read();
  const listeners = [];

  function apply(m) {
    const root = document.documentElement;
    if (m === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', m);
  }

  apply(mode);

  function set(m) {
    if (MODES.indexOf(m) === -1) return;
    mode = m;
    apply(m);
    try {
      localStorage.setItem(KEY, m);
    } catch (e) {
      /* private mode -- theme just won't persist */
    }
    listeners.forEach((fn) => fn(mode));
  }

  // Every page except Settings itself gets a gear in the header.
  function mountGear() {
    const header = document.querySelector('.app-header');
    if (!header || header.querySelector('.header-gear')) return;
    if (/settings\.html$/i.test(location.pathname)) {
      const slot = header.querySelector(':scope > span:empty');
      if (slot) slot.remove();
      return;
    }
    const slot = header.querySelector(':scope > span:empty');
    const a = document.createElement('a');
    a.className = 'header-gear';
    a.href = 'settings.html';
    a.setAttribute('aria-label', 'Settings');
    a.title = 'Settings';
    a.textContent = '⚙';
    if (slot) slot.replaceWith(a);
    else header.appendChild(a);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountGear);
  } else {
    mountGear();
  }

  window.appTheme = {
    get: () => mode,
    set,
    modes: MODES.slice(),
    onChange: (fn) => listeners.push(fn),
  };
})();
