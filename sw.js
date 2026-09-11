/* Offline for the booth.
 *
 * The hall's wifi is the thing most likely to fail on the day, and every one
 * of these pages is a single self-contained file with its images already
 * inlined -- so once a phone has one, it needs nothing further to show it.
 * Without a service worker that counts for nothing: a page with no network is
 * a browser error screen, however self-contained the file behind it is.
 *
 * VERSION is the cache name. Bump it to throw away everything already stored;
 * day to day you should not need to, because every hit is revalidated in the
 * background and the next load carries the update.
 */
const VERSION = 'facerinna-2026-09-11';

/* The pages somebody at the booth might actually open. The large PDFs and the
   14MB original hero are deliberately absent: they would treble the download
   for something almost nobody opens, and they are cached anyway the first time
   one is. */
const CORE = [
  './',
  './index.html',
  './deep-lab.html',
  './lab-run.html',
  './match-lab.html',
  './pack-match.html',
  './shelf-shot.html',
  './fx-rank.js',
  './events/index.html',
  './facerinna-test-reports-claims/index.html',
  './facerinna-efficacy-benchmark/index.html',
  './hero-banner.jpg',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    /* One at a time, each allowed to fail. cache.addAll() is all-or-nothing:
       a single renamed file would leave the whole worker uninstalled, and the
       site no more offline than before with nothing to say why. */
    await Promise.all(CORE.map(u =>
      c.add(new Request(u, {cache: 'reload'})).catch(err =>
        console.warn('[sw] not cached:', u, err.message))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;

  /* Only ever GETs from this site. The vault and the scoreboard POST to Apps
     Script for live data; a stored answer there would be a stale token check
     or yesterday's leaderboard, so those go straight to the network as though
     this worker did not exist. */
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, {ignoreSearch: true});

    /* Refresh in the background whether or not we had a hit, so a page served
       from cache is still the current one next time it is opened. */
    const fresh = fetch(req).then(res => {
      if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    if (hit) return hit;
    const res = await fresh;
    if (res) return res;

    /* Nothing stored and nothing reachable. Say so, rather than hand back the
       home page -- that would answer a request for one page with a different
       one, and the visitor would think they had mistyped. Nor the browser's
       own error, which gives no hint that the rest of the site is sitting in
       the cache and would have opened. */
    if (req.mode === 'navigate') {
      return new Response(
        '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">' +
        '<style>body{font:16px/1.6 system-ui,sans-serif;margin:0;display:grid;place-items:center;' +
        'min-height:100vh;padding:24px;text-align:center;color:#1a2f4a;background:#f2f8fd}</style>' +
        '<div><h1 style="font-size:20px">No connection</h1>' +
        '<p>This page has not been opened on this phone before, so there is ' +
        'nothing saved to show. Try again once you have a signal.</p></div>',
        {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8'}});
    }
    return Response.error();
  })());
});
