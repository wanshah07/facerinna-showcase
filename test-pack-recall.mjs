/* Headless checks for Pack Recall.
 *
 * The rules promised in the treatment: every card shows during the preview, the
 * preview gets shorter every level, a matching pair scores and stays open, a
 * wrong pair closes again, a cleared board advances the level and switches to a
 * recall round, recall cards move on a timer, and gift mode stops on target.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/data/lib/playwright-lemo node test-pack-recall.mjs
 */
import { chromium } from 'playwright-core';
import { serve } from './tools-mini-serve.mjs';

const ROOT = process.cwd();
const { server, port } = await serve(ROOT);
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const errors = [];
const NOISE = /cloudflareinsights|cdn-cgi\/rum|ERR_FAILED|Failed to load resource/;
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push('console: ' + m.text()); });

const fails = [];
const ok = (name, cond, detail = '') => {
  if (!cond) fails.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
};

await page.goto(`http://127.0.0.1:${port}/pack-recall-4k.html`);
await page.waitForFunction(() => window.__packrecall, null, { timeout: 20000 });

/* 1. the deck is a real deck: 16 cards, 8 pairs, every pair twice */
await page.evaluate(() => window.__packrecall.start('play'));
await page.waitForTimeout(200);
const deck = await page.evaluate(() => window.__packrecall.cards());
ok('16 cards on the board', deck.length === 16, `${deck.length}`);
const counts = {};
deck.forEach(c => { counts[c.pair] = (counts[c.pair] || 0) + 1; });
ok('every pair appears exactly twice', Object.values(counts).every(n => n === 2) && Object.keys(counts).length === 8,
   JSON.stringify(counts));

/* 2. the preview shows every card, then closes them */
const duringPreview = await page.evaluate(() => ({ state: window.__packrecall.state(),
  up: window.__packrecall.cards().filter(c => c.up).length }));
ok('the preview opens every card', duringPreview.state === 'preview' && duringPreview.up === 16,
   `${duringPreview.up} up, state=${duringPreview.state}`);
await page.waitForFunction(() => window.__packrecall.state() === 'play', null, { timeout: 12000 });
const afterPreview = await page.evaluate(() => window.__packrecall.cards().filter(c => c.up).length);
ok('the preview then closes them all', afterPreview === 0, `${afterPreview} still up`);

/* 3. matching pair scores and stays open */
const pairPlay = await page.evaluate(async () => {
  const cards = window.__packrecall.cards();
  const a = cards.findIndex(c => !c.matched);
  const b = cards.findIndex((c, i) => i !== a && c.pair === cards[a].pair);
  const before = window.__packrecall.snapshot().score;
  window.__packrecall.tap(a);
  window.__packrecall.tap(b);
  await new Promise(r => setTimeout(r, 700));
  return { before, after: window.__packrecall.snapshot().score,
           bothUp: window.__packrecall.cards().filter(c => c.matched).length };
});
ok('a matching pair scores', pairPlay.after > pairPlay.before, `${pairPlay.before} -> ${pairPlay.after}`);
ok('a matching pair stays open', pairPlay.bothUp === 2, `${pairPlay.bothUp} matched`);

/* 4. a wrong pair closes again and does not score */
const wrongPlay = await page.evaluate(async () => {
  const cards = window.__packrecall.cards();
  const a = cards.findIndex(c => !c.matched);
  const b = cards.findIndex((c, i) => i !== a && !c.matched && c.pair !== cards[a].pair);
  const before = window.__packrecall.snapshot().score;
  window.__packrecall.tap(a);
  window.__packrecall.tap(b);
  await new Promise(r => setTimeout(r, 1500));
  const after = window.__packrecall.cards();
  return { before, after: window.__packrecall.snapshot().score,
           openNow: after.filter(c => c.up && !c.matched).length, state: window.__packrecall.state() };
});
ok('a wrong pair does not score', wrongPlay.after === wrongPlay.before, `${wrongPlay.before} -> ${wrongPlay.after}`);
ok('a wrong pair closes again', wrongPlay.openNow === 0 && wrongPlay.state === 'play',
   `open=${wrongPlay.openNow}, state=${wrongPlay.state}`);

/* 5. clearing the board advances the level, shortens the preview, and switches to recall */
const levelUp = await page.evaluate(async () => {
  const before = window.__packrecall.snapshot();
  /* play out the rest of the board by pairing whatever matches */
  for (let guard = 0; guard < 40; guard++) {
    const cards = window.__packrecall.cards();
    const a = cards.findIndex(c => !c.matched);
    if (a < 0) break;
    const b = cards.findIndex((c, i) => i !== a && !c.matched && c.pair === cards[a].pair);
    if (b < 0) break;
    window.__packrecall.tap(a); window.__packrecall.tap(b);
    await new Promise(r => setTimeout(r, 260));
  }
  await new Promise(r => setTimeout(r, 1400));
  if (window.__packrecall.state() === 'preview') window.__packrecall.skipPreview();
  await new Promise(r => setTimeout(r, 700));
  return { before, after: window.__packrecall.snapshot() };
});
ok('clearing the board advances the level', levelUp.after.level === levelUp.before.level + 1,
   `level ${levelUp.before.level} -> ${levelUp.after.level}`);
ok('the preview shortens every level', levelUp.after.previewMs < levelUp.before.previewMs,
   `${levelUp.before.previewMs}ms -> ${levelUp.after.previewMs}ms`);
ok('level 2 is a recall round', levelUp.after.kind === 'recall', levelUp.after.kind);
ok('a recall round has a shuffle timer', levelUp.after.shuffleMs > 0, `${levelUp.after.shuffleMs}ms`);

/* 6. recall cards are question/answer faces and they really move */
const recall = await page.evaluate(async () => {
  if (window.__packrecall.state() === 'preview') window.__packrecall.skipPreview();
  await new Promise(r => setTimeout(r, 600));
  const before = window.__packrecall.cards().map(c => c.slot);
  const roles = window.__packrecall.cards().map(c => c.role);
  /* wait past one real shuffle interval, read from the page rather than guessed */
  const wait = window.__packrecall.snapshot().shuffleMs + 1200;
  await new Promise(r => setTimeout(r, wait));
  const after = window.__packrecall.cards().map(c => c.slot);
  return { roles, moved: before.filter((s, i) => s !== after[i]).length, state: window.__packrecall.state() };
});
ok('recall cards are questions and answers', recall.roles.includes('q') && recall.roles.includes('a'),
   JSON.stringify([...new Set(recall.roles)]));
ok('recall cards slide to new slots', recall.moved > 0, `${recall.moved} cards moved`);

/* 7. gift mode carries the target and stops on it with the winner screen */
await page.evaluate(async () => {
  window.__BOOTH_API = '';
  window.fxGift = {
    settings: () => Promise.resolve({ gift_active: 'yes', gift_needs: { 'pack-recall': 700 } }),
    needFor: (cfg, id) => { const n = cfg && cfg.gift_needs && cfg.gift_needs[id]; return (typeof n === 'number' && n > 0) ? n : null; },
    forget: () => {},
    offer: () => {}
  };
  window.__packrecall.refreshGift(true);
});
await page.waitForFunction(() => window.__packrecall.snapshot().giftState === 'ready', null, { timeout: 8000 });
const giftStart = await page.evaluate(() => { window.__packrecall.start('gift'); return window.__packrecall.snapshot(); });
ok('gift mode carries a target', giftStart.mode === 'gift' && giftStart.need === 700, `need=${giftStart.need}`);

const giftRun = await page.evaluate(async () => {
  const g = window.__packrecall;
  const need = g.snapshot().need;
  for (let guard = 0; guard < 60; guard++) {
    const s = g.snapshot();
    if (s.state === 'won' || s.state === 'over') break;
    if (s.state === 'preview') { g.skipPreview(); await new Promise(r => setTimeout(r, 400)); continue; }
    if (s.state !== 'play') { await new Promise(r => setTimeout(r, 200)); continue; }
    const cards = g.cards();
    const a = cards.findIndex(c => !c.matched && !c.up);
    if (a < 0) { await new Promise(r => setTimeout(r, 200)); continue; }
    const b = cards.findIndex((c, i) => i !== a && !c.matched && c.pair === cards[a].pair);
    if (b < 0) { await new Promise(r => setTimeout(r, 200)); continue; }
    g.tap(a); g.tap(b);
    await new Promise(r => setTimeout(r, 240));
    if (g.snapshot().score >= need) return { reached: true, score: g.snapshot().score, need };
  }
  return { reached: false, score: g.snapshot().score, state: g.snapshot().state, need };
});
ok('a gift run reaches the target', giftRun.reached || giftRun.score >= (giftRun.need || 0),
   `score=${giftRun.score} need=${giftRun.need}`);

if (giftRun.reached) {
  await page.waitForFunction(() => { const r = document.querySelector('#result'); return r && !r.classList.contains('hidden'); },
                             null, { timeout: 8000 });
  const winUI = await page.evaluate(() => ({
    winnerVisible: getComputedStyle(document.querySelector('#rWin')).display !== 'none',
    head: document.querySelector('#rHead').textContent,
    state: window.__packrecall.state()
  }));
  ok('the game stops on target', winUI.state === 'won', winUI.state);
  ok('the winner line is shown', winUI.winnerVisible);
  ok('the head says gift unlocked', /Gift unlocked/i.test(winUI.head), winUI.head);
}

ok('no JS errors on the page', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(fails.length ? `\n${fails.length} FAILED\n` + fails.join('\n') : '\nall checks pass');
process.exit(fails.length ? 1 : 0);
