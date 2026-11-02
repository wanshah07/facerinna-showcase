/* The product beside the board in Magic Tiles and Pack Slicer: a 3D model of a
   FACERINNA pack that starts blank, fills slowly as the score climbs, lights up
   when complete and is replaced by the next product. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8287, BASE='http://127.0.0.1:'+PORT;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++; console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x).slice(0,300):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.jpg':'image/jpeg'};
const srv=http.createServer((q,r)=>{
  const f=decodeURIComponent(new URL(q.url,BASE).pathname), fp=path.join(ROOT,f);
  if(f==='/sw.js'||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ r.writeHead(404); return r.end(); }
  r.writeHead(200,{'Content-Type':TYPES[path.extname(fp)]||'application/octet-stream','Cache-Control':'no-store'}); r.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch();
const GAMES=[{id:'magic-tiles',file:'magic-tiles-4k',hook:'__magictiles'},{id:'pack-slicer',file:'pack-slicer-4k',hook:'__packslicer'}];
const NAMES=['10% Niacinamide 3% TXA Bright Dark Spot Serum','2% Salicylic Acid Acne Serum','Retinol Anti-Aging Serum'];
async function open(G,vp,touch,gift){
  const c=await b.newContext({viewport:vp,isMobile:touch,hasTouch:touch,deviceScaleFactor:touch?2:1});
  await c.route(u=>!u.href.startsWith(BASE),r=>r.abort());
  await c.route(BASE+'/api',async r=>{ let q={}; try{q=JSON.parse(r.request().postData()||'{}')}catch(e){}
    await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(q.action==='config'?{ok:true,settings:{gift_active:'yes'},gift_needs:{[G.id]:gift||0}}:{ok:true})}); });
  await c.addInitScript((api)=>{ window.__BOOTH_API=api; try{ localStorage.setItem('fx.player','Tester'); }catch(e){} },BASE+'/api');
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,120)));
  await p.goto(BASE+'/'+G.file+'.html',{waitUntil:'load'}); await sleep(900);
  return {c,p,errs};
}
const S=(p,G)=>p.evaluate(h=>window[h].snapshot(),G.hook);
/* a run that cannot be lost while the test looks, and scores nothing of its own: the test decides the points */
const keepAlive=(p)=>p.evaluate(()=>{ if(window.__ka) return; window.__ka=setInterval(()=>{ const m=window.__magictiles||window.__packslicer; if(m&&m.snapshot().state==='play') m.refill(); },60); });
const P=async(p,G)=>(await S(p,G)).product;

for(const G of GAMES){
  console.log('\n══ '+G.id+' ══');
  for(const [name,w,h,touch] of [['TV 1920x1080',1920,1080,false],['4K 3840x2160',3840,2160,false],['desktop 1366x768',1366,768,false],['tablet 820x1180',820,1180,true],['phone 390x844',390,844,true],['small phone 360x640',360,640,true],['phone on its side 844x390',844,390,true],['tall kiosk 1080x1920',1080,1920,true]]){
    const {c,p,errs}=await open(G,{width:w,height:h},touch);
    await p.click('#goPlay'); await sleep(700);
    const m=await p.evaluate(()=>{ const R=s=>{ const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return {l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height}; };
      const st=document.getElementById('prodStage'), card=document.getElementById('prodCard');
      return {card:R('#prodCard'),stage:R('#prodStage'),cab:R('#cab'),shown:!!card&&getComputedStyle(card).display!=='none',slices:document.querySelectorAll('#prodStage .fxp-sl').length,
        faces:document.querySelectorAll('#prodStage .fxp-face').length,iw:innerWidth,ih:innerHeight,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight}; });
    const hit=(a,o)=>a&&o&&a.l<o.r-1&&a.r>o.l+1&&a.t<o.b-1&&a.b>o.t+1;
    chk(name+': the product card is there, whole, and clear of the board', m.shown && m.card.l>=-1 && m.card.r<=m.iw+1 && m.card.t>=-1 && m.card.b<=m.ih+1 && !hit(m.card,m.cab), m);
    chk(name+': the model is built (a stack of slices and two faces) and has room ('+Math.round(m.stage.w)+'x'+Math.round(m.stage.h)+')', m.slices>=8 && m.faces===2 && m.stage.h>=60 && m.stage.w>=40, m);
    chk(name+': the page does not scroll', m.sw<=m.iw && m.sh<=m.ih, m);
    chk(name+': no page errors', errs.length===0, errs);
    await c.close();
  }

  console.log('the fill');
  {
    const {c,p,errs}=await open(G,{width:1366,height:768},false);
    await p.click('#goPlay'); await sleep(600); await keepAlive(p);
    let s=await S(p,G);
    chk('it starts blank, on the first product', s.product.shown===0 && s.product.cur===0 && s.productName===NAMES[0], s.product);
    chk('the caption names it and starts at 0%', (await p.textContent('#prodName'))===NAMES[0] && (await p.textContent('#prodPct'))==='0%');
    const goal=s.goal;
    await p.evaluate(([h,n])=>window[h].addScore(n),[G.hook,Math.round(goal*0.5)]);
    await sleep(500);
    let a=(await P(p,G));
    chk('it fills SLOWLY: half a goal scored, a moment later it has only started (shown '+a.shown.toFixed(2)+', heading for '+a.target.toFixed(2)+')', a.shown>0 && a.shown<a.target*0.6, a);
    await p.waitForFunction(h=>{ const p=window[h].snapshot().product; return Math.abs(p.shown-p.target)<0.02; },G.hook,{timeout:15000}).catch(()=>{});
    a=(await P(p,G));
    chk('...and gets there (shown '+a.shown.toFixed(2)+')', Math.abs(a.shown-a.target)<0.02 && a.target>0.4, a);
    chk('the caption follows: '+(await p.textContent('#prodPct'))+', and says what is to go', (await p.textContent('#prodPct'))===Math.round(a.shown*100)+'%' && /to go/.test(await p.textContent('#prodGo')));
    const sc=(await S(p,G)).score;
    await p.evaluate(([h,n])=>window[h].addScore(n),[G.hook,goal-sc+5]);          // passes the goal: level up
    await p.waitForFunction(h=>{ const p=window[h].snapshot().product; return p.done; },G.hook,{timeout:15000}).catch(()=>{});
    a=(await P(p,G));
    chk('passing the goal completes it: full, and lit up', a.done && a.shown>=0.99 && a.cur===0, a);
    chk('...the level has gone up beside it', (await S(p,G)).level===2);
    await p.waitForFunction(h=>window[h].snapshot().product.cur===1,G.hook,{timeout:8000}).catch(()=>{});
    a=(await P(p,G));
    chk('then it is replaced, by itself, with the next product, blank', a.cur===1 && a.shown<0.05 && !a.done && (await S(p,G)).productName===NAMES[1], a);
    chk('...and the caption has moved on', (await p.textContent('#prodName'))===NAMES[1]);
    chk('no page errors', errs.length===0, errs);
    await c.close();
  }
  console.log('a gift run');
  {
    const {c,p,errs}=await open(G,{width:1366,height:768},false,400);
    await p.waitForFunction(h=>window[h].snapshot().giftState==='ready',G.hook,{timeout:6000}).catch(()=>{});
    await p.click('#goGift'); await sleep(700); await keepAlive(p);
    let s=await S(p,G);
    chk('aimed at 400, the model fills towards 400', s.mode==='gift' && s.need===400 && s.product.shown===0, s);
    await p.evaluate(([h])=>window[h].addScore(200),[G.hook]);
    await p.waitForFunction(h=>{ const p=window[h].snapshot().product; return Math.abs(p.shown-p.target)<0.02; },G.hook,{timeout:15000}).catch(()=>{});
    let a=await P(p,G);
    chk('200 of 400 is half a model ('+a.shown.toFixed(2)+')', a.shown>0.4 && a.shown<0.6, a);
    await p.evaluate(([h])=>window[h].addScore(250),[G.hook]);
    await p.waitForFunction(h=>window[h].snapshot().product.done,G.hook,{timeout:15000}).catch(()=>{});
    a=await P(p,G);
    chk('the target reached: the whole product shows, lit up', a.done && a.shown>=0.99, a);
    const cur=a.cur; await sleep(4500);
    a=await P(p,G);
    chk('...and a winner keeps it on show, not replaced', a.done && a.cur===cur && a.shown>=0.99, a);
    chk('no page errors', errs.length===0, errs);
    await c.close();
  }
  console.log('a new run');
  {
    const {c,p}=await open(G,{width:1366,height:768},false);
    await p.click('#goPlay'); await sleep(500); await keepAlive(p);
    await p.evaluate(([h])=>window[h].addScore(300),[G.hook]); await sleep(3000);
    const before=(await P(p,G)).shown;
    await p.evaluate(h=>window[h].start('play'),G.hook); await sleep(900);
    const after=(await P(p,G));
    chk('starting again empties it: '+before.toFixed(2)+' to '+after.shown.toFixed(2), before>0.05 && after.shown<0.02 && after.cur===0, [before,after]);
    await c.close();
  }
}

await b.close(); srv.close();
console.log('\n'+(bad?bad+' FAILED':'all passed')); process.exit(bad?1:0);
