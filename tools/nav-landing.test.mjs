/* A header link lands on its own segment, accurately, on every kind of screen.

   The cause of the bug this guards: fx-ui-polish.js put its own click handler on every "#" link. It called
   the smooth-scroll library to jump to the segment, measured the page once, and took the click before the
   page's own landing code, which re-measures and corrects while the page settles. On wide desktops the
   layout shifts while the page scrolls, so a header link landed about half a screen past the segment.

   For each screen this taps the visible header links the way a visitor does (opening the burger on a phone,
   tapping the folded header pill on a desktop), in two orders, and checks that the segment is at the top
   under the header and that the page is still there a few seconds later. The link to the hidden segment
   (Talk) must not be on screen at all. The page is the local file; the booth settings are a stub. */
import pkg from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.mjs';
const { chromium } = pkg;
const PORT = 8213, BASE = 'http://127.0.0.1:' + PORT, API = BASE + '/api';
let bad = 0;
const chk = (l, ok, x) => { if (!ok) bad++; console.log((ok ? '  PASS  ' : '  FAIL  ') + l + (!ok && x !== undefined ? '  -> ' + JSON.stringify(x) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const f = decodeURIComponent(new URL(req.url, BASE).pathname);
  const fp = path.join(ROOT, f === '/' ? 'index.html' : f);
  if (f === '/sw.js' || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' }); res.end(fs.readFileSync(fp));
}).listen(PORT, '127.0.0.1');

const CONFIG = {
  ok: true, settings: { page_mode: 'open', welcome: 'show', games_off: '', gift_active: 'no', tour_active: 'no' },
  section_states: [{ id: 'talk', label: "Dr. Peter's Talk", mode: 'hidden', message: '' }],
  builtin_off: ['builtin-qr-whatsapp', 'builtin-poster-session-talk'], documents: [], media: [], segments: [], gift_needs: {}
};
const shuffle = (a, s) => { a = a.slice(); let x = s; for (let i = a.length - 1; i > 0; i--) { x = (x * 9301 + 49297) % 233280; const j = Math.floor(x / 233280 * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const b = await chromium.launch();
async function screen([name, w, h, mobile, dsf, orders]) {
  const c = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: dsf });
  await c.route(u => !u.href.startsWith(BASE), r => r.abort());
  await c.route(API, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(CONFIG) }));
  await c.addInitScript(api => { window.__BOOTH_API = api; }, API);
  const p = await c.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '/', { waitUntil: 'load' }); await sleep(3500);
  const links = await p.evaluate(() => [...document.querySelectorAll('#navLinks a[href^="#"]')].map(a => a.getAttribute('href')).filter((h, i, arr) => h.length > 1 && h !== '#top' && arr.indexOf(h) === i));

  async function reveal() {
    const st = await p.evaluate(() => ({
      burger: (() => { const e = document.getElementById('burger'); return !!e && e.offsetParent !== null && getComputedStyle(e).display !== 'none'; })(),
      open: document.getElementById('navLinks').classList.contains('open'), collapsed: document.body.classList.contains('nav-collapsed') }));
    if (st.collapsed) {
      for (let i = 0; i < 20; i++) { const w = await p.evaluate(() => Math.round(document.getElementById('navIn').getBoundingClientRect().width)); if (w <= 60) break; await sleep(150); }
      await sleep(500);
      for (let k = 0; k < 2; k++) {
        const bb = await p.evaluate(() => { const r = document.getElementById('navIn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        await p.mouse.click(bb.x, bb.y); await sleep(900);
        if (!(await p.evaluate(() => document.body.classList.contains('nav-collapsed')))) break;
      }
    }
    const st2 = await p.evaluate(() => ({ burger: (() => { const e = document.getElementById('burger'); return !!e && e.offsetParent !== null && getComputedStyle(e).display !== 'none'; })(), open: document.getElementById('navLinks').classList.contains('open') }));
    if (st2.burger && !st2.open) { await p.click('#burger'); await sleep(400); }
  }
  async function tap(href) {
    await reveal();
    const shown = await p.evaluate(h => { const a = document.querySelector('#navLinks a[href="' + h + '"]'); if (!a) return false; const r = a.getBoundingClientRect(); return getComputedStyle(a).display !== 'none' && r.width > 0; }, href);
    if (!shown) return { href, state: 'not shown' };
    await (mobile ? p.tap('#navLinks a[href="' + href + '"]') : p.click('#navLinks a[href="' + href + '"]'));
    const read = () => p.evaluate(h => { const el = document.querySelector(h), r = el.getBoundingClientRect();
      const secs = [...document.querySelectorAll('section[id]')].filter(s => s.offsetHeight > 0), prev = secs[secs.indexOf(el) - 1];
      return { top: Math.round(r.top), prevBottom: prev ? Math.round(prev.getBoundingClientRect().bottom) : null, y: Math.round(scrollY),
               atEnd: scrollY >= document.documentElement.scrollHeight - innerHeight - 3 }; }, href);
    await sleep(2600); const a = await read(); await sleep(1800); const z = await read();
    const here = (z.top >= -6 && z.top <= 92) || (z.atEnd && z.top > 0 && z.top < h);    /* the last segment cannot scroll further than the page end */
    const ok = here && (z.prevBottom === null || z.prevBottom <= 96 || z.atEnd) && Math.abs(z.y - a.y) <= 2;
    return { href, state: ok ? 'ok' : 'WRONG', z };
  }
  const results = [];
  for (const o of orders) {
    await p.evaluate(() => scrollTo(0, 0)); await sleep(700);
    for (const l of (o === 'down' ? links : shuffle(links, o === 'shuf1' ? 7 : 31))) results.push({ o, ...(await tap(l)) });
  }
  const wrong = results.filter(r => r.state === 'WRONG'), missing = results.filter(r => r.state === 'not shown');
  chk(name + ': ' + links.length + ' header links, ' + results.length + ' taps, every one lands on its own segment', results.length > 0 && wrong.length === 0, wrong.slice(0, 3));
  chk(name + ': every link but the hidden segment\'s was on screen to tap', missing.every(m => m.href === '#talk') && results.some(r => r.state === 'ok'), missing.map(m => m.href));
  chk(name + ': the link to the hidden segment (Talk) is not on screen', links.includes('#talk') && missing.some(m => m.href === '#talk') && !results.some(r => r.href === '#talk' && r.state !== 'not shown'), missing.map(m => m.href));
  chk(name + ': no page errors', errs.length === 0, errs);
  await c.close();
}

const SCREENS = [
  ['desktop 1920x1080', 1920, 1080, false, 1, ['down', 'shuf1']],
  ['wide 1600x900', 1600, 900, false, 1, ['down', 'shuf1']],
  ['laptop 1366x768', 1366, 768, false, 1, ['shuf1']],
  ['phone 390x844', 390, 844, true, 3, ['shuf1']],
  ['kiosk 1080x1920', 1080, 1920, false, 1, ['shuf2']]
];
await Promise.all(SCREENS.map(screen));
await b.close();
console.log(bad ? '\n' + bad + ' FAILED' : '\nevery header link lands on its own segment, on every screen');
process.exit(bad ? 1 : 0);
