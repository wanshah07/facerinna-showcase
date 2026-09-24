/* The Publication carousel under the gallery.

   What it has to do: show the posters as a filmstrip -- the one in front at
   full height, its neighbours cut to half along a shared top edge -- step
   with keys, a sideways wheel, a drag or a tap on a neighbour, open the one
   in front in a reader at its full resolution, and never catch the page's
   own vertical scroll on the way past. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8191, BASE='http://127.0.0.1:'+PORT;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, ms=6000, step=80){ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(step);} return fn(); }
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.webp':'image/webp','.png':'image/png',
  '.jpg':'image/jpeg','.webmanifest':'application/manifest+json'};
const srv=http.createServer((req,res)=>{
  let f=decodeURIComponent(new URL(req.url,BASE).pathname); if(f.endsWith('/')) f+='index.html';
  if(f==='/sw.js'){ res.writeHead(404); res.end(); return; }
  const fp=path.join(ROOT,f);
  if(!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});
  res.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});

async function open_(w,h,opts={}){
  const c=await b.newContext({viewport:{width:w,height:h},...opts});
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/index.html',{waitUntil:'domcontentloaded'});
  await until(()=>p.evaluate(()=>!!window.__pub).catch(()=>false), 15000);
  await p.evaluate(()=>document.getElementById('pubStage').scrollIntoView({block:'center',behavior:'instant'}));
  await sleep(900);
  return {c,p,errs};
}
const cardsInfo=p=>p.evaluate(()=>[...document.querySelectorAll('#pubTrack .pubx-card')].map(c=>{
  const r=c.getBoundingClientRect(); return {h:Math.round(r.height), top:Math.round(r.top), cur:c.getAttribute('aria-current')};}));
const idx=p=>p.evaluate(()=>window.__pub.index());
const title=p=>p.evaluate(()=>(document.querySelector('#pubHead .pubx-title')||{}).textContent||'');

console.log('the files');
for (const f of ['sn2-serum-poster.webp','sn2-serum-poster-1600.webp','ceramide-panthenol-poster.webp','ceramide-panthenol-poster-1600.webp'])
  chk(f+' is in the repository', fs.existsSync(path.join(ROOT,'publications',f)));

console.log('\nthe filmstrip');
{
  const {c,p,errs}=await open_(1280,900);
  await sleep(700);
  const cs=await cardsInfo(p);
  chk('two posters in the strip', cs.length===2, cs.length);
  chk('the first is the one in front', cs[0].cur==='true' && cs[1].cur==='false', cs);
  chk('...at full height, its neighbour at half', Math.abs(cs[0].h-2*cs[1].h)<=2, cs);
  chk('...along one shared top edge', Math.abs(cs[0].top-cs[1].top)<=1, cs);
  const fill=await p.evaluate(()=>{ const st=document.getElementById('pubStage').getBoundingClientRect();
    const c=document.querySelector('#pubTrack .pubx-card').getBoundingClientRect();
    return c.width*c.height/(st.width*st.height); });
  chk('...and the one in front fills the stage, not an eighth of it', fill>=0.3, Math.round(fill*100)+'%');
  chk('the headline names it', /Salicylic acid/.test(await title(p)), await title(p));
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\nmoving along it');
{
  const {c,p,errs}=await open_(1280,900);
  await p.focus('#pubStage'); await p.keyboard.press('ArrowRight');
  chk('the arrow key steps it', await until(async()=>await idx(p)===1));
  chk('...the headline follows', await until(async()=>/Ceramide/.test(await title(p))), await title(p));
  chk('...and the backdrop takes the new poster\'s colour',
      await until(()=>p.evaluate(()=>{ const l=[...document.querySelectorAll('#pubStage .pubx-bgl.on .pubx-hue')].pop();
        return !!l && getComputedStyle(l).backgroundColor==='rgb(23, 58, 94)'; })));
  await p.keyboard.press('ArrowRight');
  chk('past the end it stays put', await idx(p)===1);
  await p.keyboard.press('Home');
  chk('Home goes back to the first', await until(async()=>await idx(p)===0));

  /* a tap on the neighbour brings it forward and opens nothing */
  await sleep(700);
  await p.click('#pubTrack .pubx-card:nth-child(2)');
  chk('tapping the neighbour brings it forward', await until(async()=>await idx(p)===1));
  chk('...without opening the reader', await p.evaluate(()=>document.getElementById('pubReader').hidden));
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\nthe wheel');
{
  const {c,p,errs}=await open_(1280,900);
  const box=await p.locator('#pubStage').boundingBox();
  await p.mouse.move(box.x+box.width/2, box.y+box.height/2);
  const y0=await p.evaluate(()=>scrollY);
  await p.mouse.wheel(0, 500); await sleep(500);
  const y1=await p.evaluate(()=>scrollY);
  chk('a vertical wheel over it scrolls the page, as it would anywhere', y1>y0, {y0,y1});
  chk('...and does not step the strip', await idx(p)===0);
  await p.evaluate(()=>document.getElementById('pubStage').scrollIntoView({block:'center',behavior:'instant'}));
  await sleep(300);
  const box2=await p.locator('#pubStage').boundingBox();
  await p.mouse.move(box2.x+box2.width/2, box2.y+box2.height/2);
  await p.mouse.wheel(300, 0);
  chk('a sideways wheel steps it', await until(async()=>await idx(p)===1));
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\nthe drag');
{
  const {c,p,errs}=await open_(1280,900);
  await sleep(700);
  const card=await p.locator('#pubTrack .pubx-card').first().boundingBox();
  const sx=card.x+card.width/2, sy=card.y+card.height/2;
  await p.mouse.move(sx,sy); await p.mouse.down();
  for (let i=1;i<=12;i++){ await p.mouse.move(sx-i*25, sy); await sleep(16); }
  await p.mouse.up();
  chk('dragging left brings the next one forward', await until(async()=>await idx(p)===1));
  /* and the other side of the threshold: a small, slow nudge settles back */
  await sleep(900);
  const c2=await p.locator('#pubTrack .pubx-card[aria-current="true"]').boundingBox();
  const nx=c2.x+c2.width/2, ny=c2.y+c2.height/2;
  await p.mouse.move(nx,ny); await p.mouse.down();
  for (let i=1;i<=5;i++){ await p.mouse.move(nx+i*8, ny); await sleep(60); }
  await sleep(200); await p.mouse.up();
  await sleep(900);
  chk('...while a small nudge settles back where it was', await idx(p)===1, await idx(p));
  await sleep(300);
  chk('...and a drag is not a tap: the reader stays shut', await p.evaluate(()=>document.getElementById('pubReader').hidden));
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\nthe reader');
{
  const {c,p,errs}=await open_(1280,900);
  await sleep(700);
  await p.click('#pubTrack .pubx-card:nth-child(1)');
  chk('tapping the one in front opens it', await until(()=>p.evaluate(()=>!document.getElementById('pubReader').hidden)));
  chk('...at its full resolution, not the card copy',
      await until(()=>p.evaluate(()=>{ const i=document.getElementById('pubReaderImg'); return i.complete && i.naturalWidth===2000; })));
  chk('...under the study\'s own title', /Efficacy and Safety of a Combination Serum/.test(
      await p.evaluate(()=>document.getElementById('pubReaderTitle').textContent)));
  chk('...with the page behind it held still', await p.evaluate(()=>document.documentElement.style.overflow==='hidden'));
  await p.keyboard.press('Escape');
  chk('Escape closes it', await until(()=>p.evaluate(()=>document.getElementById('pubReader').hidden)));
  chk('...and gives the page its scroll back', await p.evaluate(()=>document.documentElement.style.overflow===''));
  await p.click('#pubRead');
  chk('the Read button opens the same reader', await until(()=>p.evaluate(()=>!document.getElementById('pubReader').hidden)));
  await p.click('#pubReaderX');
  chk('...and the close button shuts it', await until(()=>p.evaluate(()=>document.getElementById('pubReader').hidden)));
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\non a phone');
{
  const {c,p,errs}=await open_(390,844,{isMobile:true,hasTouch:true});
  await sleep(700);
  const r=await p.evaluate(()=>{
    const st=document.getElementById('pubStage').getBoundingClientRect();
    const cs=[...document.querySelectorAll('#pubTrack .pubx-card')].map(c=>c.getBoundingClientRect());
    return { wide: document.documentElement.scrollWidth>innerWidth+1,
             peek: cs[1] ? Math.round(st.right - cs[1].left) : 0, cardW: Math.round(cs[0].width), vw: innerWidth };
  });
  chk('no sideways scroll', !r.wide, r);
  chk('the next poster still shows at the edge', r.peek>=20, r);
  chk('the card in front leaves the screen room for it', r.cardW <= r.vw*0.82, r);
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\nwith reduced motion');
{
  const {c,p,errs}=await open_(1280,900,{reducedMotion:'reduce'});
  const t=await p.evaluate(()=>getComputedStyle(document.getElementById('pubTrack')).transitionDuration);
  chk('the strip does not glide', /^0s(, 0s)*$/.test(t), t);
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

await b.close(); await new Promise(r=>srv.close(r));
console.log(bad? '\nSOMETHING IS WRONG' : '\ntwo posters, a filmstrip, and a reader that shows every word');
process.exit(bad?1:0);
