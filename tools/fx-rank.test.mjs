import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
import http from 'http'; import fs from 'fs';

const ENDPOINT = 'https://script.google.com/macros/s/AKfycbx4zwbrto2iEUu7T9BMZG7_7VNALN2eNrr_209P9Bll-R1FK6fT0_qg9lJnNyqInJZz/exec';
const rank = fs.readFileSync('/workspace/facerinna-showcase/fx-rank.js','utf8');

/* A minimal stand-in for a game page: a result screen that starts hidden and
   a score element, which is the entire contract fx-rank.js needs. */
const page_ = `<!doctype html><meta charset=utf-8><title>t</title>
<div id="over" class="hidden">over</div><span id="fScore">0</span>
<script>window.FX_RANK={id:'match-lab',name:'Match Lab',result:'#over',score:'#fScore'};</script>
<script src="/fx-rank.js"></script>`;

const srv = http.createServer((q,r)=>{
  if(q.url.startsWith('/fx-rank.js')){ r.writeHead(200,{'Content-Type':'text/javascript'}); return r.end(rank); }
  r.writeHead(200,{'Content-Type':'text/html'}); r.end(page_);
});
await new Promise(r=>srv.listen(0,r)); const P=srv.address().port;
const browser = await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});

let ok = true;
const check=(l,c)=>{ if(!c) ok=false; console.log((c?'  PASS  ':'  FAIL  ')+l); };

/* mode: 'ok' | 'down' | 'hang' | 'refuse' */
async function session(mode, name, seed){
  const ctx = await browser.newContext({viewport:{width:430,height:900}});
  const pg = await ctx.newPage();
  const posts=[], gets=[]; const errs=[];
  pg.on('pageerror',e=>errs.push(String(e)));
  await pg.route('**/*', r=>{
    const u=r.request().url();
    if(u.startsWith(`http://127.0.0.1:${P}`)) return r.continue();
    if(!u.startsWith('https://script.google.com')) return r.abort();
    if(r.request().method()==='POST'){
      posts.push({body:r.request().postDataJSON?.() ?? JSON.parse(r.request().postData()||'{}'),
                  ct: r.request().headers()['content-type']||''});
    } else gets.push(u);
    if(mode==='down')  return r.abort();
    if(mode==='hang')  return new Promise(()=>{});              // never answers
    if(mode==='refuse')return r.fulfill({status:200,contentType:'application/json',
      headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ok:false,error:'score out of range'})});
    return r.fulfill({status:200,contentType:'application/json',
      headers:{'access-control-allow-origin':'*'},
      body:JSON.stringify({ok:true,rank:1,best:999,players:3,
        rows:[{n:'Zara',s:999},{n:'Ken',s:800},{n:name,s:120}]})});
  });
  if(seed) await pg.addInitScript(s=>{
    localStorage.setItem('fx.player', s.name);
    if(s.queue) localStorage.setItem('fx.rank.queue', s.queue);
  }, seed);
  await pg.goto(`http://127.0.0.1:${P}/`,{waitUntil:'domcontentloaded'});
  await pg.waitForTimeout(300);
  /* The name gate always shows, pre-filled for a returning player -- it is a
     confirm-your-name step, not a first-run-only one. Nothing else appears
     until it is submitted, so a test that skips it is testing a screen no
     player ever sees. */
  await pg.fill('#fxrName', name);
  await pg.click('#fxrGo');
  await pg.waitForTimeout(150);
  return {pg, ctx, posts, gets, errs};
}

const play = async (pg, score) => {
  await pg.evaluate(s=>{ document.getElementById('fScore').textContent=String(s);
    document.getElementById('over').classList.remove('hidden'); }, score);
};
const popText = pg => pg.evaluate(()=> (document.querySelector('.fxr-in-pop')||{}).innerText || '');

console.log('endpoint is the new one, not registration');
check('fx-rank.js carries the new deployment', rank.includes('AKfycbx4zwbrto2iEUu'));
check('and not the registration one',        !rank.includes('AKfycbzYlL4-6rWb'));

console.log('\nnetwork up: the score goes out and the shared board comes back');
{
  const s = await session('ok','Ahmad',{name:'Ahmad'});
  await play(s.pg, 120); await s.pg.waitForTimeout(600);
  const t = await popText(s.pg);
  check('posted once',                s.posts.length === 1);
  check('payload has game/name/score', s.posts[0].body.game==='match-lab' &&
                                       s.posts[0].body.name==='Ahmad' && s.posts[0].body.score===120);
  check('device id sent',             !!s.posts[0].body.device);
  check('NO application/json (would trip CORS preflight)',
        !/application\/json/i.test(s.posts[0].ct));
  check('shared names on screen',     t.includes('Zara') && t.includes('Ken'));
  check('labelled as everyone',       t.includes('Everyone at the booth'));
  await s.ctx.close();
}

console.log('\nnetwork down: the popup still works and nothing is lost');
{
  const s = await session('down','Siti',{name:'Siti'});
  await play(s.pg, 77); await s.pg.waitForTimeout(700);
  const t = await popText(s.pg);
  check('own score drawn anyway',     t.includes('Siti') || t.includes('77'));
  check('honest about scope',         t.includes('This device only'));
  check('says it is holding a score', /waiting to send/.test(t));
  const q = await s.pg.evaluate(()=>localStorage.getItem('fx.rank.queue'));
  check('queued to localStorage',     !!q && JSON.parse(q).length === 1);
  await s.ctx.close();
}

console.log('\nnetwork hangs: the popup does not');
{
  const s = await session('hang','Lim',{name:'Lim'});
  const t0 = Date.now();
  await play(s.pg, 55);
  await s.pg.waitForSelector('.fxr-pop.on', {timeout: 4000});
  const drawn = Date.now()-t0;
  const t = await popText(s.pg);
  check('popup up in well under the 8s timeout (' + drawn + 'ms)', drawn < 3000);
  check('shows the local board meanwhile', t.includes('This device only'));
  await s.ctx.close();
}

console.log('\na queue left by an earlier session drains on load');
{
  const q = JSON.stringify([{game:'match-lab',name:'Old',score:11,device:'d1'},
                            {game:'match-lab',name:'Old',score:22,device:'d1'}]);
  const s = await session('ok','Old',{name:'Old',queue:q});
  await s.pg.waitForTimeout(900);
  const left = await s.pg.evaluate(()=>localStorage.getItem('fx.rank.queue'));
  check('both stranded scores sent', s.posts.length >= 2);
  check('queue emptied',             JSON.parse(left||'[]').length === 0);
  await s.ctx.close();
}

console.log('\na refused score is dropped, not retried forever');
{
  const s = await session('refuse','Cheat',{name:'Cheat'});
  await play(s.pg, 99); await s.pg.waitForTimeout(700);
  const q = await s.pg.evaluate(()=>localStorage.getItem('fx.rank.queue'));
  check('not queued (the script said no)', JSON.parse(q||'[]').length === 0);
  await s.ctx.close();
}

console.log('\nopening the board asks for a fresh one');
{
  const s = await session('ok','Ana',{name:'Ana'});
  await s.pg.waitForTimeout(400);
  const before = s.gets.length;
  await s.pg.click('.fxr-show');
  await s.pg.waitForTimeout(500);
  check('a GET on open', s.gets.length > before);
  check('asks for this game', s.gets[s.gets.length-1].includes('game=match-lab'));
  await s.ctx.close();
}

console.log('\nno page errors in any of that');
{
  const s = await session('down','X',{name:'X'});
  await play(s.pg, 5); await s.pg.waitForTimeout(600);
  check('none', s.errs.length === 0);
  if(s.errs.length) console.log('   ', s.errs.slice(0,2));
  await s.ctx.close();
}

console.log(ok ? '\nall good' : '\nSOMETHING IS WRONG');
await browser.close(); srv.close();
process.exit(ok?0:1);
