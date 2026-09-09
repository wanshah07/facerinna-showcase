/* Apps Script cannot run here, but most of booth-scores.gs is plain JS. This
   stubs the four Google services it touches and drives doPost/doGet for real,
   against an in-memory sheet. What it is really checking: that the script's
   ranking rule agrees with the page's own bests(), because a booth where the
   popup and the big board disagree is worse than no board. */
import fs from 'fs';
const src = fs.readFileSync('/workspace/facerinna-showcase/tools/booth-scores.gs','utf8');

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
  getLastRow: () => sheet.rows.length + 1,
  appendRow: r => sheet.rows.push(r),
  getRange: (r,c,nr,nc) => ({
    getValues: () => sheet.rows.slice(r-2, r-2+nr).map(x => x.slice(c-1, c-1+nc)),
    setValue: v => { for (let i=r-2;i<r-2+nr;i++) sheet.rows[i][c-1]=v; },
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
check('all=1 covers all five games',     Object.keys(all.games).length === 5);
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

console.log(ok ? '\nall good' : '\nSOMETHING IS WRONG');
process.exit(ok ? 0 : 1);
