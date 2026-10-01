/* The crowd walking behind the welcome band on slide one.

   What it has to do: draw from the embedded sheet with nothing fetched,
   size the crowd to the screen, keep the lettering on top and readable,
   stop ticking when the band is off screen or switched off, and stand
   still for somebody who asked for reduced motion. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8216, BASE='http://127.0.0.1:'+PORT;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const srv=http.createServer((q,r)=>{let f=decodeURIComponent(new URL(q.url,BASE).pathname); if(f==='/') f='/index.html';
  const fp=path.join(ROOT,f);
  if(f==='/sw.js'||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ r.writeHead(404); r.end(); return; }
  r.writeHead(200,{'Content-Type':f.endsWith('.html')?'text/html; charset=utf-8':f.endsWith('.js')?'text/javascript':'application/octet-stream'});
  r.end(fs.readFileSync(fp)); });
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch();

async function open(w,h,opts={}){
  const c=await b.newContext({viewport:{width:w,height:h},isMobile:!!opts.mob,hasTouch:!!opts.mob,reducedMotion:opts.still?'reduce':'no-preference'});
  const outside=[];
  await c.route(u=>!u.href.startsWith(BASE), r=>{ outside.push(r.request().url()); r.abort(); });
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/index.html',{waitUntil:'load'}); await sleep(1500);
  return {c,p,errs,outside};
}
const state=p=>p.evaluate(()=>window.__crowd());
/* how much of the canvas has anything drawn on it */
const ink=p=>p.evaluate(()=>{ const cv=document.querySelector('#top .hm-crowd');
  const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data; let n=0;
  for(let i=3;i<d.length;i+=4) if(d[i]>0) n++; return n/(d.length/4); });
const frame=p=>p.evaluate(()=>{ const cv=document.querySelector('#top .hm-crowd'); return cv.toDataURL(); });

console.log('desk');
{
  const {c,p,errs,outside}=await open(1280,800);
  const s=await state(p);
  chk('the sheet decodes from the page itself', s.ready, s);
  chk('a crowd sized to the band: one figure per ~28px', s.n>=40 && s.n<=50 && s.H>80, s);
  chk('it is walking', s.running, s);
  chk('it draws: a good share of the band has a figure on it', (await ink(p))>0.25);
  const a=await frame(p); await sleep(400); const b2=await frame(p);
  chk('...and the picture changes as they walk', a!==b2);
  const look=await p.evaluate(()=>{ const cv=document.querySelector('#top .hm-crowd'), t=document.querySelector('#top .marquee-track span');
    const cs=getComputedStyle(cv), ts=getComputedStyle(t);
    return { op:+cs.opacity, z:+getComputedStyle(t.parentNode).zIndex, mask:(cs.maskImage||cs.webkitMaskImage||''),
             weight:+ts.fontWeight, size:parseFloat(ts.fontSize), shadow:ts.textShadow, color:ts.color, events:cs.pointerEvents }; });
  chk('faded: the crowd is well under half opacity, and faded at the ends', look.op<0.35 && /gradient/.test(look.mask), look);
  chk('the lettering sits above it, heavy and large, with a dark halo', look.z>=1 && look.weight>=700 && look.size>=30 && /rgba\(8, 22, 40/.test(look.shadow) && look.color==='rgb(255, 255, 255)', look);
  chk('the crowd takes no taps', look.events==='none');
  chk('nothing is fetched for it', outside.filter(u=>/21st|cdpn|gsap|peeps/i.test(u)).length===0, outside);

  await p.evaluate(()=>document.getElementById('game').scrollIntoView()); await sleep(900);
  chk('scrolled away, it stops ticking', !(await state(p)).running);
  await p.evaluate(()=>document.getElementById('top').scrollIntoView({behavior:'instant'}));
  let back=false; for(let i=0;i<30 && !back;i++){ await sleep(150); back=(await state(p)).running; }
  chk('back on screen, it walks again', back, await p.evaluate(()=>({y:scrollY, band:document.querySelector('#top .hero-marquee').getBoundingClientRect().top, vh:innerHeight})));

  await p.evaluate(()=>window.__boothApply && window.__boothApply({settings:{page_mode:'open',welcome:'hide'}}, false));
  await p.evaluate(()=>document.documentElement.classList.add('booth-no-welcome')); await sleep(600);
  chk('with the welcome switched off, it stops too', !(await state(p)).running);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\nphone');
{
  const {c,p,errs}=await open(390,844,{mob:true});
  const s=await state(p);
  chk('fewer figures on a narrow screen, but still a crowd', s.n>=12 && s.n<=16, s);
  const fits=await p.evaluate(()=>{ const r=document.querySelector('#top .hero-marquee').getBoundingClientRect(); return r.bottom<=innerHeight && document.documentElement.scrollWidth<=innerWidth; });
  chk('the band is on the first screen and nothing spills sideways', fits);
  await p.setViewportSize({width:844,height:390}); await sleep(600);
  const t=await state(p);
  chk('turned sideways, the crowd re-fits the band', t.W===844 && t.n>=24, t);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\nreduced motion');
{
  const {c,p,errs}=await open(1280,800,{still:true});
  const s=await state(p);
  chk('drawn, but standing still', s.ready && !s.running, s);
  const a=await frame(p); await sleep(500);
  chk('...the picture does not change', a===await frame(p));
  chk('...and it is still there to see', (await ink(p))>0.25);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

await b.close(); srv.close();
console.log(bad ? '\n'+bad+' FAILED' : '\nall passed');
process.exit(bad?1:0);
