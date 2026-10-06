// Caches the app shell so it keeps working with no signal in the field.
// Bump CACHE_NAME whenever any of these files change so the new version
// actually gets picked up.
const CACHE_NAME = 'daily-report-app-v327';
const ASSETS = [
  './',
  './login.html',
  './auth-action.html',
  './index.html',
  './project.html',
  './project-setup.html',
  './reports.html',
  './report-editor.html',
  './report-viewer.html',
  './report-photos.html',
  './download.html',
  './settings.html',
  './company-management.html',
  './audit-log.html',
  './quantity-sheet.html',
  './pay-apps.html',
  './quick-quantity.html',
  './required-fields.html',
  './tutorial.html',
  './print-layout.json',
  './error-codes.txt',
  './patch-notes.txt',
  './render-report.js',
  './pdf-export.js',
  './report-bundle.js',
  './local-sync.js',
  './quantity-sheet-export.js',
  './setup-share.js',
  './style.css',
  './print-sheet.css',
  './theme.js',
  './common.js',
  './defaults.js',
  './storage.js',
  './audit-log.js',
  './tutorial-data.js',
  './tutorial-tour.js',
  './tutorial/inspector-neutral.svg',
  './tutorial/inspector-happy.svg',
  './tutorial/inspector-thinking.svg',
  './tutorial/inspector-surprised.svg',
  './tutorial/inspector-pointing.svg',
  './tutorial/hand.svg',
  './tutorial/dialogue.txt',
  './project-file.js',
  './quantity-calc.js',
  './dashboard-widgets.js',
  './firebase-init.js',
  './firebase-sync.js',
  './lib/xlsx.min.js',
  './lib/exceljs.min.js',
  './lib/jspdf.umd.min.js',
  './lib/html2canvas.min.js',
  './lib/fflate.min.js',
  './lib/heic2any.min.js',
  './manifest.json',
  './icon.svg',
  './apple-touch-icon.png',
  './settings-icon.png',
];

// cache.addAll(ASSETS) would fetch with the browser's default HTTP caching,
// which can silently pull a stale copy out of the ordinary HTTP cache even
// right after bumping CACHE_NAME -- {cache: 'reload'} forces every asset to
// come from the network on install, so a version bump always means a version
// bump.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(ASSETS.map((url) => fetch(url, { cache: 'reload' }).then((res) => cache.put(url, res))))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// The tutorial's dialogue is meant to be edited on its own, so it's fetched
// fresh whenever there's a connection (no version bump needed for a wording
// change), falling back to the cached copy offline.
const NETWORK_FIRST = ['/tutorial/dialogue.txt'];

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'GET' && url.origin === self.location.origin && NETWORK_FIRST.some((p) => url.pathname.endsWith(p))) {
    event.respondWith(
      fetch(event.request.url, { cache: 'no-store' })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./tutorial/dialogue.txt', copy));
          }
          return res;
        })
        .catch(() => caches.match('./tutorial/dialogue.txt'))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
