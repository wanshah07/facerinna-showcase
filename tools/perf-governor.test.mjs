/* The frame-rate governor, driven with made-up frame times.
   Each game is served with one line added that hands back references to its
   governor; nothing else about the page is changed. */
import fs from 'node:fs';
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const {chromium}=pkg;
const DIR='/workspace/facerinna-showcase/';
const GAMES=['lab-run.html','deep-lab.html','match-lab.html','pack-match.html','shelf-shot.html'];
const A='function perfTick(dtMs){';
const INJ='window.__perf=function(){return {PERF:PERF,tick:perfTick,'+
  'ratio:renderer.getPixelRatio(),shadows:renderer.shadowMap.enabled};};\n'+A;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const feed=(p,n,ms)=>p.evaluate(([n,ms])=>{const {tick}=__perf(); for(let i=0;i<n;i++) tick(ms);},[n,ms]);
const now =p=>p.evaluate(()=>{const s=__perf(); return {ratio:s.ratio,shadows:s.shadows,
  scale:s.PERF.scale,cap:s.PERF.cap,min:s.PERF.min,warm:s.PERF.warm,rounds:s.PERF.rounds,off:s.PERF.shadowsOff};});

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
for(const g of GAMES){
  const src=fs.readFileSync(DIR+g,'utf8');
  if(src.split(A).length-1!==1){ chk(g+': one governor to hook', false); continue; }
  const html=src.replace(A,INJ);
  const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const p=await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.route('**/*', r=>{const u=r.request().url();
    if(u.endsWith('/'+g)) return r.fulfill({contentType:'text/html; charset=utf-8', body:html});
    return (u.startsWith('file://')||u.startsWith('data:')||u.startsWith('blob:'))?r.continue():r.abort();});
  await p.goto('file://'+DIR+g,{waitUntil:'load'});
  await p.waitForTimeout(1800);
  if(!(await p.evaluate(()=>typeof window.__perf==='function'))){ chk(g+': governor reachable', false); await c.close(); continue; }
  /* the page has been rendering, so start from a known place */
  await p.evaluate(()=>{const s=__perf(); s.PERF.warm=0; s.PERF.rounds=0; s.PERF.frames=0;
    s.PERF.acc=0; s.PERF.cooldown=0; s.PERF.shadowsOff=false; s.PERF.scale=s.PERF.cap;});
  const start=await now(p);

  /* 1. the slow opening frames must be ignored, not averaged in */
  await feed(p,19,500);                       // 2fps, and far more than a window
  const warm=await now(p);
  chk(`${g}: the opening frames are thrown away, not judged`,
      warm.scale===start.scale && warm.rounds===0, {scale:warm.scale, rounds:warm.rounds});

  /* 2. after warmup a struggling device is caught inside a dozen frames */
  await feed(p,20,40);                         // 25fps
  const first=await now(p);
  chk(`${g}: a struggling phone is caught within ~12 frames`,
      first.scale < start.scale, {was:start.scale, now:first.scale});

  /* 3. and it keeps stepping down, then drops shadows */
  await feed(p,400,60);                        // 16fps, sustained
  const deep=await now(p);
  /* Read off the renderer, not off the bookkeeping flag beside it. Asserting
     the flag passed happily with the line that actually disables shadows
     deleted -- the governor believed it had done something it had not. */
  chk(`${g}: it goes all the way down and turns shadows off`,
      deep.scale===deep.min && deep.shadows===false && deep.off===true, deep);

  /* 4. a device that is coasting gets its resolution back */
  await feed(p,600,8);                         // 125fps
  const back=await now(p);
  chk(`${g}: and gives the resolution back when there is room`,
      back.scale > deep.scale, {low:deep.scale, now:back.scale});
  chk(`${g}: never past what it started at`, back.scale <= back.cap, back);
  chk(`${g}: no page errors`+(errs.length?': '+errs[0]:''), errs.length===0);
  await c.close();
}
await b.close();
console.log(bad? '\nSOMETHING IS WRONG' : '\nthe governor reacts fast and settles');
process.exit(bad?1:0);
