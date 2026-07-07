// FocusAir service worker — a persistent local cache so the map doesn't have to
// be re-fetched and re-rendered every visit. Satellite tiles you've already seen
// load instantly from disk (and work offline); the app's own files are cached too
// so a revisit is fast and the app still opens with no network.
const APP_CACHE = 'focusair-app-v1';
const TILE_CACHE = 'focusair-tiles-v1';
const TILE_HOSTS = ['server.arcgisonline.com', 'tile.openstreetmap.org'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles: cache-first. They never change, so remember them forever — the
  // whole point, so the same ground never has to download twice.
  if (TILE_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        return hit || Response.error();
      }
    })());
    return;
  }

  // The app's own files: network-first (always fresh when online), falling back
  // to the cached copy when offline. Keeps updates instant but the app openable.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(APP_CACHE);
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await cache.match(req);
        return hit || Response.error();
      }
    })());
  }
});
