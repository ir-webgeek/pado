// Shopino service worker: installable app, offline page, and faster repeat visits on slow mobile networks.
// - pages and API calls always go to the network (no stale panels, prices or stock)
// - content-hashed build files (/_next/static) are cached forever: a new build has new file names
// - photos are served from cache and refreshed in the background, capped so the cache stays small
const SHELL = "shopino-shell-v2";
const STATIC = "shopino-static-v1";
const IMAGES = "shopino-img-v1";
const KEEP = [SHELL, STATIC, IMAGES];
const IMAGE_LIMIT = 200;
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;
const SHELL_FILES = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// only same-origin, complete responses are stored (opaque cross-origin ones would eat the storage quota)
const storable = (res) => res && res.ok && res.type === "basic";

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(k);
}

async function cacheFirst(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (storable(res)) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then((res) => {
      if (storable(res)) cache.put(event.request, res.clone()).then(() => trim(IMAGES, IMAGE_LIMIT));
      return res;
    })
    .catch(() => hit);
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  return refresh;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // dev servers reuse file names between edits; only production builds are content-hashed
  if (url.pathname.startsWith("/_next/static/") && !LOCAL.test(self.location.hostname)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (req.destination === "image" && !url.pathname.startsWith("/api/")) {
    event.respondWith(staleWhileRevalidate(event));
  }
});
