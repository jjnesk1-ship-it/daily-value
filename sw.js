/* Daily Value service worker: keeps the installed app working offline after the first visit.
   tools/build_site.py fills in the versions, file lists and hashes (the __NAMES__ below). */
'use strict';

const APP_CACHE = 'daily-value-app-939ff13a76d8';
const DATA_CACHE = 'daily-value-data-04e64e706386';
const CDN_CACHE = 'daily-value-cdn-v1';
// Every file of this version with the start of its SHA-256. A file is stored only if it matches, so a copy
// from an older or newer version (a stale HTTP or CDN cache right after a publish) never gets mixed in.
const HASHES = {"index.html":"a6b80d7065abc594","manifest.webmanifest":"de1506183bc0f530","js/account.js":"c4e9d0dff4a3749b","js/ai.js":"7231fbfc5a1ba696","js/app.js":"0c12a864b78caacd","js/branded.js":"71563ac816251413","js/config.js":"a862e8a127b4d14b","js/core.js":"19d58cb9e9adbd01","js/fooddb.js":"df333b4ab9b9b19d","js/pwa.js":"d73da261d059aec3","js/store.js":"76f2c324aaa9f8dd","js/ui.js":"cdead33993686fda","icons/apple-touch-icon.png":"3fe7e65cb0fae6a9","icons/icon-192.png":"80cb2767f99b0ab9","icons/icon-512.png":"e6027fadecd9eda5","icons/maskable-512.png":"587f46b5f0c98579","data/b/brands.txt":"8084207167e79f23","data/b/i0.txt":"0c0b50777ab570f5","data/b/i1.txt":"15dc3e74ce107991","data/b/i2.txt":"5c35d9e1f2309e2c","data/b/i3.txt":"339e7e545f58565e","data/b/i4.txt":"1318d58ee8f16377","data/b/i5.txt":"7d658ed267a92733","data/b/i6.txt":"0b97f95271613111","data/b/i7.txt":"12e84e64429de589","data/b/meta.json":"a39fb703f0797e7c","data/b/r000.txt":"622be27e75595477","data/b/r001.txt":"07c5dfd808d3a2ef","data/b/r002.txt":"29c9a92850e4e64e","data/b/r003.txt":"32cf5dfa7045ea72","data/b/r004.txt":"840a070015b51981","data/b/r005.txt":"01da48ba860ac1b3","data/b/r006.txt":"c0652d14855b27eb","data/b/r007.txt":"574558d887b1a357","data/b/r008.txt":"6575c5d6a09fa90a","data/b/r009.txt":"5c6b6b7b8c1260a4","data/b/r010.txt":"25a93c16afe8495c","data/b/r011.txt":"22d7c33768ea7d87","data/b/r012.txt":"f1a815c01984013c","data/b/r013.txt":"080743cbade1799c","data/b/r014.txt":"d343543505d73d98","data/b/r015.txt":"34d452c2b2e78480","data/b/r016.txt":"f6e59243cdd5d5ac","data/b/r017.txt":"06d05ad173642316","data/b/r018.txt":"fb3067d426f3e293","data/b/r019.txt":"bb79aa3b74dfa93a","data/b/r020.txt":"2eaf33e4ced25a9c","data/b/r021.txt":"7c9f2526c9733869","data/b/r022.txt":"a32559f2317a32fe","data/b/r023.txt":"d8c70018a4f1fa98","data/b/r024.txt":"8534af0ee2befba8","data/b/r025.txt":"97017d05352243dc","data/b/r026.txt":"f4d772e332cbc732","data/b/r027.txt":"80397b60c881da5a","data/b/r028.txt":"c3300c8c3e7378ad","data/b/r029.txt":"225e8acfaac3539c","data/b/r030.txt":"cef41d2c2a9436b8","data/b/r031.txt":"460a8d69bf17ba61","data/b/r032.txt":"fd42f3d4738c24ba","data/b/r033.txt":"be31062fcff3a167","data/b/r034.txt":"44e96496a72e60d4","data/b/r035.txt":"0806eb3b3c292101","data/b/r036.txt":"6ec2f3a7fe4914aa","data/b/r037.txt":"9e4f6d5e1b2ffe39","data/b/r038.txt":"e3731289f1408c68","data/b/r039.txt":"4a8e9e625bd7c6a6","data/b/r040.txt":"11ea5babb68b96ab","data/b/r041.txt":"8f628e72038977b3","data/b/r042.txt":"170bb2033c60031d","data/b/r043.txt":"11b02371ed3eec3b","data/b/r044.txt":"56362595d8d98c82","data/b/r045.txt":"b97957f63cd82eb7","data/b/r046.txt":"a0ba211dee9c3a37","data/b/r047.txt":"ce92806fd7fc2575","data/b/r048.txt":"9f78d5d348d5c4a8","data/b/r049.txt":"9f2a3c857b940ddb","data/b/r050.txt":"010e4136cb981240","data/b/r051.txt":"145c9d4dff2a3943","data/b/r052.txt":"691bf31c195c5914","data/b/r053.txt":"f45b60f4a09251de","data/b/r054.txt":"166db1e3526df815","data/b/r055.txt":"34a8731d41b819cd","data/b/r056.txt":"7109774f4dede363","data/b/r057.txt":"291a79d51d6c1676","data/b/r058.txt":"c82bf54fe448f4a0","data/b/r059.txt":"66fd442d69f29d00","data/b/r060.txt":"5922094c01248f92","data/b/r061.txt":"37dc61152fe42350","data/b/r062.txt":"b6ca4445b21293f2","data/b/r063.txt":"556c8ed9687d5a6e","data/b/r064.txt":"3522ed8c3ee88169","data/b/r065.txt":"618ace7393848a8a","data/b/r066.txt":"b3eff79230f186c1","data/b/r067.txt":"cde2c830cfc8997d","data/b/r068.txt":"94e4179946897bd4","data/b/r069.txt":"84c85920c9837925","data/b/r070.txt":"eef1a813382f141c","data/b/r071.txt":"a919583484e38802","data/b/r072.txt":"f6972d25b75e86cf","data/b/r073.txt":"259aa850a87766db","data/b/r074.txt":"e2fb10e72f3ebeba","data/b/r075.txt":"777803fb8b5ef238","data/b/r076.txt":"e54f4624c19ba9e4","data/b/r077.txt":"b935b01dfd93ae41","data/b/r078.txt":"b986d5b3cbde6a1e","data/b/r079.txt":"f4273b502a866a6c","data/b/r080.txt":"23e04f4fe6b89e4c","data/b/r081.txt":"196fbc76333e26bb","data/b/r082.txt":"365391f4f6497b17","data/b/r083.txt":"72c165b71b026169","data/b/r084.txt":"37e6693ba2bfb79f","data/b/r085.txt":"59d53f0ac5e09daf","data/b/r086.txt":"9a9e7ad8852c13b3","data/b/r087.txt":"437c64188a3f27d9","data/b/r088.txt":"399f1ff035afa4d7","data/b/r089.txt":"0e7e29070896e948","data/b/r090.txt":"b4a59a4b38d93203","data/b/r091.txt":"c1133bf09800d041","data/b/r092.txt":"4e29e0463d494496","data/b/r093.txt":"7f10d5b37f82a59c","data/b/u0.txt":"be8b450641c2bab5","data/b/u1.txt":"8b93605377dffaae","data/b/u2.txt":"58664b582271443d","data/b/u3.txt":"d699e8e58b3effea","data/b/u4.txt":"926004a2d5b73c6e","data/b/u5.txt":"215338bb1f7086ec","data/b/u6.txt":"211f6e9780f2eacf","data/b/u7.txt":"ffdf969b695798c9","data/b/u8.txt":"7264157389a16ab2","data/b/u9.txt":"73538644b6c454bf","data/foods.txt":"acab90610be201c2"};
// The page, scripts and icons, stored at install so the app opens offline.
const APP_FILES = ["index.html", "manifest.webmanifest", "js/account.js", "js/ai.js", "js/app.js", "js/branded.js", "js/config.js", "js/core.js", "js/fooddb.js", "js/pwa.js", "js/store.js", "js/ui.js", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png"];
// Food data stored at install; the brand-name files are stored the first time they're used.
const DATA_FILES = ["data/foods.txt", "data/b/meta.json"];
// Libraries and fonts from other sites, stored at install: [url, required]. The page loads them before this
// worker is in control, so they'd otherwise be missing offline. Without Preact nothing draws, so it's required.
const CDN_FILES = [["https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.umd.js", true], ["https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@500;600;700;800;900&family=Public+Sans:wght@400;500;600;700;800&display=swap", false], ["https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js", false]];
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
