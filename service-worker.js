// Caches the app shell + template so it keeps working with no signal in
// the field. Bump CACHE_NAME whenever any of these files change so the new
// version actually gets picked up.
const CACHE_NAME = 'daily-report-app-v9';
const ASSETS = [
  './',
  './index.html',
  './project.html',
  './reports.html',
  './report-editor.html',
  './style.css',
  './common.js',
  './defaults.js',
  './storage.js',
  './excel-export.js',
  './project-file.js',
  './lib/fflate.min.js',
  './lib/xlsx.min.js',
  './template/PR439-Daily-Work-Report-TEMPLATE.xlsx',
  './manifest.json',
  './icon.svg',
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
