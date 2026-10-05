#!/usr/bin/env node
/* How the booth scripts cope with a crowd arriving together.

     node tools/booth-load-check.mjs            100 phones arriving over 3 seconds
     node tools/booth-load-check.mjs 150 3      150 phones, three waves, 5s apart
     node tools/booth-load-check.mjs 100 1 --spread 0    all 100 in the same instant

   Needs Node 18 or newer, and a connection that can reach script.google.com
   -- run it from your own laptop, not from a locked-down network.

   It sends what a phone sends when it opens the booth page: one config
   request to the booth admin script and one board request to the scores
   script. The phones start at random moments inside --spread seconds (3 by
   default: a poster QR code, a crowd walking in), or all in the same instant
   with --spread 0, which is harsher than any real crowd. Read-only: nothing is written, no gift is
   claimed, no score is posted, nobody is e-mailed.

   Reading the result: "failed" is a phone that got no usable answer. A page
   that gets none still opens (it keeps the last config it saw, or none), so
   a few failures mean a few phones missed a lock or a game switch until their
   next check three minutes later, not that the booth is down.

   --config-url and --scores-url point it somewhere else, which is how it is
   tested without touching the real scripts. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; };
const nums = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
const PHONES = nums[0] || 100, WAVES = nums[1] || 1, GAP_MS = 5000, TIMEOUT_MS = 10000;
const SPREAD_MS = (arg('spread') != null ? Number(arg('spread')) : 3) * 1000;

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const find = (f, re) => { const m = re.exec(read(f)); return m && m[1]; };
const CONFIG_URL = arg('config-url') || find('admin.html', /ADMIN_API[^]*?'(https:\/\/script\.google\.com\/macros\/s\/[^']+\/exec)'/);
const SCORES_URL = arg('scores-url') || find('index.html', /BOOTH_SCORES\s*=\s*'([^']+)'/);
if (!CONFIG_URL || !SCORES_URL) { console.error('could not find the script addresses'); process.exit(2); }

async function timed(label, run) {
  const t0 = performance.now();
  try {
    const r = await run(AbortSignal.timeout(TIMEOUT_MS));
    const ms = performance.now() - t0, text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (e) {}
    if (r.status !== 200) return { label, ms, bad: 'HTTP ' + r.status };
    if (!json) return { label, ms, bad: 'not JSON (an error page)' };
    if (json.ok === false) return { label, ms, bad: 'script said: ' + (json.error || json.reason || 'no') };
    return { label, ms, bad: null };
  } catch (e) {
    return { label, ms: performance.now() - t0, bad: /timeout|abort/i.test(String(e)) ? 'no answer in ' + TIMEOUT_MS / 1000 + 's' : 'network: ' + (e.cause && e.cause.code || e.message) };
  }
}
const phone = async () => {
  if (SPREAD_MS > 0) await new Promise(r => setTimeout(r, Math.random() * SPREAD_MS));
  return Promise.all([
  timed('config', s => fetch(CONFIG_URL, { method: 'POST', body: JSON.stringify({ action: 'config' }), signal: s })),
  timed('board',  s => fetch(SCORES_URL + '?all=1&top=50', { signal: s })),
  ]);
};
const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;

const results = [];
console.log(`${PHONES} phones x ${WAVES} wave${WAVES > 1 ? 's' : ''}, each asking for the config and the board, ` +
  (SPREAD_MS > 0 ? `arriving over ${SPREAD_MS / 1000}s...` : 'all in the same instant...'));
for (let w = 0; w < WAVES; w++) {
  if (w) await new Promise(r => setTimeout(r, GAP_MS));
  const t0 = performance.now();
  const wave = (await Promise.all(Array.from({ length: PHONES }, phone))).flat();
  results.push(...wave);
  const fail = wave.filter(r => r.bad).length;
  console.log(`  wave ${w + 1}: ${wave.length - fail}/${wave.length} answered in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}
for (const label of ['config', 'board']) {
  const rs = results.filter(r => r.label === label), ok = rs.filter(r => !r.bad);
  const ms = ok.map(r => r.ms).sort((a, b) => a - b), why = {};
  rs.filter(r => r.bad).forEach(r => why[r.bad] = (why[r.bad] || 0) + 1);
  console.log(`\n${label}: ${ok.length}/${rs.length} answered (${(100 * ok.length / rs.length).toFixed(0)}%)`);
  console.log(`  time to answer  median ${(pct(ms, .5) / 1000).toFixed(1)}s   slowest 1 in 20 ${(pct(ms, .95) / 1000).toFixed(1)}s   slowest ${(pct(ms, 1) / 1000).toFixed(1)}s`);
  if (Object.keys(why).length) console.log('  failed:', JSON.stringify(why));
}
const total = results.length, bad = results.filter(r => r.bad).length, rate = bad / total;
console.log('\n' + (rate === 0 ? 'Every request was answered.' : rate <= 0.05 ? 'A few phones missed out: they carry on with what they last saw.'
  : 'Many phones got nothing back. The pages still open and the games still play, but locks, game switches and the board will lag until the next check.'));
process.exit(rate > 0.05 ? 1 : 0);
