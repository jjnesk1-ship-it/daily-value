/* Daily Value service worker: keeps the installed app working offline after the first visit.
   tools/build_site.py fills in the versions and file lists (the __NAMES__ below). */
'use strict';

const APP_CACHE = 'daily-value-app-__APP_VERSION__';
const DATA_CACHE = 'daily-value-data-__DATA_VERSION__';
const CDN_CACHE = 'daily-value-cdn-v1';
// The page, scripts and icons, stored at install so the app opens offline.
const APP_FILES = __APP_FILES__;
// Food data stored at install; the brand-name files are stored the first time they're used.
const DATA_FILES = __DATA_FILES__;
// Libraries and fonts the page loads from other sites.
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // cache: 'reload' skips the browser's HTTP cache, so a new version never picks up old files.
      const app = await caches.open(APP_CACHE);
      await app.addAll(APP_FILES.map((f) => new Request(f, { cache: 'reload' })));
      // The data cache is versioned apart from the app, so app updates don't download the food data again.
      const data = await caches.open(DATA_CACHE);
      for (const f of DATA_FILES) if (!(await data.match(f))) await data.add(new Request(f, { cache: 'reload' }));
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Every GitHub Pages site on this account shares one origin, so only this app's caches are touched.
      const keep = new Set([APP_CACHE, DATA_CACHE, CDN_CACHE]);
      for (const k of await caches.keys()) if (k.startsWith('daily-value-') && !keep.has(k)) await caches.delete(k);
      await self.clients.claim();
    })()
  );
});

// The page asks for a waiting update to take over when the person taps Reload.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scope = self.registration.scope;
  if (url.origin === self.location.origin) {
    if (!url.href.startsWith(scope)) return;
    if (req.mode === 'navigate') {
      event.respondWith(appShell(req));
      return;
    }
    const path = url.href.slice(scope.length);
    event.respondWith(cacheFirst(path.startsWith('data/') ? DATA_CACHE : APP_CACHE, req));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) event.respondWith(staleWhileRevalidate(req, event));
});

// Every page load gets the stored page, so the page and its scripts always come from the same version.
async function appShell(req) {
  const page = await caches.match(new URL('index.html', self.registration.scope).href, { cacheName: APP_CACHE });
  if (page) return page;
  try {
    return await fetch(req);
  } catch (e) {
    return new Response('Daily Value is offline. Open it once with a connection and it will work offline after that.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function cacheFirst(name, req) {
  const cache = await caches.open(name);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  // A full device just means this file isn't stored; the response still goes to the page.
  if (res.ok) await cache.put(req, res.clone()).catch(() => {});
  return res;
}

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(CDN_CACHE);
  const hit = await cache.match(req);
  const update = fetch(req).then((res) => {
    // Only complete, successful responses are kept, so an error page never replaces a working library.
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  if (hit) {
    event.waitUntil(update.catch(() => {}));
    return hit;
  }
  return update;
}
