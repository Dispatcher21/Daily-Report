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

// Deferred to DOMContentLoaded because applyAppIcon lives in storage.js, which
// every page loads after this file.
document.addEventListener('DOMContentLoaded', () => {
  if (typeof applyAppIcon === 'function') applyAppIcon();
});
