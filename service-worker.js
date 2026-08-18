// Caches the app shell + template so it keeps working with no signal in
// the field. Bump CACHE_NAME whenever any of these files change so the new
// version actually gets picked up.
const CACHE_NAME = 'daily-report-app-v25';
const ASSETS = [
  './',
  './index.html',
  './project.html',
  './reports.html',
  './report-editor.html',
  './download.html',
  './settings.html',
  './print-layout.json',
  './render-report.js',
  './setup-share.js',
  './style.css',
  './print-sheet.css',
  './theme.js',
  './common.js',
  './defaults.js',
  './storage.js',
  './project-file.js',
  './lib/xlsx.min.js',
  './lib/qrcode.min.js',
  './lib/jspdf.umd.min.js',
  './lib/html2canvas.min.js',
  './template/daily-work-report-template.xlsx',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './settings-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
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
