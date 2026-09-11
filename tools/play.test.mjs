/* Play each game for a while with a synthetic thumb and see whether anything
   comes loose: an error thrown, a score that stops being a number, a game
   that never starts, a result screen that never arrives. Not a substitute for
   a person playing it -- it is the floor, not the ceiling. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const {chromium}=pkg;
const DIR='file:///workspace/facerinna-showcase/';
const GAMES=[
  {f:'lab-run.html',    score:'#score',  start:'#playBtn'},
  {f:'deep-lab.html',   score:null,      start:null},
  {f:'match-lab.html',  score:null,      start:null},
  {f:'pack-match.html', score:null,      start:null},
  {f:'shelf-shot.html', score:null,      start:null},
];
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
for(const g of GAMES){
  const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const p=await c.newPage();
  const errs=[], failed=[];
  p.on('pageerror',e=>errs.push(e.message));
  /* The console only says "Failed to load resource" without naming it, which
     is useless for telling a real missing asset from the service worker not
     existing next to a file:// page. requestfailed carries the URL. */
  p.on('requestfailed',r=>failed.push(r.url()));
  await p.route('**/*', r=>{const u=r.request().url();
    return (u.startsWith('file://')||u.startsWith('data:')||u.startsWith('blob:'))?r.continue():r.abort();});
  await p.goto(DIR+g.f,{waitUntil:'load'});
  await p.waitForTimeout(1800);
  chk(`${g.f}: it loads`, await p.evaluate(()=>!!document.querySelector('canvas')));
  /* the booth asks for a name first */
  const gate=await p.$('#fxrName');
  chk(`${g.f}: the name gate is there`, !!gate);
  if(gate){ await p.fill('#fxrName','Tester'); await p.click('#fxrGo'); await p.waitForTimeout(300); }
  chk(`${g.f}: the gate closes`, !(await p.evaluate(()=>!!document.querySelector('.fxr-gate:not(.hidden)'))));
  /* whatever its start button is called */
  for(const sel of ['#playBtn','#startBtn','#begin','#start button','button.btn']){
    const el=await p.$(sel); if(el){ await el.click().catch(()=>{}); break; }
  }
  await p.waitForTimeout(600);
  /* drive it */
  for(let i=0;i<22;i++){
    const x=90+(i*37)%210, y=380+(i*53)%320;
    await p.mouse.move(x,y);
    await p.mouse.down(); await p.waitForTimeout(60);
    await p.mouse.move(x+(i%2?60:-60), y-(i%3?0:40), {steps:4});
    await p.mouse.up();
    await p.waitForTimeout(90);
  }
  await p.waitForTimeout(1200);
  const st=await p.evaluate(()=>{
    const txt=(document.body.innerText||'');
    const nums=[...document.querySelectorAll('[id]')]
      .filter(e=>/score|final|drops/i.test(e.id))
      .map(e=>({id:e.id, v:(e.textContent||'').trim()}));
    return {nan:/NaN|undefined|Infinity/.test(txt), nums,
            canvas:(()=>{const cv=document.querySelector('canvas');const r=cv.getBoundingClientRect();
                    return {w:Math.round(r.width),h:Math.round(r.height),W:innerWidth,H:innerHeight};})()};
  });
  chk(`${g.f}: nothing on screen says NaN or undefined`, !st.nan);
  const broken=st.nums.filter(n=>/NaN|undefined|Infinity/.test(n.v));
  chk(`${g.f}: every score reads as a number`, broken.length===0, broken);
  chk(`${g.f}: the canvas still fills the window`,
      Math.abs(st.canvas.w-st.canvas.W)<=1 && Math.abs(st.canvas.h-st.canvas.H)<=1, st.canvas);
  chk(`${g.f}: no errors thrown`+(errs.length?': '+errs[0].slice(0,70):''), errs.length===0);
  /* Only the page's own files count. Everything off-origin -- the scoreboard
     endpoint, anything else -- was aborted by this test's own routing, and
     /sw.js cannot exist beside a file:// page at all; flagging those would be
     reporting the test's rules back as the page's faults. */
  const real = failed.filter(u=>u.startsWith('file://') && !/\/sw\.js$/.test(u));
  chk(`${g.f}: nothing failed to load`+(real.length?': '+real[0].slice(0,80):''),
      real.length===0, real.slice(0,3));
  await c.close();
}
await b.close();
console.log(bad? '\nSOMETHING IS WRONG' : '\nall five survive being played');
process.exit(bad?1:0);
