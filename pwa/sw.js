/* Daily Value service worker: keeps the installed app working offline after the first visit.
   tools/build_site.py fills in the versions, file lists and hashes (the __NAMES__ below). */
'use strict';

const APP_CACHE = 'daily-value-app-__APP_VERSION__';
const DATA_CACHE = 'daily-value-data-__DATA_VERSION__';
const CDN_CACHE = 'daily-value-cdn-v1';
// Every file of this version with the start of its SHA-256. A file is stored only if it matches, so a copy
// from an older or newer version (a stale HTTP or CDN cache right after a publish) never gets mixed in.
const HASHES = __HASHES__;
// The page, scripts and icons, stored at install so the app opens offline.
const APP_FILES = __APP_FILES__;
// Food data stored at install; the brand-name files are stored the first time they're used.
const DATA_FILES = __DATA_FILES__;
// Libraries and fonts from other sites, stored at install: [url, required]. The page loads them before this
// worker is in control, so they'd otherwise be missing offline. Without Preact nothing draws, so it's required.
const CDN_FILES = __CDN_FILES__;
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

class WrongVersion extends Error {}

// Fetch one of this version's files, revalidating any HTTP-cached copy, and check it against HASHES.
async function fetchChecked(path) {
  const res = await fetch(new Request(path, { cache: 'no-cache' }));
  if (!res.ok) throw new Error(path + ': HTTP ' + res.status);
  const want = HASHES[path];
  if (want) {
    const digest = await crypto.subtle.digest('SHA-256', await res.clone().arrayBuffer());
    const got = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    if (!got.startsWith(want)) throw new WrongVersion(path + ' belongs to another version');
  }
  return res;
}

self.addEventListener('install', (event) => {
  // Any failure fails the install; the browser tries again on a later visit and the current version keeps working.
  event.waitUntil(
    (async () => {
      const app = await caches.open(APP_CACHE);
      await Promise.all(APP_FILES.map(async (f) => app.put(f, await fetchChecked(f))));
      // Versioned apart from the app, so app updates don't download the food data again.
      const data = await caches.open(DATA_CACHE);
      for (const f of DATA_FILES) if (!(await data.match(f))) await data.put(f, await fetchChecked(f));
      const cdn = await caches.open(CDN_CACHE);
      for (const [url, required] of CDN_FILES) {
        if (await cdn.match(url, { ignoreVary: true })) continue;
        try {
          const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
          if (res.ok) await cdn.put(url, res);
          else if (required) throw new Error(url + ': HTTP ' + res.status);
        } catch (e) {
          if (required) throw e;
        }
      }
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
    event.respondWith(ownFile(url.href.slice(scope.length).split(/[?#]/)[0], req));
    return;
  }
  if (url.hostname === 'cdn.jsdelivr.net') event.respondWith(pinnedCdnFile(req));
  else if (CDN_HOSTS.includes(url.hostname)) event.respondWith(staleWhileRevalidate(req, event));
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

async function ownFile(path, req) {
  const name = path.startsWith('data/') ? DATA_CACHE : APP_CACHE;
  const cache = await caches.open(name);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  if (!HASHES[path]) return fetch(req); // not part of this version: pass it through, never store it
  try {
    const res = await fetchChecked(path);
    // A full device just means this file isn't stored; the response still goes to the page.
    await cache.put(path, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    if (!(e instanceof WrongVersion)) throw e;
    // The site has a newer version than this worker. Fetch the new worker (the page then offers Reload) and
    // answer with an error, so the app shows "didn't load" rather than mixing data from two versions.
    self.registration.update().catch(() => {});
    return new Response('', { status: 409, statusText: 'A newer version of Daily Value is available' });
  }
}

// jsdelivr URLs name an exact version, so a stored copy never needs replacing.
async function pinnedCdnFile(req) {
  const cache = await caches.open(CDN_CACHE);
  const hit = await cache.match(req.url, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req.url, res.clone()).catch(() => {});
  return res;
}

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(CDN_CACHE);
  const hit = await cache.match(req.url, { ignoreVary: true });
  const update = fetch(req).then((res) => {
    // Only complete, successful responses are kept, so an error page never replaces a working file.
    if (res.ok) cache.put(req.url, res.clone()).catch(() => {});
    return res;
  });
  if (hit) {
    event.waitUntil(update.catch(() => {}));
    return hit;
  }
  return update;
}
