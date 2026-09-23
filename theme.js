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

  // Global search -- a magnifying glass alongside the sync/gear cluster
  // that expands in place to cover them (rather than navigating to a
  // separate page), searching every report on every project this login
  // can see -- projectInScope is the exact same access boundary index.html
  // and project.html already enforce, so search never surfaces anything
  // this device couldn't already open directly. Matches on date, person
  // (representative/creator/editor), free text (Activity/Notes/Work
  // Summary), report number, and pay item number/description, and groups
  // results by project, then by date within each.
  //
  // Lives here rather than its own file so every page gets it for free the
  // same way the sync/gear cluster already does -- see mountHeaderControls
  // below, which is the only caller.
  function buildSearchControl(header, controls) {
    if (typeof getAllReports !== 'function' || typeof getAllProjects !== 'function') return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'header-search-btn';
    btn.title = 'Search reports';
    btn.setAttribute('aria-label', 'Search reports');
    btn.innerHTML = '&#128269;';

    const box = document.createElement('div');
    box.className = 'header-search-box';
    box.hidden = true;
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Search reports…';
    input.setAttribute('aria-label', 'Search reports');
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'header-search-close';
    closeBtn.setAttribute('aria-label', 'Close search');
    closeBtn.innerHTML = '&times;';
    box.appendChild(input);
    box.appendChild(closeBtn);

    const panel = document.createElement('div');
    panel.className = 'global-search-panel';
    panel.hidden = true;
    document.body.appendChild(panel);

    // Built once per page load, the first time search is actually opened --
    // not worth the IndexedDB round-trip on every page just in case someone
    // searches. Simple substring matching, not an index: nothing here runs
    // often enough (a few hundred/thousand reports, typed by a person, not
    // a hot loop) to earn the complexity of a real search index.
    let cache = null;
    let searchTimer = null;

    async function ensureCache() {
      if (cache) return cache;
      const room = typeof getCompanyRoom === 'function' ? await getCompanyRoom().catch(() => null) : null;
      const [allProjects, allReports] = await Promise.all([getAllProjects(), getAllReports()]);
      const projects = new Map(
        allProjects
          .filter((p) => (typeof projectInScope === 'function' ? projectInScope(p, room) : true))
          .map((p) => [p.id, p])
      );
      const reports = allReports.filter((r) => projects.has(r.projectId));
      cache = { projects, reports };
      return cache;
    }

    function fmtDateShort(iso) {
      if (!iso) return '';
      const parts = iso.split('-');
      return parts.length === 3 ? `${parts[1]}/${parts[2]}/${parts[0]}` : iso;
    }

    function reportMatches(r, q) {
      if (r.date && (r.date.includes(q) || fmtDateShort(r.date).includes(q))) return true;
      if (String(r.reportNo ?? '').includes(q)) return true;
      const person = `${r.representative || ''} ${r.createdBy || ''} ${r.lastEditedBy || ''}`.toLowerCase();
      if (person.includes(q)) return true;
      const text = `${r.activity || ''} ${r.notes || ''} ${r.workSummary || ''}`.toLowerCase();
      if (text.includes(q)) return true;
      return (r.payItems || []).some(
        (it) => String(it.itemNumber || '').toLowerCase().includes(q) || String(it.description || '').toLowerCase().includes(q)
      );
    }

    const MAX_RESULTS = 60; // a wide, early query (e.g. a single letter) shouldn't render an unbounded DOM

    async function runSearch(query) {
      const q = query.trim().toLowerCase();
      if (!q) {
        panel.hidden = true;
        panel.innerHTML = '';
        return;
      }
      const { projects, reports } = await ensureCache();
      const matched = reports.filter((r) => reportMatches(r, q));
      if (matched.length === 0) {
        panel.innerHTML = `<div class="gsp-empty">No reports match &ldquo;${escapeHtml(query.trim())}&rdquo;.</div>`;
        panel.hidden = false;
        return;
      }
      const byProject = new Map();
      matched.forEach((r) => {
        if (!byProject.has(r.projectId)) byProject.set(r.projectId, []);
        byProject.get(r.projectId).push(r);
      });
      const projectIds = Array.from(byProject.keys()).sort((a, b) => {
        const pa = projects.get(a), pb = projects.get(b);
        return (pa ? pa.name : '').localeCompare(pb ? pb.name : '');
      });

      let shown = 0;
      let html = '';
      outer:
      for (const pid of projectIds) {
        const project = projects.get(pid);
        const rows = byProject.get(pid).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        html += `<div class="gsp-group"><div class="gsp-group-title">${escapeHtml(project ? project.name : 'Unknown project')}</div>`;
        for (const r of rows) {
          if (shown >= MAX_RESULTS) break outer;
          shown++;
          const snippet = (r.activity || r.workSummary || r.notes || '').trim();
          html += `
            <a class="gsp-row" href="report-editor.html?project=${pid}&report=${r.id}">
              <span class="gsp-row-date">${escapeHtml(r.date || '(no date)')}</span>
              <span class="gsp-row-main">
                <span class="gsp-row-no">#${escapeHtml(String(r.reportNo ?? ''))}</span>
                ${snippet ? `<span class="gsp-row-snippet">${escapeHtml(snippet)}</span>` : ''}
              </span>
              ${r.representative ? `<span class="gsp-row-person">${escapeHtml(r.representative)}</span>` : ''}
            </a>`;
        }
        html += `</div>`;
      }
      if (matched.length > shown) {
        const rest = matched.length - shown;
        html += `<div class="gsp-more">${rest} more match${rest === 1 ? '' : 'es'} — refine your search to narrow it down.</div>`;
      }
      panel.innerHTML = html;
      panel.hidden = false;
    }

    // The panel is fixed to the viewport (so it can overlay page content
    // below the header rather than pushing it down), positioned off the
    // header's own live bounding rect rather than a hardcoded height --
    // .app-header is position:sticky, so this stays correct whether the
    // page is scrolled to the top or not.
    function positionPanel() {
      panel.style.top = `${header.getBoundingClientRect().bottom}px`;
    }

    function onKeydown(e) {
      if (e.key === 'Escape') closeSearch();
    }
    function onDocClick(e) {
      if (box.contains(e.target) || panel.contains(e.target) || btn.contains(e.target)) return;
      closeSearch();
    }

    function openSearch() {
      controls.classList.add('search-open');
      header.classList.add('search-active');
      box.hidden = false;
      positionPanel();
      input.value = '';
      input.focus();
      document.addEventListener('keydown', onKeydown);
      document.addEventListener('click', onDocClick, true);
    }

    function closeSearch() {
      controls.classList.remove('search-open');
      header.classList.remove('search-active');
      box.hidden = true;
      panel.hidden = true;
      panel.innerHTML = '';
      input.value = '';
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('click', onDocClick, true);
    }

    btn.addEventListener('click', () => {
      if (controls.classList.contains('search-open')) closeSearch();
      else openSearch();
    });
    closeBtn.addEventListener('click', closeSearch);
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runSearch(input.value), 200);
    });
    window.addEventListener('resize', () => { if (!panel.hidden) positionPanel(); });

    controls.appendChild(btn);
    controls.appendChild(box);
  }

  // Every page gets the same header-right cluster: a search button, a
  // sync button (shown everywhere now, not just when connected to a
  // company -- see below), and a settings gear (every page except
  // Settings itself, which is where the gear would just link to).
  // Replaces what used to be four separate, differently-behaved
  // refresh/sync buttons scattered across Home, Reports, Settings, and
  // Company Management -- one control, same place, on every page.
  //
  // Run from DOMContentLoaded (same as before), which is late enough that
  // firebase-sync.js and common.js -- both plain synchronous scripts
  // lower in the body -- have already executed and defined the globals
  // this needs, on every page that includes them (all of them).
  async function mountHeaderControls() {
    const header = document.querySelector('.app-header');
    if (!header || header.querySelector('.header-controls')) return;
    const slot = header.querySelector(':scope > span:empty');
    const isSettingsPage = /settings\.html$/i.test(location.pathname);

    const controls = document.createElement('div');
    controls.className = 'header-controls';

    buildSearchControl(header, controls);

    // Company sync AND checking for a newer version of the app itself --
    // one button, since both are "make sure I have the latest of
    // everything" in the user's head, and neither one is worth its own
    // separate icon competing for the same corner of the header. Shown on
    // every device, company or not: a local-only device has nothing to
    // pull/push, but still benefits from a way to force an update check
    // rather than wait on the browser's own periodic one.
    const room = typeof getCompanyRoom === 'function' ? await getCompanyRoom().catch(() => null) : null;
    const syncBtn = document.createElement('button');
    syncBtn.type = 'button';
    syncBtn.className = 'header-sync-btn';
    syncBtn.title = room ? 'Sync with company & check for updates' : 'Check for app updates';
    syncBtn.setAttribute('aria-label', syncBtn.title);
    syncBtn.innerHTML = '&#8635;';
    syncBtn.addEventListener('click', async () => {
      if (syncBtn.classList.contains('spinning')) return; // already running
      syncBtn.classList.add('spinning');
      syncBtn.disabled = true;
      try {
        if (room) {
          await syncCompanyRoomNow();
          // Pages that care already listen for this (see index.html/
          // project.html/reports.html) and re-render themselves; a page
          // that doesn't just shows the fresh data next time it loads,
          // same as it would have before this button existed.
          window.dispatchEvent(new CustomEvent('company-data-pulled'));

          // If the page currently open is scoped to a project (project.html's
          // ?id=, everywhere else's ?project=) and that project is linked to
          // a local folder, ride a full folder resync along with the
          // company pull -- local-sync.js isn't loaded on every page, and
          // syncCurrentProjectToFolderIfLinked itself no-ops when nothing's
          // linked, so this is a harmless no-op almost everywhere it runs.
          // Its own failure doesn't turn a successful company sync into an
          // error -- same reasoning as the per-report auto-sync never
          // surfacing a folder problem beyond the cloud icon.
          if (typeof syncCurrentProjectToFolderIfLinked === 'function' && typeof queryParam === 'function') {
            const projectId = queryParam('id') || queryParam('project');
            await syncCurrentProjectToFolderIfLinked(projectId).catch((err) => console.error('header folder sync:', err));
            // Fires after the folder resync above actually finishes writing,
            // unlike company-data-pulled (already dispatched by now) which
            // reports.html/project.html would otherwise use to refresh their
            // synced/pending counts too early -- reading the old state and
            // leaving a stale "N reports haven't synced" banner up.
            window.dispatchEvent(new CustomEvent('folder-sync-completed'));
          }
        }

        // Forces the browser to re-fetch service-worker.js right now instead
        // of waiting on its own periodic check (which can sit for hours on a
        // tab/installed app that's rarely fully closed and reopened). The
        // service worker calls skipWaiting()/clients.claim() on activate
        // (see service-worker.js), so a real update installs and takes over
        // immediately -- common.js's own controllerchange listener is what
        // actually prompts to reload once that happens, not this handler.
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.getRegistration();
          if (registration) await registration.update();
        }
      } catch (err) {
        console.error('header sync:', err);
        alert(
          typeof userError === 'function'
            ? userError("Couldn't sync: " + err.message, 'HEADER_SYNC')
            : "Couldn't sync: " + err.message
        );
      } finally {
        syncBtn.classList.remove('spinning');
        syncBtn.disabled = false;
      }
    });
    controls.appendChild(syncBtn);

    if (!isSettingsPage) {
      const a = document.createElement('a');
      a.className = 'header-gear';
      a.href = 'settings.html';
      a.setAttribute('aria-label', 'Settings');
      a.title = 'Settings';
      const img = document.createElement('img');
      img.src = 'settings-icon.png';
      img.alt = '';
      a.appendChild(img);
      controls.appendChild(a);
    }

    if (!controls.children.length) return; // buildSearchControl always adds one, so this shouldn't happen, but skip cleanly if it ever does
    if (slot) slot.replaceWith(controls);
    else header.appendChild(controls);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountHeaderControls);
  } else {
    mountHeaderControls();
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

  // ---------- Company theme ----------
  //
  // A company theme (see firebase-sync.js's theme sync / storage.js's
  // companyThemes store) is a named preset for the SAME accent mechanism
  // above, plus -- index.html only -- a background and a decorative decal
  // image. Picking one just calls setAccent under the hood, so every
  // derivation this file already does keeps working unchanged; this only
  // adds remembering WHICH theme, so index.html knows what background/
  // decal to render and Settings can highlight the current pick. The
  // theme's solid-color fields are cached in localStorage the same way the
  // accent hex is (not its images, which are async blobs and belong in
  // IndexedDB, fetched lazily by index.html) so a solid-background theme
  // still applies before first paint -- only an image background/decal can
  // flash in, same as any other synced photo elsewhere in the app.
  const COMPANY_THEME_KEY = 'daily-report-company-theme';

  function readCompanyTheme() {
    try {
      const raw = localStorage.getItem(COMPANY_THEME_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      return v && v.id ? v : null;
    } catch (e) {
      return null;
    }
  }

  let companyTheme = readCompanyTheme();

  window.appCompanyTheme = {
    get: () => companyTheme, // full metadata record, or null for "no company theme selected"
    set: (theme) => {
      companyTheme = theme && theme.id ? theme : null;
      try {
        if (companyTheme) localStorage.setItem(COMPANY_THEME_KEY, JSON.stringify(companyTheme));
        else localStorage.removeItem(COMPANY_THEME_KEY);
      } catch (e) {
        /* private mode -- selection just won't persist */
      }
      if (companyTheme && companyTheme.accent) setAccent(companyTheme.accent);
    },
    reset: () => window.appCompanyTheme.set(null),
  };
})();
