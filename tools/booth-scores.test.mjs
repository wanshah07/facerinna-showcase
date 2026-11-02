/* Apps Script cannot run here, but most of booth-scores.gs is plain JS. This
   stubs the four Google services it touches and drives doPost/doGet for real,
   against an in-memory sheet. What it is really checking: that the script's
   ranking rule agrees with the page's own bests(), because a booth where the
   popup and the big board disagree is worse than no board. */
import fs from 'fs';
import { ROOT, PAGE } from './paths.mjs';
const src = fs.readFileSync(ROOT+'tools/booth-scores.gs','utf8');

const sheet = { rows: [] };
/* Both paths, because the live config is the standalone one: SHEET_ID set and
   the workbook opened by id, so the scoreboard can share a workbook with the
   events registration without the two scripts sharing a project. openById is
   the branch that actually runs now -- stubbing only getActive made this test
   pass on a code path production no longer takes. */
const opened = [];
const book = { getSheetByName: () => api, insertSheet: () => api };
const SpreadsheetApp = {
  getActive: () => book,
  openById: id => { opened.push(id); return book; },
};
const api = {
  /* rows[] holds the header row too, exactly as a real sheet does, so
     getLastRow is the array length and getRange(2,...) starts at rows[1].
     This used to return length+1 with no header in the array, which made
     setUp's `getLastRow() === 0` check never fire and left the two stubs in
     this repo modelling the same API two different ways. */
  getLastRow: () => sheet.rows.length,
  getLastColumn: () => sheet.rows.reduce((m,r)=>Math.max(m,r.length),0),
  appendRow: r => sheet.rows.push(r),
  getRange: (r,c,nr,nc) => ({
    /* r is a 1-based SHEET row against a 0-based array: getRange(2,...) starts
       at rows[1]. This used to slice from r-2, taking the header and dropping
       the last data row, and passed anyway because readAll_ discards any row
       whose game id it does not recognise. A stub that is wrong in a direction
       the code tolerates is a test of nothing. */
    getValues: () => sheet.rows.slice(r-1, r-1+nr).map(x => x.slice(c-1, c-1+nc)),
    setValue: v => { for (let i=r-1;i<r-1+nr;i++) sheet.rows[i][c-1]=v; },
    setFontWeight(){ return this; },
  }),
  setFrozenRows(){}, setColumnWidth(){}, hideColumns(){},
};
const locks = { held:0 };
const LockService = { getScriptLock: () => ({
  waitLock(){ locks.held++; }, releaseLock(){ locks.held--; } }) };
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

const mod = eval(`(() => { ${src}
  return { doPost, doGet, bests_, setUp, hideAllSoFar, readAll_ }; })()`);

const post = o => JSON.parse(mod.doPost({ postData:{ contents: JSON.stringify(o), type:'text/plain' } }));
const get  = q => JSON.parse(mod.doGet({ parameter: q }));

let ok = true;
const check = (label, cond) => { if(!cond) ok = false;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label); };

mod.setUp();

console.log('the workbook it writes to');
check('opened by id, not the bound sheet', opened.length > 0);
check('and it is the id in the config',
      opened[0] === '1J9QAO7PUO4caLhDBsKMGZ5tofv4Gqy5-QSVlo_hBEso');

console.log('\naccepting good runs');
check('first score accepted',            post({game:'match-lab',name:'Ahmad',score:120}).ok === true);
check('second player accepted',          post({game:'match-lab',name:'Siti', score:300}).ok === true);
check('same player, better run',         post({game:'match-lab',name:'Ahmad',score:450}).ok === true);
const r = post({game:'match-lab',name:'Ahmad',score:80});
check('worse run still accepted',        r.ok === true);
check('  ...but best stays the best',    r.best === 450);
check('  ...and rank reflects the best', r.rank === 1);

console.log('\nrefusing what it says it refuses');
check('unknown game',        post({game:'nope',       name:'A', score:1}).error === 'unknown game');
check('empty name',          post({game:'match-lab',  name:'  ', score:1}).error === 'no name');
check('score not a number',  post({game:'match-lab',  name:'A', score:'x'}).ok === false);
check('fractional score',    post({game:'match-lab',  name:'A', score:1.5}).ok === false);
check('negative score',      post({game:'match-lab',  name:'A', score:-5}).error === 'score out of range');
check('absurd score',        post({game:'match-lab',  name:'A', score:999999}).error === 'score out of range');
check('malformed body',      JSON.parse(mod.doPost({postData:{contents:'{oops'}})).error === 'bad json');

console.log('\nrate limit');
let blocked = 0;
for (let i=0;i<20;i++) if (post({game:'lab-run',name:'Spam',score:10}).ok === false) blocked++;
check('a flood from one name is cut off', blocked > 0);
check('a different name is unaffected',   post({game:'lab-run',name:'Calm',score:10}).ok === true);

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
const fRow = sheet.rows.find(r => String(r[3]).indexOf('1+1') >= 0);
check('a leaderboard name that starts with = is stored as text',
  fRow && String(fRow[3]).charAt(0) === "'", fRow && fRow[3]);
check('...and so is the device it came from', fRow && String(fRow[5]).charAt(0) === "'", fRow && fRow[5]);
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
check('the ceiling for a tournament total is 60,000', post({game:'tournament', name:'Big', score:60001, device:'db'}).ok===false && tp({name:'Big', score:60000, secs:1, level:1, device:'db'}).ok===true);

console.log(ok ? '\nall good' : '\nSOMETHING IS WRONG');
process.exit(ok ? 0 : 1);
