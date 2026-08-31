// Caches the app shell so it keeps working with no signal in the field.
// Bump CACHE_NAME whenever any of these files change so the new version
// actually gets picked up.
const CACHE_NAME = 'daily-report-app-v150';
const ASSETS = [
  './',
  './login.html',
  './index.html',
  './project.html',
  './project-setup.html',
  './reports.html',
  './report-editor.html',
  './download.html',
  './settings.html',
  './company-management.html',
  './audit-log.html',
  './quantity-sheet.html',
  './quick-quantity.html',
  './required-fields.html',
  './print-layout.json',
  './error-codes.txt',
  './render-report.js',
  './pdf-export.js',
  './report-bundle.js',
  './setup-share.js',
  './style.css',
  './print-sheet.css',
  './theme.js',
  './common.js',
  './defaults.js',
  './storage.js',
  './audit-log.js',
  './project-file.js',
  './quantity-calc.js',
  './dashboard-widgets.js',
  './firebase-init.js',
  './firebase-sync.js',
  './lib/xlsx.min.js',
  './lib/jspdf.umd.min.js',
  './lib/html2canvas.min.js',
  './lib/fflate.min.js',
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

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
