/* What the renderer is actually built with, on a phone and on a desk.
   Antialiasing cannot be read off a setting -- it is a property of the WebGL
   context -- so it is read back from the context itself. */
import fs from 'node:fs';
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const {chromium}=pkg;
const DIR='/workspace/facerinna-showcase/';
const GAMES=['lab-run.html','deep-lab.html','match-lab.html','pack-match.html','shelf-shot.html'];
const A='function perfTick(dtMs){';
const INJ='window.__cfg=function(){var gl=renderer.getContext();'+
  'return {mobile:MOBILE, small:SMALL, shadows:renderer.shadowMap.enabled,'+
  ' aa:!!gl.getContextAttributes().antialias, ratio:renderer.getPixelRatio(),'+
  ' cap:PERF.cap, off:PERF.shadowsOff};};\n'+A;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const read = async (g, ctx) => {
  const src=fs.readFileSync(DIR+g,'utf8');
  if(src.split(A).length-1!==1) return null;
  const c=await b.newContext(ctx);
  const p=await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.route('**/*', r=>{const u=r.request().url();
    if(u.endsWith('/'+g)) return r.fulfill({contentType:'text/html; charset=utf-8', body:src.replace(A,INJ)});
    return (u.startsWith('file://')||u.startsWith('data:')||u.startsWith('blob:'))?r.continue():r.abort();});
  await p.goto('file://'+DIR+g,{waitUntil:'load'});
  await p.waitForTimeout(1800);
  const r=await p.evaluate(()=>typeof __cfg==='function'?__cfg():null);
  await c.close();
  return r && {...r, errs};
};

for(const g of GAMES){
  const phone = await read(g, {viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:3});
  const desk  = await read(g, {viewport:{width:1440,height:900}, isMobile:false, hasTouch:false, deviceScaleFactor:1});
  if(!phone||!desk){ chk(`${g}: readable`, false); continue; }

  chk(`${g}: a phone is recognised as one`, phone.mobile===true, phone);
  chk(`${g}: no multisampling on a phone`, phone.aa===false, {aa:phone.aa});
  chk(`${g}: no shadow maps on a phone`, phone.shadows===false, {shadows:phone.shadows});
  chk(`${g}: the governor does not spend a step on shadows already off`,
      phone.off===true, {shadowsOff:phone.off});
  /* the picture is not made blurrier: the resolution cap is what it was */
  chk(`${g}: the phone still renders at its full cap`,
      phone.ratio>1 && phone.ratio<=1.25+1e-6 && Math.abs(phone.ratio-phone.cap)<1e-6,
      {ratio:phone.ratio, cap:phone.cap});

  chk(`${g}: a desk is not treated as a phone`, desk.mobile===false, {mobile:desk.mobile});
  chk(`${g}: multisampling stays on a desk`, desk.aa===true, {aa:desk.aa});
  chk(`${g}: shadow maps stay on a desk`, desk.shadows===true, {shadows:desk.shadows});
  chk(`${g}: no page errors`+(phone.errs.length?': '+phone.errs[0].slice(0,60):''),
      phone.errs.length===0 && desk.errs.length===0);
}
await b.close();
console.log(bad? '\nSOMETHING IS WRONG' : '\nphones get the cheap picture, desks keep the pretty one');
process.exit(bad?1:0);
