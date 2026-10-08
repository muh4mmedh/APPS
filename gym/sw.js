/*
 * sw.js — makes the app work with no signal in the gym.
 *
 * Every file is precached on install, so the first visit is enough. Pages go
 * to the network first so an update shows up straight away; everything else
 * comes from the cache and is refreshed in the background.
 *
 * Bump VERSION whenever FILES changes. tests/store.test.cjs checks every file
 * the app loads is listed here.
 */
const VERSION = '1.0.0';
const CACHE = 'gym-v' + VERSION;

const FILES = [
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/app.css',
  './js/data.js',
  './js/figures.js',
  './js/store.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(FILES.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name.startsWith('gym-v') && name !== CACHE).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

function keep(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return response;
  const copy = response.clone();
  caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => keep(request, response))
        .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request).then((response) => keep(request, response)).catch(() => hit);
      return hit || network;
    })
  );
});
