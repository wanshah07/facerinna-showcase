/* Frame timing for the booth games.
   Headless Chromium rasterises on the CPU (SwiftShader), so absolute FPS here
   means nothing about a phone. What does carry over: how much work the main
   thread does per frame in JS, how much garbage a frame makes, and whether
   there are spikes -- those are the same code paths on any device. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const {chromium}=pkg;
const ROOT='file:///workspace/facerinna-showcase/';
const GAMES=process.argv.slice(2).length?process.argv.slice(2)
  :['lab-run.html','deep-lab.html','match-lab.html','pack-match.html','shelf-shot.html'];
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
for(const g of GAMES){
  const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const p=await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(()=>{
    window.__f=[]; window.__long=[]; window.__js=[];
    const raf=window.requestAnimationFrame.bind(window);
    let last=0;
    window.requestAnimationFrame=cb=>raf(t=>{
      if(last) window.__f.push(t-last);
      last=t;
      const s=performance.now(); cb(t); window.__js.push(performance.now()-s);
    });
    try{ new PerformanceObserver(l=>{for(const e of l.getEntries()) window.__long.push(e.duration);})
      .observe({entryTypes:['longtask']}); }catch(e){}
  });
  await p.route('**/*', r=>{const u=r.request().url();
    return (u.startsWith('file://')||u.startsWith('data:')||u.startsWith('blob:'))?r.continue():r.abort();});
  await p.goto(ROOT+g,{waitUntil:'load'});
  await p.waitForTimeout(2500);
  /* start it however this game starts */
  for(const sel of ['#playBtn','#startBtn','#begin','button.play','.start-btn']){
    const el=await p.$(sel); if(el){ await el.click().catch(()=>{}); break; }
  }
  await p.waitForTimeout(500);
  await p.evaluate(()=>{ window.__f.length=0; window.__js.length=0; window.__long.length=0; });
  /* poke it so something actually happens */
  const box=await p.evaluate(()=>({w:innerWidth,h:innerHeight}));
  for(let i=0;i<14;i++){
    await p.mouse.move(box.w/2,box.h*0.7);
    await p.mouse.down(); await p.waitForTimeout(70);
    await p.mouse.move(box.w/2+(i%2?70:-70),box.h*0.7,{steps:6});
    await p.mouse.up(); await p.waitForTimeout(260);
  }
  await p.waitForTimeout(1500);
  const r=await p.evaluate(()=>{
    const s=a=>{const x=[...a].sort((m,n)=>m-n);
      return {n:x.length, med:x[x.length>>1]||0, p95:x[Math.floor(x.length*0.95)]||0, max:x[x.length-1]||0,
              mean:x.reduce((m,n)=>m+n,0)/(x.length||1)};};
    const f=s(window.__f), j=s(window.__js);
    return {f, j, long:window.__long.length, longMax:Math.max(0,...window.__long),
            drops:window.__f.filter(x=>x>33).length,
            mem: performance.memory? Math.round(performance.memory.usedJSHeapSize/1048576):null};
  });
  const fps = r.f.mean? (1000/r.f.mean):0;
  console.log(`${g.padEnd(17)} frames ${String(r.f.n).padStart(4)}  ` +
    `fps~${fps.toFixed(1).padStart(5)}  frame med ${r.f.med.toFixed(1).padStart(5)} p95 ${r.f.p95.toFixed(1).padStart(6)} max ${r.f.max.toFixed(0).padStart(5)}  ` +
    `JS/frame med ${r.j.med.toFixed(2).padStart(5)} p95 ${r.j.p95.toFixed(2).padStart(6)} max ${r.j.max.toFixed(0).padStart(4)}  ` +
    `>33ms ${String(r.drops).padStart(4)}  longtasks ${r.long}` + (errs.length?`  ERRORS ${errs[0].slice(0,50)}`:''));
  await c.close();
}
await b.close();
