/* The tournament from the admin side: the real booth script (Google services
   stubbed, booth-admin-harness.mjs) behind a local server, and the real admin
   page, booth page and lobby in a browser.

   It ships off with no games. Only someone with the Games area can change it.
   The games are kept once, unknown names dropped, Skin IQ and the unscored
   games refused. It cannot be switched on with nothing in it. The admin page
   lists the games easy to hard with their level, saves what is ticked, and
   the booth page and the lobby follow. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { load, OWNER } from './booth-admin-harness.mjs';
import { ROOT } from './paths.mjs';
const {chromium}=pkg;
const PORT=8276, BASE='http://127.0.0.1:'+PORT, API=BASE+'/api';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++; console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, ms=6000, step=80){ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(step);} return fn(); }

const H=load();
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const srv=http.createServer((req,res)=>{
  const u=new URL(req.url,BASE);
  if(u.pathname==='/api'){ let body=''; req.on('data',c=>body+=c); req.on('end',()=>{ let out; try{ out=H.call(JSON.parse(body||'{}')); }catch(e){ out={ok:false,error:String(e.message)}; }
    res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(out)); }); return; }
  let f=decodeURIComponent(u.pathname); if(f.endsWith('/')) f+='index.html';
  const fp=path.join(ROOT,f);
  if(f==='/sw.js'||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'}); res.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const setting=k=>(H.tabs['Settings'].rows.find(r=>r[0]===k)||[])[1];

console.log('the script');
const own=H.signIn(OWNER);
{
  let cfg=H.call({action:'config'});
  chk('it ships off, with no games', cfg.settings.tour_active==='no' && cfg.settings.tour_games==='', cfg.settings);
  let r=H.call({action:'admin.settings',token:own.token,settings:{tour_active:'yes'}});
  chk('it cannot be switched on with nothing in it', r.ok===false && /at least one game/.test(r.error) && setting('tour_active')!=='yes', r);
  r=H.call({action:'admin.settings',token:own.token,settings:{tour_games:'Pack-Recall, magic-tiles;skin-iq uv-card lucky-wheel nope magic-tiles'}});
  chk('games are kept once, unknown and unscored ones dropped (Skin IQ, UV Card, the wheel)', r.ok && setting('tour_games')==='pack-recall,magic-tiles', setting('tour_games'));
  r=H.call({action:'admin.settings',token:own.token,settings:{tour_active:'on'}});
  chk('then it switches on', r.ok && setting('tour_active')==='yes', r);
  H.CACHE.clear();
  cfg=H.call({action:'config'});
  chk('the public config carries both', cfg.settings.tour_active==='yes' && cfg.settings.tour_games==='pack-recall,magic-tiles', cfg.settings);
  H.call({action:'admin.team.save',token:own.token,person:{email:'c@clinic.test',name:'Counter',role:'staff',access:['counter']}});
  const cs=H.signIn('c@clinic.test');
  r=H.call({action:'admin.settings',token:cs.token,settings:{tour_active:'no'}});
  chk('staff without the Games area cannot touch it', r.ok===false && r.area==='games' && setting('tour_active')==='yes', r);
  H.call({action:'admin.settings',token:own.token,settings:{tour_active:'no',tour_games:''}});
}

const b=await chromium.launch();
async function open(url,{admin=null,w=1280,h=900}={}){
  const c=await b.newContext({viewport:{width:w,height:h}});
  await c.route(u=>!u.href.startsWith(BASE),r=>r.abort());
  await c.addInitScript(([a,t])=>{ window.__BOOTH_API=a; try{ localStorage.setItem('fx.player','Aina'); if(t) localStorage.setItem('fx.admin.token',t); }catch(e){} },[API,admin]);
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',d=>d.accept());
  await p.goto(BASE+url,{waitUntil:'load'});
  return {c,p,errs};
}

console.log('\nthe admin page');
{
  const {c,p,errs}=await open('/admin.html',{admin:own.token});
  await until(()=>p.evaluate(()=>document.querySelectorAll('#tourList input').length===12));
  const v=await p.evaluate(()=>({names:[...document.querySelectorAll('#tourList label > span:not(.gone)')].map(e=>e.textContent),
    lv:[...document.querySelectorAll('#tourList em')].map(e=>e.textContent), on:document.getElementById('tourActive').checked,
    ticked:[...document.querySelectorAll('#tourList input')].filter(i=>i.checked).length, count:document.getElementById('tourCount').textContent,
    old:!document.getElementById('tourOld').hidden}));
  chk('the twelve games, easy to hard', v.names.join()==='Magic Tiles,Pack Match,Match Factory,Pack Slicer,Match Lab,Pack Crush,Shelf Shot,Pack Recall,Pack Drop,Deep Lab,Lab Run,Facy Run', v.names);
  chk('...each labelled Easy, Medium or Hard, Pack Recall among the hard ones', v.lv.join()==='Easy,Easy,Easy,Medium,Medium,Medium,Medium,Hard,Hard,Hard,Hard,Hard', v.lv);
  chk('off, nothing ticked, and it says it cannot be switched on', !v.on && v.ticked===0 && /cannot be switched on/.test(v.count) && !v.old, v);
  for(const id of ['facy-run','magic-tiles','pack-crush','pack-recall']) await p.click('#tourList input[data-tour="'+id+'"]');
  chk('ticking counts them', /4 games in the tournament/.test(await p.textContent('#tourCount')));
  await p.click('#gameToggles input[data-game="pack-crush"]');
  chk('a game switched off above is marked as skipped', /skipped/.test(await p.textContent('#tourList li:nth-child(6)')) && /3 games/.test(await p.textContent('#tourCount')));
  await p.click('#gameToggles input[data-game="pack-crush"]');
  await p.check('#tourActive');
  await p.click('#saveSettings');
  await until(()=>setting('tour_active')==='yes');
  chk('Save settings stores it, in the easy-to-hard order', setting('tour_active')==='yes' && setting('tour_games')==='magic-tiles,pack-crush,pack-recall,facy-run', [setting('tour_active'),setting('tour_games')]);
  await p.reload({waitUntil:'load'}); await until(()=>p.evaluate(()=>document.querySelectorAll('#tourList input').length===12)); await sleep(300);
  chk('...and it comes back after a reload', await p.evaluate(()=>document.getElementById('tourActive').checked && [...document.querySelectorAll('#tourList input')].filter(i=>i.checked).map(i=>i.dataset.tour).join()==='magic-tiles,pack-crush,pack-recall,facy-run'));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\nthe booth page and the lobby follow');
{
  H.CACHE.clear();
  const {c,p,errs}=await open('/index.html');
  await until(()=>p.evaluate(()=>!document.getElementById('tourBtn').hidden),8000);
  chk('the booth page shows the Tournament button', /four games, easy to hard/.test(await p.textContent('#tourBtn')));
  chk('no page errors', errs.length===0, errs);
  await c.close();
  const L=await open('/tournament.html');
  await until(()=>L.p.evaluate(()=>!document.getElementById('tLobby').hidden),8000);
  chk('the lobby lists the four, easy to hard', (await L.p.evaluate(()=>[...document.querySelectorAll('#tStages .nm')].map(e=>e.firstChild.textContent).join()))==='Magic Tiles,Pack Crush,Pack Recall,Facy Run');
  chk('no page errors', L.errs.length===0, L.errs);
  await L.c.close();
}

await b.close(); srv.close();
console.log('\n'+(bad?bad+' FAILED':'all passed')); process.exit(bad?1:0);
