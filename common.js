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
