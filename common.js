// Small shared helpers used across every page. No page-specific logic here.

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
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

function dateStamp() {
  const n = new Date();
  return n.toISOString().slice(0, 10).replace(/-/g, '');
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
  applyBranding(); // the header logo only shows once installed -- update now, not on next load
});

function isAppInstalled() {
  return (
    appWasInstalledThisSession ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    navigator.standalone === true
  );
}
