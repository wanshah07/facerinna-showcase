/* A claim the script turns away because it is busy.

   The script does one claim at a time and gives up on the ones left waiting
   after ten seconds, so when a crowd finishes together some get "busy".
   Nothing has been spent, so the visitor must be able to try again -- the
   button used to disappear, leaving a dead end with a score that earned a
   gift. Checked on Facy Run (which carries its own claim code) and on the
   shared fx-gift.js the other games use. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8233, BASE='http://127.0.0.1:'+PORT, API=BASE+'/api';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,ms=8000)=>{ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(80);} return fn(); };

const CFG={ok:true,settings:{page_mode:'open',welcome:'show',gift_active:'yes',games_off:''},segments:[],sections:[],
  section_states:[],gift_games:[],gift_needs:{'facy-run':6000,'lab-run':100},at:Date.now()};
let claims=[];            // what each claim answers, in turn
const asked=[];
const STUB=`<!doctype html><meta charset=utf-8><title>t</title>
<div id="over" class="hidden"><span id="fScore">250</span></div>
<script>window.__BOOTH_API='${API}';window.FX_RANK={id:'lab-run',name:'Lab Run',result:'#over',score:'#fScore'};</script>
<script src="/fx-gift.js"></script>`;
const T={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webp':'image/webp'};
const srv=http.createServer((q,r)=>{
  const u=new URL(q.url,BASE);
  if(u.pathname==='/api'){ let b=''; q.on('data',c=>b+=c); q.on('end',()=>{ let j={}; try{ j=JSON.parse(b||'{}'); }catch(e){}
      asked.push(j.action); let out={ok:false};
      if(j.action==='config') out=CFG;
      else if(j.action==='gift.claim') out=claims.shift()||{ok:false,reason:'error'};
      r.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); r.end(JSON.stringify(out)); }); return; }
  if(u.pathname==='/stub.html'){ r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); r.end(STUB); return; }
  const fp=path.join(ROOT,decodeURIComponent(u.pathname));
  if(u.pathname==='/sw.js'||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ r.writeHead(404); r.end(); return; }
  r.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'}); r.end(fs.readFileSync(fp)); });
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const mk=async()=>{ const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await c.addInitScript(a=>{ window.__BOOTH_API=a; try{ localStorage.setItem('fx.player','Aina'); }catch(e){} }, API);
  await c.route(u=>!u.href.startsWith(BASE), r=>r.abort());        // nothing leaves for the real scripts
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); return {c,p,errs}; };
const GOOD={ok:true,claim:'00000000-0000-4000-8000-000000000042',redeemed:false,product:''};

console.log('Facy Run');
{
  claims=[{ok:false,reason:'busy'},{ok:false,reason:'busy'},GOOD];
  const {c,p,errs}=await mk();
  await p.goto(BASE+'/facy-run.html',{waitUntil:'load'}); await sleep(400);
  await p.click('#fxrGo').catch(()=>{});
  await p.evaluate(()=>{ window.__facy.start(); window.__facy.setScore(6200); window.__facy.end(); });
  chk('a gift-winning run offers the claim button', await until(()=>p.evaluate(()=>document.getElementById('claimBtn').style.display==='inline-block')));
  await p.click('#claimBtn');
  await until(()=>p.evaluate(()=>/Lots of people/.test(document.getElementById('giftTitle').textContent)));
  const v=await p.evaluate(()=>({t:document.getElementById('giftTitle').textContent, x:document.getElementById('giftText').textContent,
    show:document.getElementById('claimBtn').style.display, dis:document.getElementById('claimBtn').disabled, label:document.getElementById('claimBtn').textContent}));
  chk('"busy" says so and that the score is safe', /Lots of people/.test(v.t) && /tap again/i.test(v.x) && /score is safe/i.test(v.x), v);
  chk('...and the button is still there, ready, with its own label', v.show==='inline-block' && v.dis===false && v.label==='Claim my gift', v);
  const n=asked.filter(a=>a==='gift.claim').length;
  await p.click('#claimBtn');
  await until(()=>asked.filter(a=>a==='gift.claim').length>n);              // the second answer has come back
  await until(()=>p.evaluate(()=>!document.getElementById('claimBtn').disabled && document.getElementById('claimBtn').textContent==='Claim my gift'));
  chk('busy twice: still a button, no dead end', await p.evaluate(()=>/Lots of people/.test(document.getElementById('giftTitle').textContent) && document.getElementById('claimBtn').style.display==='inline-block' && !document.getElementById('claimBtn').disabled));
  await p.click('#claimBtn');
  chk('then the claim goes through and the code is shown', await until(()=>p.evaluate(()=>/gift is waiting/i.test(document.getElementById('giftTitle').textContent))));
  const done=await p.evaluate(()=>({code:document.getElementById('claimCode').textContent, btn:document.getElementById('claimBtn').style.display}));
  chk('...with its code, and no button left to press twice', done.code===GOOD.claim && done.btn==='none', done);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\nthe shared gift code (Lab Run, Deep Lab, Match Lab, Pack Match, Shelf Shot)');
{
  claims=[{ok:false,reason:'busy'},GOOD];
  const {c,p,errs}=await mk();
  await p.goto(BASE+'/stub.html',{waitUntil:'load'}); await sleep(300);
  await p.evaluate(()=>document.getElementById('over').classList.remove('hidden'));
  chk('a gift-winning run offers the claim button', await until(()=>p.evaluate(()=>{ const b=document.querySelector('.fxg button'); return !!b && b.style.display==='inline-block'; })));
  await p.click('.fxg button');
  await until(()=>p.evaluate(()=>/Lots of people/.test(document.querySelector('.fxg h4').textContent)));
  const v=await p.evaluate(()=>{ const b=document.querySelector('.fxg button'); return { t:document.querySelector('.fxg h4').textContent,
    x:document.querySelector('.fxg p').textContent, show:b.style.display, dis:b.disabled, label:b.textContent }; });
  chk('"busy" says so and that the score is safe', /Lots of people/.test(v.t) && /tap again/i.test(v.x) && /score is safe/i.test(v.x), v);
  chk('...and the button is still there, ready, with its own label', v.show==='inline-block' && v.dis===false && v.label==='Claim my gift', v);
  await p.click('.fxg button');
  chk('the second try goes through and shows the code', await until(()=>p.evaluate(()=>/gift is waiting/i.test(document.querySelector('.fxg h4').textContent))));
  chk('...with the code on screen', await p.evaluate(()=>document.querySelector('.fxg .fxg-code').textContent==='00000000-0000-4000-8000-000000000042'));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\nthe other failures are as they were');
{
  claims=[{ok:false,reason:'nostock'}];
  const {c,p}=await mk();
  await p.goto(BASE+'/stub.html',{waitUntil:'load'}); await sleep(300);
  await p.evaluate(()=>document.getElementById('over').classList.remove('hidden'));
  await until(()=>p.evaluate(()=>{ const b=document.querySelector('.fxg button'); return !!b && b.style.display==='inline-block'; }));
  await p.click('.fxg button');
  await until(()=>p.evaluate(()=>/all given out/.test(document.querySelector('.fxg h4').textContent)));
  chk('"all given out" still ends it: no button to press, because pressing again cannot help',
      await p.evaluate(()=>document.querySelector('.fxg button').style.display==='none'));
  await c.close();
}

await b.close(); srv.close();
console.log(bad ? '\n'+bad+' FAILED' : '\nall passed');
process.exit(bad?1:0);
