/* The events strip on the main page: a short, simple version of the Events page's cards, above The Range.

   What is proved: the events that are on now or still to come show as short cards (the first three, the
   one on now first, then the soonest), finished and hidden (show = FALSE) rows are left out, a sheet cell is
   only ever text, every card and the "See all events" link open the Events page, the strip sits between the
   opening banner and The Range, it is compact, it never makes the page scroll sideways, and it is simply
   absent when the sheet cannot be read (and still shown from the last good copy when it cannot). */
import pkg from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.mjs';
const { chromium } = pkg;
const PORT = 8215, BASE = 'http://127.0.0.1:' + PORT;
let bad = 0;
const chk = (l, ok, x) => { if (!ok) bad++; console.log((ok ? '  PASS  ' : '  FAIL  ') + l + (!ok && x !== undefined ? '  -> ' + JSON.stringify(x) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const srv = http.createServer((req, res) => {
  let f = decodeURIComponent(new URL(req.url, BASE).pathname); if (f.endsWith('/')) f += 'index.html';
  const fp = path.join(ROOT, f);
  if (f === '/sw.js' || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' }); res.end(fs.readFileSync(fp));
}).listen(PORT, '127.0.0.1');

const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const plus = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return iso(d); };
const q = v => '"' + String(v).replace(/"/g, '""') + '"';
const HEAD = 'show,event,brand,start_date,end_date,time,location,highlight,highlight_time,details,image_url,action_label,action_url';
const row = (show, event, a, b, loc) => [show, q(event), 'Facerinna', a, b, '10.00 am - 10.00 pm', q(loc), '', '', '', '', '', ''].join(',');
const HOSTILE = '<img src=x onerror="window.__owned=1">Hostile';
const CSV = [HEAD,
  row('TRUE', 'Old Event (finished)', plus(-9), plus(-5), 'Past Hall'),
  row('TRUE', 'Pop Up Live', plus(-1), plus(2), 'Mid Valley, Ground Floor'),
  row('TRUE', 'Pop Up Watsons', plus(17), plus(23), 'Parkson, Level Ground Floor'),
  row('FALSE', 'Hidden Event', plus(3), plus(4), 'Nowhere'),
  row('TRUE', HOSTILE, plus(5), plus(5), 'One Utama'),
  row('TRUE', 'Pop Up Guardian', plus(25), plus(30), 'One Utama, West Wing'),
].join('\n');
const ONE = [HEAD, row('TRUE', 'Only One', plus(9), plus(12), 'Sunway Pyramid')].join('\n');
const NONE = [HEAD, row('TRUE', 'Old Event (finished)', plus(-9), plus(-5), 'Past Hall')].join('\n');

const b = await chromium.launch();
async function open({ w = 1366, h = 768, mobile = false, sheet = CSV, cache = null, states = null, delay = 0 }) {
  const c = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  await c.route(u => !u.href.startsWith(BASE) && !/docs\.google\.com\/spreadsheets/.test(u.href), r => r.abort());
  await c.route(/docs\.google\.com\/spreadsheets/, r => sheet === null ? r.abort()
    : r.fulfill({ status: 200, contentType: 'text/csv', headers: { 'Access-Control-Allow-Origin': '*' }, body: sheet }));
  if (states) {
    const CONFIG = { ok: true, settings: { page_mode: 'open', welcome: 'show', games_off: '', gift_active: 'no', tour_active: 'no' },
      section_states: states, builtin_off: [], documents: [], media: [], segments: [], gift_needs: {} };
    await c.route(BASE + '/api', async r => { await sleep(delay); r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(CONFIG) }); });
  }
  await c.addInitScript(([cache, api]) => { window.__BOOTH_API = api; try { if (cache) localStorage.setItem('fx.events.strip', cache); } catch (e) {} }, [cache, states ? BASE + '/api' : '']);
  const p = await c.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '/index.html', { waitUntil: 'load' }); await sleep(2500);
  return { c, p, errs };
}
const read = p => p.evaluate(() => {
  const s = document.getElementById('eventsNow'), r = document.getElementById('range'), t = document.getElementById('top');
  const cards = [...s.querySelectorAll('.evs-card')];
  const rr = r.getBoundingClientRect(), sr = s.getBoundingClientRect();
  return { shown: !s.hidden && sr.height > 0, n: cards.length, eyebrow: document.getElementById('evsEyebrow').textContent,
    titles: cards.map(c => c.querySelector('.evs-title').textContent), chips: cards.map(c => c.querySelector('.evs-chip').textContent),
    wheres: cards.map(c => c.querySelector('.evs-where').textContent),
    hrefs: cards.map(c => new URL(c.href).pathname).concat([new URL(s.querySelector('.evs-all').href).pathname]),
    afterHero: !!(t.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING), beforeRange: !!(r.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_PRECEDING),
    above: sr.bottom <= rr.top + 1, nextIsRange: s.nextElementSibling === r,
    cardH: cards.length ? Math.round(Math.max(...cards.map(c => c.getBoundingClientRect().height))) : 0,
    cardW: cards.length ? Math.round(Math.max(...cards.map(c => c.getBoundingClientRect().width))) : 0,
    sideways: document.documentElement.scrollWidth > innerWidth + 1, owned: !!window.__owned, injected: !!s.querySelector('img') };
});

console.log('a laptop, the sheet answers');
{
  const { c, p, errs } = await open({});
  const r = await read(p);
  chk('the strip is on the page, between the opening banner and The Range', r.shown && r.afterHero && r.beforeRange && r.above && r.nextIsRange, r);
  chk('three cards: the one on now first, then the soonest', r.n === 3 && r.titles[0] === 'Pop Up Live' && r.titles[1] === HOSTILE && r.titles[2] === 'Pop Up Watsons', r.titles);
  chk('a finished event, a hidden one (show = FALSE) and the fourth to come are not there', !r.titles.some(t => /Old Event|Hidden|Guardian/.test(t)), r.titles);
  chk('each says when, as the Events page does: Happening now, In 5 days (within 14 days), Upcoming (further off)', r.chips.join('|') === 'Happening now|In 5 days|Upcoming', r.chips);
  chk('each shows the dates and the venue on one short line', /\d+ – \d+ \w{3} · Mid Valley/.test(r.wheres[0]) && /Parkson/.test(r.wheres[2]), r.wheres);
  chk('the heading is short: "Events" when some are on now and some to come', r.eyebrow === 'Events', r.eyebrow);
  chk('every card and "See all events" open the Events page', r.hrefs.length === 4 && r.hrefs.every(h => h === '/events/'), r.hrefs);
  chk('a sheet cell is only text: the hostile name did not run or turn into a picture', !r.owned && !r.injected, r);
  chk('compact: a card is short (under 130px) and narrow (under 480px), nothing scrolls sideways', r.cardH > 0 && r.cardH < 130 && r.cardW < 480 && !r.sideways, r);
  await p.click('.evs-card >> nth=0'); await p.waitForURL(/\/events\/$/, { timeout: 10000 }).catch(() => {});
  chk('tapping a card opens the Events page', /\/events\/$/.test(p.url()), p.url());
  chk('no page errors', errs.length === 0, errs);
  await c.close();
}
console.log('\na phone');
{
  const { c, p, errs } = await open({ w: 360, h: 740, mobile: true });
  const r = await read(p);
  chk('the strip is above The Range, the cards stack full width, the page does not scroll sideways', r.shown && r.nextIsRange && r.n === 3 && !r.sideways && r.cardW <= 360, r);
  chk('a long title or venue stays inside its card (the card is still short)', r.cardH < 140, r.cardH);
  chk('no page errors', errs.length === 0, errs);
  await c.close();
}
console.log('\none event only, and none');
{
  const one = await open({ sheet: ONE }); const r1 = await read(one.p);
  chk('a single upcoming event: one card, headed "Coming up"', r1.shown && r1.n === 1 && r1.eyebrow === 'Coming up' && r1.chips[0] === 'In 9 days', r1);
  await one.c.close();
  const none = await open({ sheet: NONE }); const r0 = await read(none.p);
  chk('nothing on or to come: the strip is not there at all', !r0.shown && r0.n === 0, r0);
  await none.c.close();
}
console.log('\nthe sheet cannot be reached');
{
  const dead = await open({ sheet: null }); const r = await read(dead.p);
  chk('first visit, no signal: no strip, no gap, no errors', !r.shown && dead.errs.length === 0, [r.shown, dead.errs]);
  await dead.c.close();
  const rows = [{ show: 'TRUE', event: 'Remembered Event', brand: 'Facerinna', start_date: plus(4), end_date: plus(4), location: 'Sunway Pyramid' }];
  const kept = await open({ sheet: null, cache: JSON.stringify({ at: Date.now() - 3600000, rows }) }); const rk = await read(kept.p);
  chk('a device that saw it before and has no signal now still shows what it last saw', rk.shown && rk.titles[0] === 'Remembered Event' && rk.chips[0] === 'In 4 days', rk);
  await kept.c.close();
  const old = await open({ sheet: null, cache: JSON.stringify({ at: Date.now() - 9 * 86400000, rows }) }); const ro = await read(old.p);
  chk('...but not a copy more than a week old', !ro.shown, ro);
  await old.c.close();
}

console.log('\nthe admin switch (Sections tab: Events strip)');
{
  const vis = (p, id) => p.evaluate(i => { const e = document.getElementById(i); return !!e && !e.hidden && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; }, id);
  const link = p => p.evaluate(() => [...document.querySelectorAll('a[href="#eventsNow"]')].some(a => getComputedStyle(a).display !== 'none'));
  const on = await open({ states: [], delay: 300 }); await sleep(1500);
  chk('switched on (the default): the strip is shown', await vis(on.p, 'eventsNow') && await vis(on.p, 'range'));
  await on.c.close();
  const off = await open({ states: [{ id: 'eventsNow', label: 'Events strip', mode: 'hidden', message: '' }], delay: 300 }); await sleep(1500);
  const ro = await read(off.p);
  chk('switched off: the strip is not on the page, even though the sheet has events', !(await vis(off.p, 'eventsNow')), ro.shown);
  chk('...and the page under it is untouched (The Range, the divider below it, the next segment)', await vis(off.p, 'range') && await vis(off.p, 'heroes')
    && await off.p.evaluate(() => { const d = document.getElementById('range').nextElementSibling; return getComputedStyle(d).display !== 'none'; }));
  chk('...no gap is left above The Range', await off.p.evaluate(() => document.getElementById('range').getBoundingClientRect().top - document.getElementById('top').getBoundingClientRect().bottom < 120));
  chk('no page errors', off.errs.length === 0, off.errs);
  await off.c.close();
  const held = await open({ states: [{ id: 'eventsNow', label: 'Events strip', mode: 'hidden', message: '' }], delay: 2500, cache: null }); await sleep(900);
  chk('before the answer arrives the strip waits too: it is never painted and then taken away', !(await vis(held.p, 'eventsNow')));
  await held.c.close();
  const lock = await open({ states: [{ id: 'eventsNow', label: 'Events strip', mode: 'locked', message: '' }], delay: 300 }); await sleep(1500);
  chk('a lock request (nothing to lock) is treated as off', !(await vis(lock.p, 'eventsNow')) && !(await lock.p.evaluate(() => !!document.querySelector('#eventsNow .booth-lock'))));
  await lock.c.close();
}

srv.close(); await b.close();
console.log(bad ? '\n' + bad + ' FAILED' : '\nthe events strip shows what is on and what is coming, and opens the Events page');
process.exit(bad ? 1 : 0);
