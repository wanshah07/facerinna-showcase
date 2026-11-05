/* Product visuals are sized for the screen they are on.

   The range carousel's front card, the product tiles and the hero products used to be one size on every
   screen: the card stopped at 340px (9% of a 4K TV's width, a quarter of a tablet's), the tiles and hero
   products were fixed pixel sizes, and the carousel's stage stayed 900px tall on every big screen.

   The cards are meant to read like a shop shelf (a small card, about 225px wide with a picture about 220px
   tall on a laptop), not a poster, and to grow only a little for a big screen.

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
for (const k of ['phone360', 'phone390', 'phone430']) chk(`${R[k].name}: the front card is about half the phone's width (46-56%)`, R[k].share >= .46 && R[k].share <= .56, R[k].share);
chk(`tablet 820: the front card is a modest share of the width (26-34%)`, R.tablet820.share >= .26 && R.tablet820.share <= .34, R.tablet820.share);
chk(`kiosk 1080x1920: the front card is 24-32% of the width`, R.kiosk1080.share >= .24 && R.kiosk1080.share <= .32, R.kiosk1080.share);
chk(`laptop 1366: a small card, about the size it always was (230-290px), the picture about 220px`, R.laptop1366.card >= 230 && R.laptop1366.card <= 290 && R.laptop1366.thumb >= 215 && R.laptop1366.thumb <= 225, [R.laptop1366.card, R.laptop1366.thumb]);
chk(`desktop 1920x1080: a little bigger (290-380px), not a poster`, R.desktop1920.card >= 290 && R.desktop1920.card <= 380, R.desktop1920.card);
chk(`QHD 2560x1440: 320-460px`, R.QHD2560.card >= 320 && R.QHD2560.card <= 460, R.QHD2560.card);
chk(`TV 3840x2160: bigger than a laptop's but still a card (400-560px; it was 340)`, R.TV3840.card >= 400 && R.TV3840.card <= 560, R.TV3840.card);
chk(`no screen's card takes more than 36% of its height, or more than 52% of its width`, all.every(m => m.card / m.vh <= .36 && m.share <= .52), all.map(m => [m.name, (m.card / m.vh).toFixed(2), m.share.toFixed(2)]));
chk(`the stage is cut to the card (card x 1.45 + 80px), not a fixed 900px`, all.every(m => Math.abs(m.stage - Math.round(m.card * 1.45 + 80)) <= 3), all.map(m => [m.name, m.stage, m.card]));
chk(`the product tiles are about 220px tall on a laptop and phone, and grow on a big screen (TV at least 1.4 times)`, R.laptop1366.thumb >= 215 && R.laptop1366.thumb <= 225 && R.phone390.thumb === R.laptop1366.thumb && R.desktop1920.thumb > R.laptop1366.thumb && R.TV3840.thumb >= 1.4 * R.laptop1366.thumb, [R.phone390.thumb, R.laptop1366.thumb, R.desktop1920.thumb, R.TV3840.thumb]);
chk(`the hero products grow the same way (laptop and phone as they were, TV at least 1.4 times)`, R.laptop1366.hero >= 215 && R.laptop1366.hero <= 222 && R.desktop1920.hero > R.laptop1366.hero && R.TV3840.hero >= 1.4 * R.laptop1366.hero, [R.laptop1366.hero, R.desktop1920.hero, R.TV3840.hero]);

srv.close(); await b.close();
console.log(bad ? '\n' + bad + ' FAILED' : '\nproduct visuals are sized for every screen');
process.exit(bad ? 1 : 0);
