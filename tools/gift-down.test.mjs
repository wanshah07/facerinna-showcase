/* The gift desk cannot be reached.

   When the booth script is down, a player who finishes a run must still be
   told where to go. If this phone has been on the booth page it holds the
   rules the script last gave (gift on or off, the score each game asks for)
   and acts on them; if it has never heard them, it says only where to go --
   never that a gift is owed, since it cannot know. Checked on Facy Run
   (its own code) and on the shared fx-gift.js the other games and the quiz
   use. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8236, BASE='http://127.0.0.1:'+PORT;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,ms=8000)=>{ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(80);} return fn(); };

const STUB=`<!doctype html><meta charset=utf-8><title>t</title>
<div id="over" class="hidden"><span id="fScore">250</span></div>
<script>window.__BOOTH_API='http://127.0.0.1:1/down';window.FX_RANK={id:'lab-run',name:'Lab Run',result:'#over',score:'#fScore'};</script>
<script src="/fx-gift.js"></script>`;
const T={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webp':'image/webp'};
const srv=http.createServer((q,r)=>{
  const u=new URL(q.url,BASE);
  if(u.pathname==='/stub.html'){ r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); r.end(STUB); return; }
  const fp=path.join(ROOT,decodeURIComponent(u.pathname));
  if(u.pathname==='/sw.js'||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ r.writeHead(404); r.end(); return; }
  r.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'}); r.end(fs.readFileSync(fp)); });
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});

/* what the booth page leaves on a phone: the whole config answer, as it stores it */
const remembered=(active,needs)=>JSON.stringify({at:Date.now(),cfg:{ok:true,settings:{gift_active:active},gift_needs:needs}});
async function phone(saved){
  const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await c.addInitScript(([s])=>{ try{ localStorage.setItem('fx.player','Aina'); if(s) localStorage.setItem('fx.booth.config',s); }catch(e){} }, [saved]);
  await c.route(u=>!u.href.startsWith(BASE), r=>r.abort());          // the booth script is down
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); return {c,p,errs};
}
/* the panel the shared code builds, as a visitor reads it */
const sharedPanel=p=>p.evaluate(()=>{ const x=document.querySelector('.fxg'); if(!x) return null;
  const b=x.querySelector('button'); return { shown:getComputedStyle(x).display!=='none' && !!x.querySelector('h4').textContent,
    t:x.querySelector('h4').textContent, x:x.querySelector('p').textContent, btn:b.style.display==='inline-block' }; });
async function shared(saved){
  const {c,p,errs}=await phone(saved);
  await p.goto(BASE+'/stub.html',{waitUntil:'load'}); await sleep(300);
  await p.evaluate(()=>document.getElementById('over').classList.remove('hidden'));
  await sleep(1500);
  const v=await sharedPanel(p); return {c,p,errs,v};
}
const facyPanel=p=>p.evaluate(()=>{ const g=document.getElementById('gift'); const b=document.getElementById('claimBtn');
  return { shown:g.classList.contains('on'), t:document.getElementById('giftTitle').textContent, x:document.getElementById('giftText').textContent, btn:b.style.display==='inline-block' }; });
async function facy(saved){
  const {c,p,errs}=await phone(saved);
  await p.addInitScript(()=>{ window.__BOOTH_API='http://127.0.0.1:1/down'; });
  await p.goto(BASE+'/facy-run.html',{waitUntil:'load'}); await sleep(400);
  await p.click('#fxrGo').catch(()=>{});
  await p.evaluate(()=>{ window.__facy.start(); window.__facy.setScore(6200); window.__facy.end(); });
  await sleep(2500);
  const v=await facyPanel(p); return {c,p,errs,v};
}

for (const [name, run, panel] of [['the shared gift code (Lab Run, Deep Lab, Match Lab, Pack Match, Shelf Shot, Skin IQ)', shared, sharedPanel],
                                  ['Facy Run', facy, facyPanel]]) {
  console.log(name);
  const score = name==='Facy Run' ? 6200 : 250, bar = name==='Facy Run' ? {'facy-run':6000} : {'lab-run':100};
  const far  = name==='Facy Run' ? {'facy-run':9000} : {'lab-run':500};

  let r = await run(null);
  chk('never heard the rules: says only where to go', r.v.shown && /cannot be checked/i.test(r.v.t) && /show this screen to the FACERINNA team at the counter/i.test(r.v.x), r.v);
  chk('...and promises nothing: no gift owed, no claim button', !/earned|waiting|yours/i.test(r.v.t+' '+r.v.x) && r.v.btn===false, r.v);
  chk('no page errors', r.errs.length===0, r.errs); await r.c.close();

  r = await run(remembered('yes', bar));
  chk('rules remembered, score is enough: the claim is offered as usual', r.v.shown && /earned the gift/i.test(r.v.t) && r.v.btn===true, r.v);
  const clickSel = name==='Facy Run' ? '#claimBtn' : '.fxg button';
  await r.p.click(clickSel);
  await until(()=>r.p.evaluate(()=>/No connection|Could not fetch/i.test((document.querySelector('.fxg h4')||document.getElementById('giftTitle')).textContent)));
  const after=await panel(r.p);
  chk('...tapping it while the desk is down says so, and to go to the counter', /No connection|Could not fetch/i.test(after.t) && /counter/i.test(after.x), after);
  chk('...and a connection that returns can try again (the button stays)', after.btn===true || /Could not fetch/i.test(after.t), after);
  chk('no page errors', r.errs.length===0, r.errs); await r.c.close();

  r = await run(remembered('no', bar));
  chk('rules remembered, gifts off: nothing shown, as when the script answers', !r.v || r.v.shown===false || !r.v.t, r.v);
  await r.c.close();

  r = await run(remembered('yes', far));
  chk('rules remembered, score short of it: the points still to earn', r.v.shown && /Gift at (500|9000)/i.test(r.v.t) && r.v.btn===false, r.v);
  await r.c.close();
  console.log('');
}

await b.close(); srv.close();
console.log(bad ? bad+' FAILED' : 'all passed');
process.exit(bad?1:0);
