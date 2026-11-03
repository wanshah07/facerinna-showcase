/* A hidden segment is never painted for a beat, and a header link lands on its own segment.

   The booth settings come from the sheet and take a second or three to arrive on a first visit.
   Until then the page used to show everything, so a segment the admin had hidden (and the
   built-in QR and poster blocks that were switched off) showed for a moment and then collapsed,
   pulling the page up under the visitor: a tap on a header link in that moment landed on a
   different segment.

   Now:
   - no settings yet (or ones older than three minutes): everything an admin can hide waits, the
     hero is there at once, and the rest follows with the answer
   - settings seen a minute ago: what they hid is hidden from the first frame, nothing waits
   - a header link tapped while the page was settling is landed on again once it has re-flowed
   - a page with no script address at all (a test, or a copy of the file) does not wait for ever */
import pkg from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.mjs';
const { chromium } = pkg;
const PORT = 8211, BASE = 'http://127.0.0.1:' + PORT, API = BASE + '/api';
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

const CONFIG = {
  ok: true,
  settings: { page_mode: 'open', welcome: 'show', games_off: '', gift_active: 'no', tour_active: 'no' },
  section_states: [{ id: 'talk', label: "Dr. Peter's Talk", mode: 'hidden', message: '' }],
  builtin_off: ['builtin-qr-whatsapp', 'builtin-poster-session-talk'], documents: [], media: [], segments: [], gift_needs: {}
};
const b = await chromium.launch();
async function open({ w = 1440, h = 900, mobile = false, delay = 1500, cache = null, api = API }) {
  const c = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  await c.route(u => !u.href.startsWith(BASE), r => r.abort());
  await c.route(API, async r => { await sleep(delay); r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(CONFIG) }); });
  await c.addInitScript(([api, cache]) => {
    window.__BOOTH_API = api;
    try { if (cache) localStorage.setItem('fx.booth.config', JSON.stringify({ at: Date.now() - cache.age, cfg: cache.cfg })); } catch (e) {}
  }, [api, cache]);
  const p = await c.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e.message)));
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  return { c, p, errs };
}
const shown = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; }, sel);
const linkShown = (p, id) => p.evaluate(i => { const a = document.querySelector('.nav-links a[href="#' + i + '"]'); return !!a && getComputedStyle(a).display !== 'none'; }, id);

console.log('a first visit, the answer takes 1.5 s');
{
  const { c, p, errs } = await open({ delay: 1500 });
  await sleep(500);
  chk('the hero is there at once', await shown(p, '#top'));
  chk('the hidden segment (Talk) is not shown while the settings are unknown', !(await shown(p, '#talk')));
  chk('...nor the built-in blocks that are switched off', !(await shown(p, '[data-media="builtin-qr-whatsapp"]')) && !(await shown(p, '[data-media="builtin-poster-session-talk"]')));
  chk('...nor its link in the header', !(await linkShown(p, 'talk')));
  chk('the other segments wait too, so nothing can be hidden after being shown', !(await shown(p, '#range')) && !(await shown(p, '#game')));
  await sleep(2200);
  chk('once the answer is in, the segments that stay are shown', await shown(p, '#range') && await shown(p, '#evidence') && await shown(p, '#game'));
  chk('...the hidden one is still not shown, nor its link, nor the built-in blocks', !(await shown(p, '#talk')) && !(await linkShown(p, 'talk')) && !(await shown(p, '[data-media="builtin-qr-whatsapp"]')));
  chk('...and the other header links are back', await linkShown(p, 'range') && await linkShown(p, 'game'));
  chk('the hold is let go', await p.evaluate(() => !document.documentElement.classList.contains('booth-wait')));
  chk('no page errors', errs.length === 0, errs);
  await c.close();
}

console.log('\na return visit within three minutes: what was hidden is hidden from the first frame, nothing waits');
{
  const { c, p, errs } = await open({ delay: 6000, cache: { age: 60000, cfg: CONFIG } });
  await sleep(700);
  chk('no hold: the segments are shown straight away', await shown(p, '#range') && await shown(p, '#game'));
  chk('the hidden segment is not shown, before the answer', !(await shown(p, '#talk')));
  chk('...nor the built-in blocks, nor the header link', !(await shown(p, '[data-media="builtin-qr-whatsapp"]')) && !(await linkShown(p, 'talk')));
  chk('no page errors', errs.length === 0, errs);
  await c.close();
}

console.log('\nsettings seen ten minutes ago: they hide what they hid, and the rest waits for the new answer');
{
  const { c, p } = await open({ delay: 2500, cache: { age: 600000, cfg: CONFIG } });
  await sleep(700);
  chk('the hidden segment is not shown', !(await shown(p, '#talk')));
  chk('the rest waits for the live answer', !(await shown(p, '#range')));
  await sleep(2800);
  chk('...then it is shown', await shown(p, '#range') && !(await shown(p, '#talk')));
  await c.close();
}

console.log('\na header link tapped while the page is still settling');
for (const [name, opt] of [['desktop', { w: 1920, h: 1080 }], ['phone', { w: 390, h: 844, mobile: true }]]) {
  /* Contact is a link that is on screen during the wait (it is not one an admin can hide). Tapped then, the
     page is short; once the held segments come in it grows, and Contact would be left far above the
     visitor: it must be landed on again. */
  {
    const { c, p } = await open({ ...opt, delay: 1800 });
    await sleep(400);
    await p.evaluate(() => { document.querySelector('footer a[href="#contact"], a[href="#contact"]').click(); });
    await sleep(4500);
    const r = await p.evaluate(() => { const t = document.getElementById('contact'); return { top: Math.round(t.getBoundingClientRect().top), y: Math.round(scrollY), h: innerHeight }; });
    chk(name + ': a tap on Contact during the wait still ends with Contact at the top of the screen', r.top >= -4 && r.top <= 90, r);
    chk(name + ': ...and the hidden segment is not on the page', !(await shown(p, '#talk')));
    await c.close();
  }
  /* and an ordinary tap once the page is in: Clinical Study, under the header, not Hero Products or Gallery */
  {
    const { c, p } = await open({ ...opt, delay: 300 });
    await sleep(2500);
    if (opt.mobile) { await p.click('#burger'); await sleep(300); }
    await p.click('.nav-links a[href="#evidence"]');
    await sleep(3500);
    const r = await p.evaluate(() => { const t = document.getElementById('evidence'); const n = document.getElementById('heroes'); return { top: Math.round(t.getBoundingClientRect().top), prevBottom: Math.round(n.getBoundingClientRect().bottom), y: Math.round(scrollY) }; });
    chk(name + ': a header link lands on its own segment (Clinical Study at the top, Hero Products just above it)', r.top >= -4 && r.top <= 80 && r.prevBottom <= 90, r);
    await c.close();
  }
}

console.log('\na page with no script address does not wait');
{
  const { c, p } = await open({ api: '' });
  await sleep(500);
  chk('the segments are shown (nothing to ask)', await shown(p, '#range') && await shown(p, '#talk'));
  chk('...and nothing is held', await p.evaluate(() => !document.documentElement.classList.contains('booth-wait')));
  await c.close();
}

await b.close(); srv.close();
console.log(bad ? '\n' + bad + ' FAILED' : '\nhidden segments stay hidden from the first frame, and a header link lands on its own segment');
process.exit(bad ? 1 : 0);
