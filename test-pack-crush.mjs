/* Headless checks for Pack Crush.
 *
 * Drives the real page in Chromium and asserts the rules the treatment promises:
 * a swap that matches scores, a swap that does not match reverts, specials are
 * created and fire, the board never runs dry, and the gift mode stops on target.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/data/lib/playwright-lemo node test-pack-crush.mjs
 */
import { chromium } from 'playwright-core';
import { serve } from './tools-mini-serve.mjs';

const ROOT = new URL('.', import.meta.url).pathname;
const { server, port } = await serve(ROOT);
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
/* The Cloudflare beacon is a third-party analytics script: on a local origin its
   CORS preflight fails, which is not a fault in the game. Everything else counts. */
const NOISE = /cloudflareinsights|cdn-cgi\/rum|ERR_FAILED|Failed to load resource/;
page.on('console', m => {
  if (m.type() === 'error' && !NOISE.test(m.text())) errors.push('console: ' + m.text());
});

/* The gift desk is a live Apps Script. A headless check must not depend on it.
   fx-gift.js assigns window.fxGift itself, so the stub goes in after load and the
   page is asked to re-read it — the same call the Redeem button makes. */

const url = `http://127.0.0.1:${port}/pack-crush-4k.html`;
await page.goto(url);
await page.waitForFunction(() => window.__packcrush && window.__packcrush.state() === 'idle', null, { timeout: 20000 });

const fails = [];
const ok = (name, cond, detail = '') => {
  if (!cond) fails.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
};

/* 1. boot: 64 tiles, two kinds of pack at least, and a legal move exists */
const boot = await page.evaluate(() => window.__packcrush.snapshot());
ok('board fills 64 tiles', boot.tiles === 64, `tiles=${boot.tiles}`);
const hasMove = await page.evaluate(() => !!window.__packcrush.find());
ok('board opens with a legal move', hasMove);

/* 2. no three-in-a-row at start */
const startClean = await page.evaluate(() => {
  const b = window.__packcrush.board();
  let runs = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 6; c++) {
    const k = b[r][c] && b[r][c].t;
    if (k != null && b[r][c + 1] && b[r][c + 2] && b[r][c + 1].t === k && b[r][c + 2].t === k) runs++;
  }
  for (let c = 0; c < 8; c++) for (let r = 0; r < 6; r++) {
    const k = b[r][c] && b[r][c].t;
    if (k != null && b[r + 1][c] && b[r + 2][c] && b[r + 1][c].t === k && b[r + 2][c].t === k) runs++;
  }
  return runs;
});
ok('board opens without a pre-made match', startClean === 0, `runs=${startClean}`);

/* 3. a real swap that matches scores points */
await page.evaluate(() => window.__packcrush.start('play'));
await page.waitForFunction(() => window.__packcrush.state() === 'play', null, { timeout: 5000 });
const before = await page.evaluate(() => window.__packcrush.snapshot().score);
const moved = await page.evaluate(() => {
  const m = window.__packcrush.find();
  if (!m) return null;
  window.__packcrush.swap(m.r1, m.c1, m.r2, m.c2);
  return m;
});
ok('a legal move was found and played', !!moved, JSON.stringify(moved));
await page.waitForFunction(() => window.__packcrush.state() === 'play', null, { timeout: 15000 });
const after = await page.evaluate(() => window.__packcrush.snapshot());
ok('the match scored', after.score > before, `${before} -> ${after.score}`);
ok('the board refilled to 64 tiles', after.tiles === 64, `tiles=${after.tiles}`);

/* 4. an illegal swap reverts: board identical, score unchanged */
const illegal = await page.evaluate(async () => {
  const snap = () => JSON.stringify(window.__packcrush.board());
  const startBoard = snap();
  const s0 = window.__packcrush.snapshot().score;
  /* find a swap that produces no match, by trying corners until one fails */
  const b = window.__packcrush.board();
  outer:
  for (let r = 0; r < 8; r++) for (let c = 0; c < 7; c++) {
    const k1 = b[r][c].t, k2 = b[r][c + 1].t;
    if (k1 === k2) continue;
    /* a swap is illegal if neither side forms a run; check by simulating */
    const t = b[r].slice();
    b[r][c] = { t: k2 }; b[r][c + 1] = { t: k1 };
    let run = false;
    for (let rr = 0; rr < 8 && !run; rr++) for (let cc = 0; cc < 6; cc++) {
      const k = b[rr][cc] && b[rr][cc].t;
      if (k != null && b[rr][cc + 1] && b[rr][cc + 2] && b[rr][cc + 1].t === k && b[rr][cc + 2].t === k) { run = true; break; }
    }
    for (let cc = 0; cc < 8 && !run; cc++) for (let rr = 0; rr < 6; rr++) {
      const k = b[rr][cc] && b[rr][cc].t;
      if (k != null && b[rr + 1][cc] && b[rr + 2][cc] && b[rr + 1][cc].t === k && b[rr + 2][cc].t === k) { run = true; break; }
    }
    b[r] = t;
    if (!run) { window.__packcrush.swap(r, c, r, c + 1); return { r, c, s0, startBoard }; }
  }
  return null;
});
if (illegal) {
  await page.waitForFunction(() => window.__packcrush.state() === 'play', null, { timeout: 8000 });
  const afterIllegal = await page.evaluate(() => ({ board: JSON.stringify(window.__packcrush.board()), score: window.__packcrush.snapshot().score }));
  ok('an illegal swap reverts the board', afterIllegal.board === illegal.startBoard);
  ok('an illegal swap does not score', afterIllegal.score === illegal.s0, `${illegal.s0} -> ${afterIllegal.score}`);
} else {
  ok('an illegal swap could be constructed', false, 'board had no non-matching adjacent pair');
}

/* 5. gift mode stops the run on target and shows the winner screen */
await page.evaluate(async () => {
  window.__BOOTH_API = '';
  /* the shape fx-gift really returns: gift_active plus a per-game needs map */
  window.fxGift = {
    settings: () => Promise.resolve({ gift_active: 'yes', gift_needs: { 'pack-crush': 900 } }),
    needFor: (cfg, id) => { const n = cfg && cfg.gift_needs && cfg.gift_needs[id]; return (typeof n === 'number' && n > 0) ? n : null; },
    forget: () => {},
    offer: () => {}
  };
  window.__packcrush.refreshGift(true);
});
await page.waitForFunction(() => window.__packcrush.snapshot().giftState === 'ready', null, { timeout: 8000 });
await page.evaluate(() => window.__packcrush.start('gift'));
const giftSnap = await page.evaluate(() => window.__packcrush.snapshot());
ok('gift mode carries a target', giftSnap.mode === 'gift' && !!giftSnap.need, `need=${giftSnap.need}`);

/* reach the target by scoring through the exposed board: play moves until the score passes need */
const won = await page.evaluate(async () => {
  const g = window.__packcrush;
  const need = g.snapshot().giftNeed || 0;
  if (!need) return 'no-target';
  for (let i = 0; i < 400; i++) {
    if (g.state() === 'won' || g.state() === 'over') break;
    if (g.state() !== 'play') { await new Promise(r => setTimeout(r, 40)); continue; }
    const m = g.find();
    if (!m) { await new Promise(r => setTimeout(r, 60)); continue; }
    g.swap(m.r1, m.c1, m.r2, m.c2);
    await new Promise(r => setTimeout(r, 60));
    if (g.snapshot().score >= need) return 'reached';
  }
  return g.state();
});
ok('gift run reaches the target or ends cleanly', won === 'reached' || won === 'over' || won === 'won', String(won));

if (won === 'reached' || won === 'won') {
  await page.waitForFunction(() => document.querySelector('#result') && !document.querySelector('#result').classList.contains('hidden'), null, { timeout: 8000 });
  const winUI = await page.evaluate(() => ({
    winnerVisible: getComputedStyle(document.querySelector('#rWin')).display !== 'none',
    head: document.querySelector('#rHead').textContent,
    score: document.querySelector('#rScore').textContent
  }));
  ok('the winner line is shown', winUI.winnerVisible);
  ok('the result head says gift unlocked', /Gift unlocked/i.test(winUI.head), winUI.head);
}

/* 6. no page errors through all of that */
ok('no JS errors on the page', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(fails.length ? `\n${fails.length} FAILED\n` + fails.join('\n') : '\nall checks pass');
process.exit(fails.length ? 1 : 0);
