/*
 * sw.js — offline support for every app in the collection.
 *
 * The shell (launcher, shared stylesheet, registry) is precached on install.
 * Everything else is cached the first time it is used, so an app you have
 * opened once keeps working with no network. That means no generated file
 * list to drift out of date as apps are added — the trade is that an app you
 * have never opened is not available offline.
 *
 * VERSION must match release/VERSION; release/build.sh fails the build if it
 * does not, so a release can never ship a stale cache name.
 */
const VERSION = '1.2.0';
const CACHE = 'apps-v' + VERSION;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/base.css',
  './assets/js/registry.js',
  './assets/js/launcher.js',
  './assets/js/install.js',
  './assets/icons/apps-192.png',
  './assets/icons/apps-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // One miss should not fail the whole install, so add them individually.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name.startsWith('apps-v') && name !== CACHE)
             .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

function putInCache(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return response;
  const copy = response.clone();
  caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages go to the network first so an update is picked up straight away,
  // and fall back to the cached copy when there is nothing to reach.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => putInCache(request, response))
        .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // Everything else: serve the cached copy at once, refresh it in the
  // background for next time.
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((response) => putInCache(request, response))
        .catch(() => hit);
      return hit || network;
    })
  );
});
