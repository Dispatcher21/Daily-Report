// Light/dark theming. Loaded from <head> on every page so the saved theme is
// applied before first paint -- otherwise a dark-mode user gets a white flash
// on every navigation, which is genuinely unpleasant at night.
//
// Three modes: 'auto' follows the device, 'light' and 'dark' are explicit.
// Field inspectors need a hard override either way: full sun washes out the
// dark theme, and night shifts make the light one blinding. The picker itself
// lives on the Settings page; every other page just gets a gear linking to it.
// ---------- Accent colour ----------
//
// One hex value the user picks stands in for the app's whole "brand" palette
// (buttons, headers, badges, links, focus rings). Light and dark mode each
// need a different lightness/contrast treatment of that same hue -- a colour
// picked to pop on a white background usually disappears on a near-black
// one -- so this derives both from the single stored value rather than
// asking the user to pick twice.
const ACCENT_KEY = 'daily-report-accent';
const DEFAULT_ACCENT = '#1c3d5a'; // matches the built-in brand blue exactly
const ACCENT_VARS = ['--brand', '--brand-strong', '--brand-light', '--brand-dim', '--on-brand', '--link', '--focus'];

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}
function rgbToHex({ r, g, b }) {
  const h = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}
function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}
function hslToRgb({ h, s, l }) {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
  };
}
function adjustLightness(hex, deltaPct) {
  const hsl = rgbToHsl(hexToRgb(hex));
  hsl.l = Math.min(100, Math.max(0, hsl.l + deltaPct));
  return rgbToHex(hslToRgb(hsl));
}
function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

// "Strong" is the hover/emphasis shade -- darker on a light background,
// lighter on a dark one, since that's whichever direction adds contrast.
function deriveAccentVars(baseHex, isDark) {
  const brand = adjustLightness(baseHex, isDark ? 9 : 0);
  const brandStrong = adjustLightness(baseHex, isDark ? 20 : -10);
  const brandLight = adjustLightness(baseHex, isDark ? 32 : 13);
  const link = adjustLightness(baseHex, isDark ? 40 : 4);
  const focus = adjustLightness(baseHex, isDark ? 44 : 22);
  const onBrand = relativeLuminance(brand) > 0.42 ? '#10171d' : '#ffffff';
  return {
    '--brand': brand,
    '--brand-strong': brandStrong,
    '--brand-light': brandLight,
    '--brand-dim': hexToRgba(baseHex, isDark ? 0.16 : 0.09),
    '--on-brand': onBrand,
    '--link': link,
    '--focus': focus,
  };
}

function readAccent() {
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    return /^#[0-9a-f]{6}$/i.test(v) ? v : null;
  } catch (e) {
    return null;
  }
}

(function () {
  const KEY = 'daily-report-theme';
  const MODES = ['auto', 'light', 'dark'];
  const darkMedia = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');

  function read() {
    try {
      const v = localStorage.getItem(KEY);
      return MODES.indexOf(v) !== -1 ? v : 'auto';
    } catch (e) {
      return 'auto';
    }
  }

  let mode = read();
  let accent = readAccent();
  const listeners = [];

  function effectiveIsDark() {
    return mode === 'dark' || (mode === 'auto' && !!(darkMedia && darkMedia.matches));
  }

  // Inline custom properties beat every selector in style.css (including the
  // dark-mode ones), so this has to track the effective theme itself instead
  // of leaning on the stylesheet's own light/dark switch.
  function applyAccent() {
    const root = document.documentElement;
    if (!accent) {
      ACCENT_VARS.forEach((v) => root.style.removeProperty(v));
      return;
    }
    const vars = deriveAccentVars(accent, effectiveIsDark());
    Object.keys(vars).forEach((k) => root.style.setProperty(k, vars[k]));
  }

  function apply(m) {
    const root = document.documentElement;
    if (m === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', m);
    applyAccent();
  }

  apply(mode);
  if (darkMedia && darkMedia.addEventListener) {
    // Only matters with a custom accent set: the built-in palette already
    // reacts to this via @media in the stylesheet, but our inline overrides
    // don't, so 'auto' mode needs its own nudge when the OS theme flips.
    darkMedia.addEventListener('change', () => { if (mode === 'auto') applyAccent(); });
  }

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

  function setAccent(hex) {
    accent = hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : null;
    try {
      if (accent) localStorage.setItem(ACCENT_KEY, accent);
      else localStorage.removeItem(ACCENT_KEY);
    } catch (e) {
      /* private mode -- accent just won't persist */
    }
    applyAccent();
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
    const img = document.createElement('img');
    img.src = 'settings-icon.png';
    img.alt = '';
    a.appendChild(img);
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

  window.appAccent = {
    get: () => accent, // null means "using the default"
    default: DEFAULT_ACCENT,
    set: setAccent,
    reset: () => setAccent(null),
  };
})();
