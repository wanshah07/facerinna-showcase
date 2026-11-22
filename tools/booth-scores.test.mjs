/* Apps Script cannot run here, but most of booth-scores.gs is plain JS. This
   stubs the four Google services it touches and drives doPost/doGet for real,
   against an in-memory sheet. What it is really checking: that the script's
   ranking rule agrees with the page's own bests(), because a booth where the
   popup and the big board disagree is worse than no board. */
import fs from 'fs';
import { ROOT, PAGE } from './paths.mjs';
const src = fs.readFileSync(ROOT+'tools/booth-scores.gs','utf8');

/* Both paths, because the live config is the standalone one: SHEET_ID set and
   the workbook opened by id, so the scoreboard can share a workbook with the
   events registration without the two scripts sharing a project. openById is
   the branch that actually runs now -- stubbing only getActive made this test
   pass on a code path production no longer takes. */
const opened = [];
/* One in-memory sheet per tab, because the script now keeps two: Scores (the
   board) and Rejected (the log of refused posts). A stub that handed back the
   same sheet for every name would have mixed the two and made every "nothing was
   written" assertion below meaningless. `sheet` stays the Scores tab, as before. */
function makeSheet() {
  const sh = { rows: [] };
  sh.api = {
    /* rows[] holds the header row too, exactly as a real sheet does, so
       getLastRow is the array length and getRange(2,...) starts at rows[1].
       This used to return length+1 with no header in the array, which made
       setUp's `getLastRow() === 0` check never fire and left the two stubs in
       this repo modelling the same API two different ways. */
    getLastRow: () => sh.rows.length,
    getLastColumn: () => sh.rows.reduce((m,r)=>Math.max(m,r.length),0),
    appendRow: r => sh.rows.push(r),
    deleteRows: (start, n) => { sh.rows.splice(start-1, n); },
    getRange: (r,c,nr,nc) => ({
      /* r is a 1-based SHEET row against a 0-based array: getRange(2,...) starts
         at rows[1]. This used to slice from r-2, taking the header and dropping
         the last data row, and passed anyway because readAll_ discards any row
         whose game id it does not recognise. A stub that is wrong in a direction
         the code tolerates is a test of nothing. */
      getValues: () => sh.rows.slice(r-1, r-1+nr).map(x => x.slice(c-1, c-1+nc)),
      setValue: v => { for (let i=r-1;i<r-1+nr;i++) sh.rows[i][c-1]=v; },
      setFontWeight(){ return this; },
    }),
    setFrozenRows(){}, setColumnWidth(){}, hideColumns(){},
  };
  return sh;
}
const sheet = makeSheet();          /* the Scores tab */
const tabs = { Scores: sheet };
const rejected = { get rows() { return tabs.Rejected ? tabs.Rejected.rows : []; } };
const book = {
  getSheetByName: name => (tabs[name] ? tabs[name].api : null),
  insertSheet: name => (tabs[name] = makeSheet()).api,
};
const SpreadsheetApp = {
  getActive: () => book,
  openById: id => { opened.push(id); return book; },
  flush(){},
};
const locks = { held:0, fail:false };
const LockService = { getScriptLock: () => ({
  waitLock(){ if (locks.fail) throw new Error('Lock timeout: secret-internal-detail'); locks.held++; },
  releaseLock(){ locks.held--; } }) };
const cacheStore = new Map();
/* remove() included deliberately. The first version of this stub had only
   get/put, so dropBoards_() threw, its try/catch swallowed it, and the board
   went on serving rows that had just been hidden -- which is exactly the
   failure the cache can cause and exactly what "board empties" is for. */
const CacheService = { getScriptCache: () => ({
  get: k => cacheStore.get(k) ?? null,
  put: (k,v) => cacheStore.set(k,v),
  remove: k => cacheStore.delete(k) }) };
const ContentService = { MimeType:{JSON:'json'},
  createTextOutput: s => ({ setMimeType: () => s }) };
const Logger = { log(){} };
/* The script reads its workbook id from Script Properties now, not source.
   A placeholder stands in for the real id, which is a secret. */
const BOOK_ID = 'ADMIN-WORKBOOK-ID-PLACEHOLDER';
const PROPS = {};
const PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (k in PROPS ? PROPS[k] : null),
  setProperty: (k,v) => { PROPS[k]=String(v); },
  deleteProperty: k => { delete PROPS[k]; } }) };
PROPS['ADMIN_WORKBOOK_ID'] = BOOK_ID;

const mod = eval(`(() => { ${src}
  return { doPost, doGet, bests_, setUp, hideAllSoFar, readAll_, GAMES, REJ_KEEP, REJ_LOG_N, DEVICE_N }; })()`);

const post = o => JSON.parse(mod.doPost({ postData:{ contents: JSON.stringify(o), type:'text/plain' } }));
const get  = q => JSON.parse(mod.doGet({ parameter: q }));

let ok = true;
const check = (label, cond) => { if(!cond) ok = false;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label); };

mod.setUp();

console.log('the workbook it writes to');
check('opened by id, not the bound sheet', opened.length > 0);
check('and it is the id read from script properties',
      opened[0] === 'ADMIN-WORKBOOK-ID-PLACEHOLDER');

console.log('\naccepting good runs');
check('first score accepted',            post({game:'match-lab',name:'Ahmad',score:120}).ok === true);
check('second player accepted',          post({game:'match-lab',name:'Siti', score:300}).ok === true);
check('same player, better run',         post({game:'match-lab',name:'Ahmad',score:450}).ok === true);
const r = post({game:'match-lab',name:'Ahmad',score:80});
check('worse run still accepted',        r.ok === true);
check('  ...but best stays the best',    r.best === 450);
check('  ...and rank reflects the best', r.rank === 1);

console.log('\nrefusing what it says it refuses');
/* A refusal is a bare {"ok":false} now: no reason in the reply (a forger would use it to
   feel for the ceilings), the reason goes to the Rejected tab instead. So each of these
   asserts both halves. */
const bare = r => r && r.ok === false && Object.keys(r).length === 1;
const lastWhy = () => { const r = rejected.rows; return r.length ? r[r.length-1][1] : null; };
check('unknown game',        bare(post({game:'nope',       name:'A', score:1})) && lastWhy() === 'unknown-game');
check('empty name',          bare(post({game:'match-lab',  name:'  ', score:1})) && lastWhy() === 'bad-name');
check('score not a number',  bare(post({game:'match-lab',  name:'A', score:'x'})) && lastWhy() === 'score-not-whole-number');
check('fractional score',    bare(post({game:'match-lab',  name:'A', score:1.5})) && lastWhy() === 'score-not-whole-number');
check('negative score',      bare(post({game:'match-lab',  name:'A', score:-5})) && lastWhy() === 'score-out-of-range');
check('absurd score',        bare(post({game:'match-lab',  name:'A', score:999999})) && lastWhy() === 'score-out-of-range');
check('malformed body',      bare(JSON.parse(mod.doPost({postData:{contents:'{oops'}}))) && lastWhy() === 'bad-json');

console.log('\nrate limit');
let blocked = 0;
for (let i=0;i<20;i++) if (post({game:'lab-run',name:'Spam',score:10+i,rid:'flood-run-'+i}).ok === false) blocked++;
check('a flood from one name is cut off', blocked > 0);
check('a different name is unaffected',   post({game:'lab-run',name:'Calm',score:10}).ok === true);

console.log('\nthe same run arriving twice is one run');
{
  const n0 = sheet.rows.length;
  const first = post({game:'pack-drop',name:'Dina',score:777,device:'devdina1',rid:'run-abc12345'});
  const again = post({game:'pack-drop',name:'Dina',score:777,device:'devdina1',rid:'run-abc12345'});
  check('the first copy is written',                    first.ok === true && sheet.rows.length === n0 + 1);
  check('a repeat with the same run id is answered ok',  again.ok === true && again.repeat === true);
  check('...with the board as it stands, same shape',    again.rank === first.rank && again.best === 777 && Array.isArray(again.rows));
  check('...and writes nothing',                         sheet.rows.length === n0 + 1);
  const next = post({game:'pack-drop',name:'Dina',score:777,device:'devdina1',rid:'run-def67890'});
  check('a new run id with the same score is a real run (two rows)', next.ok === true && !next.repeat && sheet.rows.length === n0 + 2);
  const m0 = sheet.rows.length;
  post({game:'pack-drop',name:'Eli',score:500,device:'devEli001'});
  const old = post({game:'pack-drop',name:'Eli',score:500,device:'devEli001'});
  check('a page that sends no id: same device, game, name and score at once is the same run', old.ok === true && old.repeat === true && sheet.rows.length === m0 + 1);
  post({game:'pack-drop',name:'Eli',score:900,device:'devEli001'});
  check('...but a different score from it is a new run', sheet.rows.length === m0 + 2);
  let blockedRepeats = 0;
  for (let i=0;i<30;i++) if (post({game:'pack-drop',name:'Dina',score:777,device:'devdina1',rid:'run-abc12345'}).ok !== true) blockedRepeats++;
  check('repeats never count toward the rate limit, so a retry storm cannot lock a player out', blockedRepeats === 0
        && post({game:'pack-drop',name:'Dina',score:800,device:'devdina1',rid:'run-ghi11111'}).ok === true);
  check('a made-up or hostile run id is only ever a cache key (no sheet effect)',
        post({game:'pack-drop',name:'Fay',score:5,device:'x',rid:"x'); DROP--"+'a'.repeat(80)}).ok === true);
}

console.log('\nthe lock is actually taken and released');
check('no lock left held', locks.held === 0);

console.log('\nreading back');
const one = get({game:'match-lab', top:5});
check('one game returns rows',           one.ok && one.rows.length === 2);
check('sorted best first',               one.rows[0].n === 'Ahmad' && one.rows[0].s === 450);
check('one row per person',              one.rows.filter(x=>x.n==='Ahmad').length === 1);
const all = get({all:'1', top:5});
check('all=1 covers every game it knows', Object.keys(all.games).length === 14);
check('unknown game on read',            get({game:'nope'}).error === 'unknown game');

console.log('\nthe cache: fast, but never stale enough to lie');
{
  const before = sheet.rows.length;
  get({game:'match-lab'});                       // warm it
  const r1 = get({game:'match-lab'});            // should not touch the sheet
  check('a second read is served without a sheet write', sheet.rows.length === before);
  const p = post({game:'match-lab', name:'Fresh', score:10000});
  check('a post still lands in the sheet',       sheet.rows.length === before + 1);
  check('and shows up immediately, not in 20s',
        get({game:'match-lab'}).rows.some(r => r.n === 'Fresh'));
  check('rank came back without re-reading everything', p.rank === 1);
}

console.log('\nhidden rows leave the board but stay in the sheet');
const before = sheet.rows.length;
mod.hideAllSoFar();
check('board empties',                   get({game:'match-lab'}).rows.length === 0);
check('rows still in the sheet',         sheet.rows.length === before);

console.log('\ntimestamps survive the round trip');
/* The booth board breaks a tie on points with whoever got there first, and it
   reads that time out of these rows. If doGet ever dropped `t` the tie would
   quietly go back to being arbitrary while every page-side test still passed,
   because those supply their own timestamps. */
{
  cacheStore.clear(); sheet.rows.length = 1;              // headers only
  post({game:'deep-lab', name:'Early', score:10});
  const rows = get({game:'deep-lab'}).rows;
  check('rows come back with a timestamp',
        rows.length === 1 && typeof rows[0].t === 'number' && rows[0].t > 0);
  cacheStore.clear();                                 // and from a cold cache too
  const cold = get({game:'deep-lab'}).rows;
  check('still there when read from the sheet',
        cold.length === 1 && typeof cold[0].t === 'number' && cold[0].t > 0);
}

console.log('\nthe rule matches the page');
/* the page's own bests(), copied out of index.html */
function pageBests(rows){
  const seen=new Set(), out=[];
  rows.filter(r=>r && typeof r.s==='number' && typeof r.t==='number')
    .sort((a,b)=>b.s-a.s||a.t-b.t).forEach(r=>{
      if(seen.has(r.n)) return; seen.add(r.n); out.push(r);
    });
  return out;
}
/* Lim is listed BEFORE Siti and scored LATER. V8's sort is stable, so without
   the a.t - b.t tie-break Lim would keep first place on array order alone and
   the assertion below would pass while the rule was gone. Ordered this way it
   can only pass if the tie-break really ran. */
const sample = [
  {n:'Ahmad', s:100, t:5}, {n:'Lim',  s:300, t:9}, {n:'Ahmad', s:450, t:2},
  {n:'Siti',  s:300, t:1}, {n:'Siti', s:120, t:3},
];
const mine = mod.bests_(sample.slice()).map(r=>r.n+':'+r.s);
const page = pageBests(sample.slice()).map(r=>r.n+':'+r.s);
console.log('   script:', mine.join(' '));
console.log('   page  :', page.join(' '));
check('same order, same winners', JSON.stringify(mine) === JSON.stringify(page));
check('ties broken by earlier run (Siti before Lim at 300)',
      mine.indexOf('Siti:300') < mine.indexOf('Lim:300'));

console.log('\ndeliberate divergence: case');
const cased = [{n:'ahmad', s:10, t:1}, {n:'Ahmad', s:20, t:2}];
check('script folds Ahmad/ahmad into one', mod.bests_(cased.slice()).length === 1);
check('page would keep them separate',     pageBests(cased.slice()).length === 2);

console.log('\nwhat a player types cannot become a formula in the workbook');
post({game:'match-lab', name:'=1+1', score:5, device:'=HYPERLINK("https://evil.test","x")'});
/* The leading = is stripped from a name now (it used to be kept and escaped with an apostrophe),
   so the name lands as 1+1 and the row is found by its device, which is still escaped. */
const fRow = sheet.rows.find(r => String(r[5]).indexOf('HYPERLINK') >= 0);
check('a leaderboard name that starts with = loses it, and is stored as plain text',
  fRow && fRow[3] === '1+1', fRow && fRow[3]);
check('...and the device it came from is still stored as text', fRow && String(fRow[5]).charAt(0) === "'", fRow && fRow[5]);
/* the sheet is replaced part-way through this file, so the ordinary name to
   compare against is the one still in it, not one from the top of the run */
check('an ordinary name is untouched', sheet.rows.some(r => String(r[3]) === 'Early'), sheet.rows.slice(1).map(r=>r[3]));

console.log('\nthe tournament: most points, then the fastest, then the highest level');
/* a fresh sheet and a fresh cache, so nothing from above is in the way */
sheet.rows.length = 0; mod.setUp(); cacheStore.clear();
const tp = o => post(Object.assign({game:'tournament'}, o));
check('a tournament run keeps its time and level', tp({name:'Aina', score:5000, secs:600, level:20, device:'d1'}).ok===true
      && sheet.rows[sheet.rows.length-1][8]===600 && sheet.rows[sheet.rows.length-1][9]===20);
tp({name:'Budi', score:5000, secs:480, level:15, device:'d2'});
tp({name:'Citra', score:5000, secs:480, level:19, device:'d3'});
tp({name:'Dewi', score:5200, secs:900, level:10, device:'d4'});
tp({name:'Eka', score:5000, secs:480, level:19, device:'d5'});          // same points, time and level as Citra, later
cacheStore.clear();
let tb = get({game:'tournament', top:10}).rows;
console.log('   board:', tb.map(r=>r.n+':'+r.s+':'+r.m+'s:L'+r.l).join('  '));
check('the most points wins, whatever the time', tb[0].n==='Dewi');
check('on equal points the FASTER run is ahead (Citra and Budi at 480 s, before Aina at 600 s)', tb.map(r=>r.n).indexOf('Budi') < tb.map(r=>r.n).indexOf('Aina'));
check('...and on equal points and time the HIGHER level (Citra L19 before Budi L15)', tb.map(r=>r.n).indexOf('Citra') < tb.map(r=>r.n).indexOf('Budi'));
check('...and on all three equal the earlier run (Citra before Eka)', tb.map(r=>r.n).indexOf('Citra') < tb.map(r=>r.n).indexOf('Eka'));
check('the rows say how long and what level', tb.every(r=>r.m>0 && r.l>0));
/* the cached board takes a new run in place and keeps the same order */
tp({name:'Fadzil', score:5000, secs:300, level:5, device:'d6'});
let after = get({game:'tournament', top:10}).rows.map(r=>r.n);
check('a run posted after the board is cached lands in the right place (Fadzil at 300 s leads the 5000s)', after[1]==='Fadzil', after);
/* a person's best is their best by the same rule */
tp({name:'Aina', score:5000, secs:200, level:20, device:'d1'});
cacheStore.clear();
tb = get({game:'tournament', top:10}).rows;
check('a faster run of the same points replaces the slower one (Aina 200 s)', tb.find(r=>r.n==='Aina').m===200);
check('one row per person', new Set(tb.map(r=>r.n.toLowerCase())).size===tb.length);
/* a row from before the two columns existed still ranks, as the slowest */
sheet.rows.push([new Date(), 1, 'tournament', 'Old', 5000, 'd9', false, 'text/plain x']);
cacheStore.clear();
tb = get({game:'tournament', top:20}).rows.map(r=>r.n);
check('an old row with no time or level is still on the board, behind the same points that have one', tb.includes('Old') && tb.indexOf('Old') > tb.indexOf('Aina'), tb);
/* nonsense is held to a sane range */
tp({name:'Gila', score:100, secs:-5, level:99999, device:'d7'});
tp({name:'Hari', score:100, secs:'x', level:'y', device:'d8'});
const g1 = sheet.rows.find(r=>r[3]==='Gila'), h1 = sheet.rows.find(r=>r[3]==='Hari');
check('a negative time is 0, a huge level is held at 999, a word is 0', (g1[8]===''||g1[8]===0) && g1[9]===999 && (h1[8]===''||h1[8]===0) && (h1[9]===''||h1[9]===0), [g1.slice(8), h1.slice(8)]);
/* other games ignore both */
post({game:'match-lab', name:'Zed', score:77, secs:5, level:9, device:'dz'});
const z1 = sheet.rows.find(r=>r[3]==='Zed');
check('another game keeps no time or level, and ranks as it always has', (z1[8]===''||z1[8]===0) && (z1[9]===''||z1[9]===0));
check('the ceiling for a tournament total is 60,000', post({game:'tournament', name:'Big', score:60001, device:'db'}).ok===false && tp({name:'Big', score:60000, secs:600, level:12, device:'db'}).ok===true);

/* ================================================================== server-side checks
   Added with the forged-score finding. Everything below starts from a clean sheet,
   an empty cache and an empty Rejected tab, and asserts BOTH what the player sees (a
   bare {"ok":false}, nothing else) and what the organiser sees (a row in Rejected,
   and no row in Scores). */
const reset = () => {
  sheet.rows.length = 0; mod.setUp(); cacheStore.clear();
  if (tabs.Rejected) tabs.Rejected.rows.length = 1;      /* keep the header, drop the rows */
  locks.fail = false;
};
const scoreRows = () => sheet.rows.length - 1;           /* minus the header */
const rejRows = () => Math.max(0, rejected.rows.length - 1);
const reasons = () => rejected.rows.slice(1).map(r => r[1]);
/* raw body, for the things JSON.stringify cannot say (NaN, Infinity, a missing key) */
const raw = text => JSON.parse(mod.doPost({ postData: { contents: text, type: 'text/plain' } }));
const CH = String.fromCharCode;                          /* control and invisible characters, without putting them in this file */

console.log('\nthe ceilings: an honest best run is accepted, one above it is not');
{
  reset();
  /* the maxima for the games whose rules cap the score are pinned here, so loosening one is a visible edit */
  const PINNED = { 'pack-match': 5000, 'shelf-shot': 7000, 'deep-lab': 18000, 'facy-run': 16000, 'skin-iq': 5, 'tournament': 60000,
                   'match-lab': 40000, 'magic-tiles': 50000, 'pack-slicer': 50000 };
  for (const [g, m] of Object.entries(PINNED)) check('  ' + g + ' ceiling is ' + m, mod.GAMES[g] && mod.GAMES[g].max === m, mod.GAMES[g]);
  /* a game is never given a ceiling above what it had before the working-out */
  for (const g of Object.keys(mod.GAMES)) check('  ' + g + ' ceiling is a whole positive number no higher than 200,000',
    Number.isInteger(mod.GAMES[g].max) && mod.GAMES[g].max > 0 && mod.GAMES[g].max <= 200000);
  for (const g of Object.keys(mod.GAMES)) {
    const m = mod.GAMES[g].max, extra = g === 'tournament' ? { secs: 600, level: 12 } : {};
    const atMax = post({ game: g, name: 'Max ' + g, score: m, device: 'dev-' + g, rid: 'rid-max-' + g, ...extra });
    const n0 = scoreRows();
    const over = post({ game: g, name: 'Over ' + g, score: m + 1, device: 'dev-' + g, rid: 'rid-over-' + g, ...extra });
    check(g + ': exactly the ceiling (' + m + ') is accepted and lands on the board', atMax.ok === true && atMax.best === m);
    check(g + ': one above it is refused, bare, and writes nothing', bare(over) && scoreRows() === n0 && lastWhy() === 'score-out-of-range');
    check(g + ': zero is accepted', post({ game: g, name: 'Zero ' + g, score: 0, device: 'dev-' + g, rid: 'rid-zero-' + g, ...extra }).ok === true);
  }
}

console.log('\nthe game list matches the games on disk');
{
  /* a game added to the booth with no entry here would be refused for ever; an entry with no game is dead weight */
  const ids = new Set();
  for (const f of fs.readdirSync(ROOT)) if (/\.html$/.test(f)) {
    const t = fs.readFileSync(ROOT + f, 'utf8'), m = t.match(/window\.FX_RANK=\{id:'([a-z-]+)'/);
    if (m) ids.add(m[1]);
  }
  ids.add('skin-iq');                                    /* the quiz posts from index.html, through FX_SCORES_API */
  check('every game the pages declare has a ceiling', [...ids].every(i => mod.GAMES[i]), [...ids].filter(i => !mod.GAMES[i]));
  check('every ceiling belongs to a game a page declares', Object.keys(mod.GAMES).every(i => ids.has(i)), Object.keys(mod.GAMES).filter(i => !ids.has(i)));
}

console.log('\nscores that are not a whole number in range');
{
  reset();
  const n0 = scoreRows(), base = { game: 'match-lab', name: 'Probe', device: 'probe-dev' };
  const bad = {
    'negative':                 () => post({ ...base, score: -1 }),
    'minus one hundred':        () => post({ ...base, score: -100 }),
    'NaN (sent as the word)':   () => raw('{"game":"match-lab","name":"Probe","score":NaN}'),
    'Infinity (the word)':      () => raw('{"game":"match-lab","name":"Probe","score":Infinity}'),
    'null':                     () => post({ ...base, score: null }),
    'a string of digits':       () => post({ ...base, score: '100' }),
    'a string in exponent form':() => post({ ...base, score: '1e3' }),
    'a float':                  () => post({ ...base, score: 100.5 }),
    'a tiny float':             () => post({ ...base, score: 0.1 }),
    'huge':                     () => post({ ...base, score: 1e21 }),
    'beyond safe integers':     () => post({ ...base, score: 9007199254740993 }),
    'a boolean':                () => post({ ...base, score: true }),
    'an array':                 () => post({ ...base, score: [5] }),
    'an object':                () => post({ ...base, score: { valueOf: 5 } }),
    'the empty string':         () => post({ ...base, score: '' }),
    'missing':                  () => post({ ...base }),
  };
  for (const [label, run] of Object.entries(bad)) { const r = run(); check(label + ' is refused with a bare {ok:false}', bare(r), r); }
  check('none of them reached the sheet', scoreRows() === n0);
  check('every one was logged with a reason', rejRows() === Object.keys(bad).length && reasons().every(x => /^(score-|bad-json)/.test(x)), reasons());
  check('minus zero is just zero', post({ ...base, name: 'NegZero', score: -0 }).ok === true && sheet.rows[sheet.rows.length-1][4] === 0
        && !Object.is(sheet.rows[sheet.rows.length-1][4], -0));
}

console.log('\na game id that is not on the list');
{
  reset();
  const n0 = scoreRows();
  const ids = ['nope', '', 'MATCH-LAB', 'match-lab ', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 5, null, ['match-lab'], { a: 1 }];
  for (const g of ids) { const r = post({ game: g, name: 'Probe', score: 5, device: 'g-dev' }); check('game ' + JSON.stringify(g) + ' is refused', bare(r), r); }
  check('a missing game is refused', bare(post({ name: 'Probe', score: 5 })));
  check('nothing reached the sheet', scoreRows() === n0);
  /* the same hole on the read side: an inherited property name is not a game */
  check('reading a game called constructor says unknown game, not an internal error', get({ game: 'constructor' }).error === 'unknown game');
  check('reading __proto__ says unknown game', get({ game: '__proto__' }).error === 'unknown game');
}

console.log('\nwhat a name can and cannot be');
{
  reset();
  const stored = name => { const n0 = sheet.rows.length; const r = post({ game: 'pack-match', name, score: 100, device: 'n-dev-' + n0, rid: 'rid-name-' + n0 + '-xx' });
    return r.ok === true ? sheet.rows[sheet.rows.length - 1][3] : null; };
  const formulaNames = ['=1+1', '+SUM(A1)', '-2+3', '@SUM(1)', '  =cmd|calc', '\t=1', '=====x', '= = =IMPORTXML("https://theirs/","//a")', '+-=@A', CH(160) + '=x'];
  for (const n of formulaNames) {
    const got = stored(n);
    check('formula name ' + JSON.stringify(n) + ' is stored without a leading formula character', got !== null && !/^[=+\-@\s]/.test(String(got)) && String(got).charAt(0) !== "'", got);
  }
  check('a name that is only formula characters is no name at all', bare(post({ game: 'pack-match', name: '=+-@', score: 1, device: 'n-dev' })) && lastWhy() === 'bad-name');
  check('a name that is only whitespace is no name at all', bare(post({ game: 'pack-match', name: ' \t\n ', score: 1, device: 'n-dev' })) && lastWhy() === 'bad-name');
  check('an operator inside a name is left alone (A-B, 1+1)', stored('A-B') === 'A-B' && stored('Ali+Abu') === 'Ali+Abu');
  check('a control character becomes a space', stored('Ali' + CH(0) + 'Abu' + CH(10) + 'X') === 'Ali Abu X', stored('Ali' + CH(0) + 'Abu'));
  check('a zero-width space, a BOM and a bidi override are dropped', stored('Ad' + CH(0x200b) + 'a' + CH(0xfeff) + 'm' + CH(0x202e)) === 'Adam');
  check('a zero-width prefix cannot hide a formula', stored(CH(0x200b) + '=1+1') === '1+1');
  check('a long name is cut to 18 characters', stored('Abdul Rahman bin Abdullah Al-Haj') === 'Abdul Rahman bin A');
  check('a name is cut cleanly and never ends in half an emoji', (() => { const n = stored('a'.repeat(17) + '\u{1F600}'); return n === 'a'.repeat(17); })());
  check('honest names come through unchanged', ['Nur Aisyah', 'Ahmad_99', "O'Brien", '007', 'Dr. Lim', '李明', 'A-B'].every(n => stored(n) === n));
  for (const bad of [123, {}, ['x'], null, true]) check('a name that is not text (' + JSON.stringify(bad) + ') is refused', bare(post({ game: 'pack-match', name: bad, score: 1, device: 'n-dev' })));
  check('a missing name is refused', bare(post({ game: 'pack-match', score: 1, device: 'n-dev' })));
  /* the log is a spreadsheet too: a formula in a REFUSED post must not run there either */
  post({ game: 'nope', name: '=HYPERLINK("https://evil.test","x")', score: '=1+1', device: '+cmd', rid: 'rid-evil-0001' });
  const evil = rejected.rows[rejected.rows.length - 1];
  check('the Rejected tab escapes what a stranger sent (game, name, score, device)', evil && evil.slice(2, 6).every(c => !/^[=+\-@]/.test(String(c)) || String(c).charAt(0) === "'"), evil);
}

console.log('\nrate limits');
{
  reset();
  /* per name and game, as before */
  let ok1 = 0; for (let i = 0; i < 20; i++) if (post({ game: 'pack-match', name: 'Same', score: 10 + i, device: 'rate-a-' + i, rid: 'rid-same-' + i + '-xx' }).ok === true) ok1++;
  check('one name posting one game: only the first ' + 12 + ' in a minute land', ok1 === 12, ok1);
  check('...and the rest are logged as rate-limit-name', reasons().filter(x => x === 'rate-limit-name').length === 8, reasons());
  check('the same name on ANOTHER game is a separate allowance', post({ game: 'match-lab', name: 'Same', score: 10, device: 'rate-b' }).ok === true);
  /* per device, across names and games */
  reset();
  const gs = ['pack-match', 'match-lab', 'shelf-shot', 'deep-lab'];
  let landed = 0, n = 0; const t0 = scoreRows();
  for (let i = 0; i < 80; i++) if (post({ game: gs[i % 4], name: 'Flood' + i, score: 10, device: 'flood-dev', rid: 'rid-flood-' + i + '-xx' }).ok === true) landed++;
  check('one device spreading a flood over many names and games is cut off at ' + mod.DEVICE_N, landed === mod.DEVICE_N && scoreRows() - t0 === mod.DEVICE_N, landed);
  check('...and the refusals are logged as rate-limit-device', reasons().filter(x => x === 'rate-limit-device').length === 80 - mod.DEVICE_N);
  check('a different device is not held up by it', post({ game: 'pack-match', name: 'Other', score: 10, device: 'calm-dev' }).ok === true);
  check('a post with no device shares one bucket of its own, not the honest devices', post({ game: 'pack-match', name: 'NoDev', score: 10 }).ok === true);
  reset();
  let nod = 0; for (let i = 0; i < 70; i++) if (post({ game: 'pack-match', name: 'Anon' + i, score: 10, rid: 'rid-anon-' + i + '-xxx' }).ok === true) nod++;
  check('posts with no device at all are cut off at the same figure', nod === mod.DEVICE_N, nod);
  check('...and an honest device still posts while that bucket is full', post({ game: 'pack-match', name: 'Honest', score: 10, device: 'honest-dev' }).ok === true);
  /* a retry storm is not a flood: repeats do not spend the allowance (also tested above for the name limit) */
  reset();
  post({ game: 'pack-match', name: 'Storm', score: 10, device: 'storm-dev', rid: 'rid-storm-0001' });
  for (let i = 0; i < 100; i++) post({ game: 'pack-match', name: 'Storm', score: 10, device: 'storm-dev', rid: 'rid-storm-0001' });
  check('100 repeats of one run do not use up the device allowance', post({ game: 'pack-match', name: 'Storm2', score: 10, device: 'storm-dev', rid: 'rid-storm-0002' }).ok === true);
}

console.log('\nthe same run id twice');
{
  reset();
  const p1 = { game: 'shelf-shot', name: 'Dup', score: 4000, device: 'dup-dev', rid: 'rid-dup-abcdef' };
  const first = post(p1), n1 = scoreRows();
  const again = post(p1);
  check('the first copy lands', first.ok === true && n1 === 1);
  check('the second copy writes nothing', scoreRows() === n1);
  check('...and is answered with the board and a repeat flag, so an honest retry still gets its rank', again.ok === true && again.repeat === true && again.rank === first.rank);
  check('...and is on the Rejected tab as a duplicate-run, so a replay shows', reasons().includes('duplicate-run'), reasons());
  const hostile = post({ ...p1, score: 3000, name: 'Dup2' });
  check('a different score under the same run id is still the same run: nothing written', hostile.repeat === true && scoreRows() === n1);
  check('a new run id is a new run', post({ ...p1, rid: 'rid-dup-uvwxyz' }).ok === true && scoreRows() === n1 + 1);
}

console.log('\na tournament time no person could have');
{
  reset();
  const t = (score, secs, name) => post({ game: 'tournament', name, score, secs, level: 12, device: 'tour-' + name, rid: 'rid-tour-' + name + '-xx' });
  check('a 5,000-point round in 2 s is refused', bare(t(5000, 2, 'T1')) && lastWhy() === 'tournament-too-fast');
  check('...and in 3 s is accepted', t(5000, 3, 'T2').ok === true);
  check('5,001 points needs two rounds: 5 s refused, 6 s accepted', bare(t(5001, 5, 'T3')) && t(5001, 6, 'T4').ok === true);
  check('60,000 points is twelve rounds: 35 s refused, 36 s accepted', bare(t(60000, 35, 'T5')) && t(60000, 36, 'T6').ok === true);
  check('a score of 0 still took a round: 2 s refused, 3 s accepted', bare(t(0, 2, 'T7')) && t(0, 3, 'T7b').ok === true);
  check('a time that was not sent is not refused (it ranks slowest, which helps nobody)', post({ game: 'tournament', name: 'T8', score: 5000, device: 'tour-T8' }).ok === true);
  check('a negative or unreadable time counts as not sent', post({ game: 'tournament', name: 'T9', score: 5000, secs: -4, device: 'tour-T9' }).ok === true
        && post({ game: 'tournament', name: 'T10', score: 5000, secs: 'soon', device: 'tour-T10' }).ok === true);
  check('only the tournament has a time rule: another game ignores secs', post({ game: 'pack-match', name: 'T11', score: 4700, secs: 1, device: 'tour-T11' }).ok === true);
}

console.log('\nwhat else can arrive in the body');
{
  reset();
  const n0 = scoreRows();
  for (const [label, text] of [['null', 'null'], ['an array', '[]'], ['a string', '"hello"'], ['a number', '5'], ['true', 'true'], ['nothing at all', '']]) {
    const r = raw(text); check(label + ' is refused, bare', bare(r), r);
  }
  check('a body over the size limit is refused before it is read', bare(raw(JSON.stringify({ game: 'match-lab', name: 'Big', score: 1, device: 'd', ua: 'x'.repeat(3000) }))) && reasons().includes('too-large'));
  check('nothing reached the sheet', scoreRows() === n0);
  check('a prototype-pollution body does not pollute or crash', (() => { const r = raw('{"__proto__":{"game":"match-lab"},"name":"P","score":1}'); return bare(r) && ({}).game === undefined; })());
}

console.log('\nan internal failure is generic to the player and detailed in the log');
{
  reset();
  locks.fail = true;
  const r = post({ game: 'pack-match', name: 'Fail', score: 100, device: 'fail-dev' });
  check('the player gets a bare {ok:false}, not the exception text', bare(r) && JSON.stringify(r).indexOf('secret-internal-detail') < 0, r);
  check('the cause is in the Rejected tab', reasons().includes('error') && String(rejected.rows[rejected.rows.length - 1][6]).indexOf('secret-internal-detail') >= 0);
  check('nothing was written and the lock count is back to zero', scoreRows() === 0 && locks.held === 0);
  locks.fail = false;
  check('and the next honest post works', post({ game: 'pack-match', name: 'Fine', score: 100, device: 'fail-dev2' }).ok === true);
}

console.log('\nnothing is written to the leaderboard on a rejection');
{
  reset();
  post({ game: 'match-lab', name: 'Real', score: 500, device: 'real-dev' });
  const before = JSON.stringify(sheet.rows), boardBefore = JSON.stringify(get({ game: 'match-lab', top: 50 }).rows);
  const junk = [{ game: 'nope', name: 'X', score: 1 }, { game: 'match-lab', name: 'X', score: 40001 }, { game: 'match-lab', name: 'X', score: -1 },
                { game: 'match-lab', name: 'X', score: 'abc' }, { game: 'match-lab', name: '=BAD', score: 1.5 }, { game: 'constructor', name: 'X', score: 1 },
                { game: 'match-lab', name: '', score: 1 }, { game: 'match-lab', score: 1 }];
  for (const j of junk) post({ ...j, device: 'junk-dev' });
  check('the Scores tab is byte-for-byte what it was', JSON.stringify(sheet.rows) === before);
  check('the board served to the page is unchanged', JSON.stringify(get({ game: 'match-lab', top: 50 }).rows) === boardBefore);
  check('a forged top score does not appear for any reader', !JSON.stringify(get({ all: '1', top: 50 })).includes('"X"'));
  check('every refusal has a row in Rejected', rejRows() === junk.length, reasons());
  check('a Rejected row has a time, a reason, and what was sent', rejected.rows.slice(1).every(r => r[0] instanceof Date && r[1] && r.length === 7));
}

console.log('\nthe Rejected log is bounded');
{
  reset();
  for (let i = 0; i < 200; i++) post({ game: 'nope', name: 'Flood', score: 1, device: 'bad-dev' });
  check('a flood of bad posts writes at most ' + mod.REJ_LOG_N + ' log rows a minute', rejRows() === mod.REJ_LOG_N, rejRows());
  check('...and nothing reached the board', scoreRows() === 0);
  /* the log trims itself to the newest REJ_KEEP rows */
  reset();
  const rj = tabs.Rejected.rows; while (rj.length < mod.REJ_KEEP + 101) rj.push([new Date(), 'old', '', '', '', '', '']);
  for (let i = 0; i < 50; i++) { cacheStore.delete('rl'); post({ game: 'nope', name: 'Trim', score: 1, device: 'trim-dev' }); }
  check('past ' + mod.REJ_KEEP + ' rows the oldest are dropped (header kept)', rejected.rows.length <= mod.REJ_KEEP + 1 && rejected.rows[0][1] === 'reason', rejected.rows.length);
  check('...and the newest are kept', rejected.rows[rejected.rows.length - 1][1] === 'unknown-game');
}

console.log(ok ? '\nall good' : '\nSOMETHING IS WRONG');
process.exit(ok ? 0 : 1);
