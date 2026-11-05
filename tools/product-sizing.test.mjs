/* Product visuals are sized for the screen they are on.

   The range carousel's front card, the product tiles and the hero products used to be one size on every
   screen: the card stopped at 340px (9% of a 4K TV's width, a quarter of a tablet's), the tiles and hero
   products were fixed pixel sizes, and the carousel's stage stayed 900px tall on every big screen.

   For each screen this loads the page and checks the front card is a sensible share of the screen, that
   the stage fits it (nothing of the carousel is cut off by the stage), that nothing makes the page scroll
   sideways, and that the tiles and the hero products grow on a big screen and are unchanged on a laptop. */
import pkg from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.mjs';
const { chromium } = pkg;
const PORT = 8214, BASE = 'http://127.0.0.1:' + PORT, API = BASE + '/api';
let bad = 0;
const chk = (l, ok, x) => { if (!ok) bad++; console.log((ok ? '  PASS  ' : '  FAIL  ') + l + (!ok && x !== undefined ? '  -> ' + JSON.stringify(x) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const srv = http.createServer((req, res) => {
  const f = decodeURIComponent(new URL(req.url, BASE).pathname);
  const fp = path.join(ROOT, f === '/' ? 'index.html' : f);
  if (f === '/sw.js' || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' }); res.end(fs.readFileSync(fp));
}).listen(PORT, '127.0.0.1');
const CONFIG = { ok: true, settings: { page_mode: 'open', welcome: 'show', games_off: '', gift_active: 'no', tour_active: 'no' },
  section_states: [], builtin_off: [], documents: [], media: [], segments: [], gift_needs: {} };

const b = await chromium.launch();
async function measure([name, w, h, mobile, dsf]) {
  const c = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: dsf });
  await c.route(u => !u.href.startsWith(BASE), r => r.abort());
  await c.route(API, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(CONFIG) }));
  await c.addInitScript(api => { window.__BOOTH_API = api; }, API);
  const p = await c.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '/', { waitUntil: 'load' }); await sleep(3500);
  const r = await p.evaluate(() => {
    const stage = document.getElementById('shelfStage'), sr = stage.getBoundingClientRect();
    const cards = [...stage.querySelectorAll('.cf-card')].map(e => ({ r: e.getBoundingClientRect(), o: +getComputedStyle(e).opacity })).filter(x => x.o > .3 && x.r.width > 10);
    const front = cards.slice().sort((a, b) => b.r.width - a.r.width)[0];
    const th = document.querySelector('.thumb .art img'), hp = document.querySelector('#heroProducts .hp-visual img');
    return { vw: innerWidth, vh: innerHeight, card: Math.round(front.r.width), stage: Math.round(sr.height),
      clipped: cards.some(x => x.r.top < sr.top - 1 || x.r.bottom > sr.bottom + 1),
      sideways: document.documentElement.scrollWidth > innerWidth + 1,
      thumb: th ? Math.round(th.getBoundingClientRect().height) : 0, hero: hp ? Math.round(hp.getBoundingClientRect().height) : 0 };
  });
  await c.close();
  return { name, errs, ...r, share: r.card / r.vw };
}
const SCREENS = [
  ['phone 360x640', 360, 640, true, 2], ['phone 390x844', 390, 844, true, 2], ['phone 430x932', 430, 932, true, 2],
  ['tablet 820x1180', 820, 1180, true, 2], ['laptop 1366x768', 1366, 768, false, 1], ['desktop 1920x1080', 1920, 1080, false, 1],
  ['QHD 2560x1440', 2560, 1440, false, 1], ['kiosk 1080x1920', 1080, 1920, false, 1], ['TV 3840x2160', 3840, 2160, false, 1] ];
const R = {}; for (const s of SCREENS) R[s[0].split(' ')[0] + s[1]] = await measure(s);
const all = Object.values(R);

for (const m of all) {
  chk(`${m.name}: nothing of the carousel is cut off by its stage, and the page does not scroll sideways`, !m.clipped && !m.sideways, { clipped: m.clipped, sideways: m.sideways, stage: m.stage, card: m.card });
  chk(`${m.name}: no page errors`, m.errs.length === 0, m.errs);
}
for (const k of ['phone360', 'phone390', 'phone430']) chk(`${R[k].name}: the front card fills most of the phone's width (55-68%)`, R[k].share >= .55 && R[k].share <= .68, R[k].share);
chk(`tablet 820: the front card is a good share of the width (36-44%), not a quarter`, R.tablet820.share >= .36 && R.tablet820.share <= .44, R.tablet820.share);
chk(`kiosk 1080x1920: the front card is 36-44% of the width`, R.kiosk1080.share >= .36 && R.kiosk1080.share <= .44, R.kiosk1080.share);
chk(`laptop 1366: unchanged in size (about 24% of the width)`, R.laptop1366.share >= .22 && R.laptop1366.share <= .26 && R.laptop1366.thumb === 292, [R.laptop1366.share, R.laptop1366.thumb]);
chk(`desktop 1920x1080: the card is bigger than the old 340px cap (at least 400px)`, R.desktop1920.card >= 400, R.desktop1920.card);
chk(`QHD 2560x1440: bigger again (at least 520px)`, R.QHD2560.card >= 520, R.QHD2560.card);
chk(`TV 3840x2160: the card is at least 780px (it was 340px, a ninth of the width)`, R.TV3840.card >= 780, R.TV3840.card);
chk(`the card never takes more than 45% of the screen's height`, all.every(m => m.card / m.vh <= .45), all.map(m => [m.name, (m.card / m.vh).toFixed(2)]));
chk(`the stage is cut to the card instead of staying 900px (TV and desktop)`, R.desktop1920.stage < 800 && R.TV3840.stage > 1100, [R.desktop1920.stage, R.TV3840.stage]);
chk(`the product tiles grow with the screen: laptop 292px, desktop larger, TV at least double`, R.desktop1920.thumb > R.laptop1366.thumb && R.TV3840.thumb >= 2 * R.laptop1366.thumb - 10, [R.laptop1366.thumb, R.desktop1920.thumb, R.TV3840.thumb]);
chk(`the hero products grow the same way`, R.desktop1920.hero > R.laptop1366.hero && R.TV3840.hero >= 2 * R.laptop1366.hero - 10, [R.laptop1366.hero, R.desktop1920.hero, R.TV3840.hero]);
chk(`a phone keeps the tiles and hero products as they were`, R.phone390.thumb === 292 && R.phone390.hero >= 215 && R.phone390.hero <= 222, [R.phone390.thumb, R.phone390.hero]);

srv.close(); await b.close();
console.log(bad ? '\n' + bad + ' FAILED' : '\nproduct visuals are sized for every screen');
process.exit(bad ? 1 : 0);
