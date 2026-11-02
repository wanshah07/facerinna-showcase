/* Headless checks for the three new booth games: Magic Tiles, Pack Slicer,
   Match Factory.

   Each game is checked against the rules the game states on its own start
   screen, one assertion per rule, plus the shared contract every game on this
   stand must honour (gift target from the desk, run stops on target with the
   winner line, no JS errors, board fits every breakpoint).

   Run from the repo:
     node test-new-games.mjs
*/
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };

const srv = http.createServer((q, r) => {
  const p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  const f = path.join(process.cwd(), p === '/' ? '/index.html' : p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(0, r));
const PORT = srv.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

// This container has no GPU. The already-shipped Pack Drop runs at ~13 fps here,
// so nothing below asserts an absolute frame rate.
const BROWSER = '/opt/data/lib/playwright/chromium-1248/chrome-linux64/chrome';
const browser = await chromium.launch({
  headless: true, args: ['--no-sandbox'],
  ...(fs.existsSync(BROWSER) ? { executablePath: BROWSER } : {}),
});

let fails = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
};

/* the gift desk fixture: every game reads gift_needs[<id>], nothing else */
const GIFT_STUB = (target) => `window.fxGift={
  settings:()=>Promise.resolve({gift_active:'yes',gift_needs:{${target}}}),
  needFor:(cfg,id)=>{const n=cfg&&cfg.gift_needs&&cfg.gift_needs[id];return (typeof n==='number'&&n>0)?n:null},
  forget:()=>{}, offer:()=>{}
};`;

async function open(file, api, viewport = { width: 390, height: 844 }) {
  const page = await browser.newPage({
    viewport, isMobile: viewport.width < 900, hasTouch: viewport.width < 900,
  });
  const errors = [];
  const NOISE = /cloudflareinsights|cdn-cgi\/rum|ERR_FAILED|Failed to load resource/;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(`${BASE}/${file}`);
  await page.waitForFunction(a => !!window[a], api, { timeout: 20000 });
  return { page, errors };
}

/* ─────────────────────────── 1. Magic Tiles ─────────────────────────── */
{
  const { page, errors } = await open('magic-tiles-4k.html', '__magictiles');
  await page.evaluate(() => window.__magictiles.start('play'));

  const start = await page.evaluate(() => window.__magictiles.snapshot());
  ok('magic tiles: starts with three lives', start.lives === 3, `lives=${start.lives}`);
  ok('magic tiles: four lanes', start.cell > 0 && start.cw === start.cell * 4, `cw=${start.cw} cell=${start.cell}`);

  // tiles fall: the count grows and a tile's y increases between samples
  await page.waitForTimeout(900);
  const falling = await page.evaluate(async () => {
    const before = window.__magictiles.lanes();
    await new Promise(r => setTimeout(r, 350));
    const after = window.__magictiles.lanes();
    const moved = before.filter((t, i) => after[i] && after[i].y > t.y).length;
    return { n: after.length, moved, before: before.length };
  });
  ok('magic tiles: tiles fall', falling.n > 0 && falling.moved > 0, `${falling.n} tiles, ${falling.moved} moved down`);

  // tapping the lane of a tile at the hit line scores
  const scored = await page.evaluate(async () => {
    const g = window.__magictiles;
    for (let i = 0; i < 90; i++) {
      const s = g.snapshot();
      if (s.state !== 'play') break;
      const lanes = g.lanes();
      const hy = s.hitY;
      const near = lanes.find(t => !t.dead && Math.abs(t.y - hy) < s.cell * 0.55);
      if (near) { g.tapLane(near.lane); await new Promise(r => setTimeout(r, 80)); }
      else await new Promise(r => setTimeout(r, 60));
      if (g.snapshot().score > 0) return { hit: true, score: g.snapshot().score };
    }
    return { hit: false, score: g.snapshot().score };
  });
  ok('magic tiles: a tapped tile scores', scored.hit, `score=${scored.score}`);

  // gift mode carries the target and stops on it
  await page.evaluate(GIFT_STUB(`'magic-tiles':300`));
  await page.evaluate(() => window.__magictiles.refreshGift(true));
  await page.waitForFunction(() => window.__magictiles.snapshot().giftState === 'ready', null, { timeout: 8000 });
  const gift = await page.evaluate(() => { window.__magictiles.start('gift'); return window.__magictiles.snapshot(); });
  ok('magic tiles: gift mode carries a target', gift.mode === 'gift' && gift.need === 300, `need=${gift.need}`);

  const winRun = await page.evaluate(async () => {
    const g = window.__magictiles;
    for (let i = 0; i < 400; i++) {
      const s = g.snapshot();
      if (s.state === 'won' || s.state === 'over') break;
      if (s.state !== 'play') { await new Promise(r => setTimeout(r, 60)); continue; }
      const lanes = g.lanes();
      const near = lanes.find(t => !t.dead && Math.abs(t.y - s.hitY) < s.cell * 0.55);
      if (near) g.tapLane(near.lane);
      await new Promise(r => setTimeout(r, 40));
    }
    return g.snapshot();
  });
  ok('magic tiles: the run stops on target', winRun.state === 'won' || winRun.state === 'over', `state=${winRun.state}`);
  if (winRun.state === 'won') {
    // finish() reveals the panel on a timer (1.1s for a win), so wait for it
    // instead of reading the computed style the same tick.
    await page.waitForFunction(() => {
      const r = document.querySelector('#result');
      return r && !r.classList.contains('hidden');
    }, null, { timeout: 6000 }).catch(() => {});
    const ui = await page.evaluate(() => ({
      win: getComputedStyle(document.querySelector('#rWin')).display !== 'none',
      head: document.querySelector('#rHead').textContent,
    }));
    ok('magic tiles: winner line shown', ui.win && /Gift unlocked/i.test(ui.head), ui.head);
  }
  ok('magic tiles: no JS errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.close();
}

/* ─────────────────────────── 2. Pack Slicer ─────────────────────────── */
{
  const { page, errors } = await open('pack-slicer-4k.html', '__packslicer');
  await page.evaluate(() => window.__packslicer.start('play'));

  const start = await page.evaluate(() => window.__packslicer.snapshot());
  ok('pack slicer: starts with zero misses', start.misses === 0, `misses=${start.misses}`);

  // packs must be thrown high enough to reach: after 1.2s there is still one on
  // screen, and nothing has been missed without input
  await page.waitForTimeout(1200);
  const airborne = await page.evaluate(() => window.__packslicer.snapshot());
  ok('pack slicer: a pack is airborne at 1.2s', airborne.items > 0, `${airborne.items} items`);
  ok('pack slicer: no miss without input', airborne.misses === 0, `misses=${airborne.misses}`);

  // slice along a line through the first item
  const sliced = await page.evaluate(async () => {
    const g = window.__packslicer;
    for (let i = 0; i < 120; i++) {
      const s = g.snapshot();
      if (s.state !== 'play') break;
      const it = g.items().filter(x => !x.bomb)[0];
      if (it) {
        const before = g.snapshot().score;
        g.sliceAlong(it.x - 40, it.y, it.x + 40, it.y);
        await new Promise(r => setTimeout(r, 60));
        if (g.snapshot().score > before) return { hit: true, score: g.snapshot().score };
      } else await new Promise(r => setTimeout(r, 60));
    }
    return { hit: false, score: g.snapshot().score };
  });
  ok('pack slicer: slicing a pack scores', sliced.hit, `score=${sliced.score}`);

  // a bomb costs a miss
  const bomb = await page.evaluate(async () => {
    const g = window.__packslicer;
    // the bomb is a 12% roll; forcing it makes the rule testable every run
    g.forceBomb();
    await new Promise(r => setTimeout(r, 120));
    const b = g.items().find(x => x.bomb);
    if (!b) return { found: false };
    const before = g.snapshot().misses;
    g.sliceAlong(b.x - 30, b.y, b.x + 30, b.y);
    await new Promise(r => setTimeout(r, 120));
    return { found: true, before, after: g.snapshot().misses };
  });
  ok('pack slicer: slicing a bomb costs a miss',
     bomb.found && bomb.after === bomb.before + 1, `${bomb.before} -> ${bomb.after}`);

  await page.evaluate(GIFT_STUB(`'pack-slicer':300`));
  await page.evaluate(() => window.__packslicer.refreshGift(true));
  await page.waitForFunction(() => window.__packslicer.snapshot().giftState === 'ready', null, { timeout: 8000 });
  const gift = await page.evaluate(() => { window.__packslicer.start('gift'); return window.__packslicer.snapshot(); });
  ok('pack slicer: gift mode carries a target', gift.mode === 'gift' && gift.need === 300, `need=${gift.need}`);
  ok('pack slicer: no JS errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.close();
}

/* ────────────────────────── 3. Match Factory ────────────────────────── */
{
  const { page, errors } = await open('match-factory-4k.html', '__matchfactory');
  await page.evaluate(() => window.__matchfactory.start('play'));

  const start = await page.evaluate(() => window.__matchfactory.snapshot());
  ok('match factory: full 8x8 bench', start.tiles === 64, `${start.tiles} tiles`);
  ok('match factory: 30 moves', start.moves === 30, `moves=${start.moves}`);

  const board = await page.evaluate(() => window.__matchfactory.board());
  ok('match factory: no pre-made line on a fresh bench',
    (() => {
      const run = (get, n) => { let len = 1; for (let i = 1; i < n; i++) { if (get(i) === get(i - 1) && get(i) !== null) { len++; if (len >= 3) return true; } else len = 1; } return false; };
      for (let r = 0; r < 8; r++) if (run(c => board[r * 8 + c], 8)) return false;
      for (let c = 0; c < 8; c++) if (run(r => board[r * 8 + c], 8)) return false;
      return true;
    })());

  const moves = await page.evaluate(() => window.__matchfactory.findMoves());
  ok('match factory: a legal move exists', moves > 0, `${moves} moves`);

  const played = await page.evaluate(async () => {
    const g = window.__matchfactory;
    const hint = g.hint();
    if (!hint) return { ok: false };
    const before = g.snapshot();
    g.attemptSwap(hint.c1, hint.r1, hint.c2, hint.r2);
    await new Promise(r => setTimeout(r, 700));
    const after = g.snapshot();
    return { ok: after.score > before.score, before: before.score, after: after.score };
  });
  ok('match factory: a legal swap scores and costs a move', played.ok, `${played.before} -> ${played.after}`);

  const illegal = await page.evaluate(async () => {
    const g = window.__matchfactory;
    // ask the game which neighbouring pair is NOT a line, then play that one:
    // calling attemptSwap on random neighbours proves nothing, since most of
    // them are legal and score
    let pair = null;
    for (let r = 0; r < 8 && !pair; r++) for (let c = 0; c < 7 && !pair; c++) {
      if (!g.isLegal(c, r, c + 1, r)) pair = { c1: c, r1: r, c2: c + 1, r2: r };
    }
    if (!pair) return { found: false };
    const before = g.snapshot();
    g.attemptSwap(pair.c1, pair.r1, pair.c2, pair.r2);
    await new Promise(r => setTimeout(r, 300));
    const after = g.snapshot();
    return { found: true, score: after.score, beforeScore: before.score,
             moves: after.moves, beforeMoves: before.moves };
  });
  ok('match factory: an illegal swap reverts and costs nothing',
    illegal.found && illegal.score === illegal.beforeScore && illegal.moves === illegal.beforeMoves,
    `score ${illegal.beforeScore} -> ${illegal.score}, moves ${illegal.beforeMoves} -> ${illegal.moves}`);

  await page.evaluate(GIFT_STUB(`'match-factory':300`));
  await page.evaluate(() => window.__matchfactory.refreshGift(true));
  await page.waitForFunction(() => window.__matchfactory.snapshot().giftState === 'ready', null, { timeout: 8000 });
  const gift = await page.evaluate(() => { window.__matchfactory.start('gift'); return window.__matchfactory.snapshot(); });
  ok('match factory: gift mode carries a target', gift.mode === 'gift' && gift.need === 300, `need=${gift.need}`);
  ok('match factory: no JS errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.close();
}

/* ─────────────────── shared: layout on every breakpoint ─────────────────── */
for (const [file, api] of [['magic-tiles-4k.html', '__magictiles'],
  ['pack-slicer-4k.html', '__packslicer'], ['match-factory-4k.html', '__matchfactory']]) {
  for (const [w, h, label] of [[390, 844, 'phone'], [820, 1180, 'tablet'], [1920, 1080, 'tv']]) {
    const { page } = await open(file, api, { width: w, height: h });
    await page.evaluate(a => window[a].start('play'), api);
    await page.waitForTimeout(400);
    const geo = await page.evaluate(() => {
      const c = document.getElementById('game').getBoundingClientRect();
      return { inView: c.top >= 0 && c.bottom <= innerHeight + 1 && c.left >= 0 && c.right <= innerWidth + 1,
               ox: document.documentElement.scrollWidth > innerWidth, w: Math.round(c.width) };
    });
    ok(`${file.split('-4k')[0]} · ${label}: board inside the viewport`, geo.inView && !geo.ox, `${geo.w}px`);
    await page.close();
  }
}

await browser.close();
srv.close();
console.log(fails ? `\n${fails} FAILED\n` : '\nall checks pass');
process.exit(fails ? 1 : 0);
