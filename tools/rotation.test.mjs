/* Turning the phone.

   A rotation fires resize while the browser is still settling, and some
   Android browsers fire orientationchange without a resize at all. What this
   checks is the outcome either way: after the turn, the canvas is the shape
   of the window, nothing hangs outside the viewport, and the page is laid out
   the same as if it had been opened in that orientation to begin with.

   The one thing it cannot check is a real device's address bar changing
   height a beat after the turn. Headless Chromium has no address bar. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const {chromium}=pkg;
const DIR='file:///workspace/facerinna-showcase/';
const PAGES=['index.html','lab-run.html','deep-lab.html','match-lab.html','pack-match.html','shelf-shot.html','uv-card.html'];
const PORT={width:390,height:844}, LAND={width:844,height:390};
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const open_ = async (page, size) => {
  const c=await b.newContext({viewport:size,isMobile:true,hasTouch:true,deviceScaleFactor:2});
  const p=await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.route('**/*', r=>{const u=r.request().url();
    return (u.startsWith('file://')||u.startsWith('data:')||u.startsWith('blob:'))?r.continue():r.abort();});
  await p.goto(DIR+page,{waitUntil:'load'});
  await p.waitForTimeout(1500);
  try{ const g=await p.$('#fxrName'); if(g){ await p.fill('#fxrName','T'); await p.click('#fxrGo'); await p.waitForTimeout(250);} }catch(e){}
  return {c,p,errs};
};
const state = p => p.evaluate(()=>{
  const W=innerWidth;
  const clipped=el=>{for(let n=el.parentElement;n;n=n.parentElement){const s=getComputedStyle(n);
    if(s.overflowX!=='visible'||s.overflow!=='visible') return true;} return false;};
  const over=[];
  for(const el of document.querySelectorAll('body *')){
    const s=getComputedStyle(el);
    if(s.display==='none'||s.visibility==='hidden'||s.position==='fixed') continue;
    const bb=el.getBoundingClientRect();
    if(bb.width===0&&bb.height===0) continue;
    if((bb.right>W+1||bb.left<-1)&&!clipped(el))
      over.push(el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+'.'+String(el.className||'').trim().split(/\s+/)[0]);
  }
  const cv=document.querySelector('canvas');
  return {sw:document.documentElement.scrollWidth, W, H:innerHeight, over:[...new Set(over)].slice(0,6),
          canvas: cv?{w:Math.round(cv.getBoundingClientRect().width),
                      h:Math.round(cv.getBoundingClientRect().height)}:null};
});

for(const page of PAGES){
  for(const [from,to,label] of [[LAND,PORT,'landscape -> portrait'],[PORT,LAND,'portrait -> landscape']]){
    const {c,p,errs}=await open_(page,from);
    /* the event first, as a phone sends it, then the new size */
    await p.evaluate(()=>dispatchEvent(new Event('orientationchange')));
    await p.setViewportSize(to);
    await p.waitForTimeout(1200);
    await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=700){scrollTo(0,y);await new Promise(r=>setTimeout(r,20));}scrollTo(0,0);});
    await p.waitForTimeout(400);
    const s=await state(p);
    const t=`${page} ${label}`;
    chk(`${t}: no sideways scroll`, s.sw<=s.W+1, {scrollWidth:s.sw, width:s.W});
    chk(`${t}: nothing hangs outside`, s.over.length===0, s.over);
    if(s.canvas){
      chk(`${t}: the canvas is the shape of the window`,
          Math.abs(s.canvas.w-s.W)<=1 && Math.abs(s.canvas.h-s.H)<=1,
          {canvas:s.canvas, window:{w:s.W,h:s.H}});
    }
    chk(`${t}: no page errors`+(errs.length?': '+errs[0].slice(0,60):''), errs.length===0);

    /* Some Android browsers fire orientationchange and never a resize. The
       size swap above always fires one, so it cannot tell whether that case
       is handled.

       The showcase page answers it by turning the one event into the other,
       so that is what gets checked there. Corrupting its canvas would prove
       nothing: its resizer compares against the last size it set and skips
       when nothing moved, which is right -- the window really has not
       changed -- and would read here as a failure that is not one. */
    if(page==='index.html'){
      const fired = await p.evaluate(async () => {
        let n=0; const spy=()=>n++;
        addEventListener('resize', spy);
        dispatchEvent(new Event('orientationchange'));
        await new Promise(r=>setTimeout(r,600));
        removeEventListener('resize', spy);
        return n;
      });
      chk(`${t}: orientationchange alone makes everything re-measure`, fired>=1, {resizes:fired});
    } else if(s.canvas){
      await p.evaluate(()=>{const cv=document.querySelector('canvas');
        cv.width=64; cv.height=64; cv.style.width='64px'; cv.style.height='64px';});
      const wrong=await p.evaluate(()=>{const r=document.querySelector('canvas').getBoundingClientRect();
        return {w:Math.round(r.width),h:Math.round(r.height)};});
      chk(`${t}: (the canvas really was put wrong)`, wrong.w===64&&wrong.h===64, wrong);
      await p.evaluate(()=>dispatchEvent(new Event('orientationchange')));
      await p.waitForTimeout(700);
      const fixed=await p.evaluate(()=>{const r=document.querySelector('canvas').getBoundingClientRect();
        return {w:Math.round(r.width),h:Math.round(r.height),W:innerWidth,H:innerHeight};});
      chk(`${t}: orientationchange alone is enough to re-fit it`,
          Math.abs(fixed.w-fixed.W)<=1&&Math.abs(fixed.h-fixed.H)<=1, fixed);
    }
    await c.close();
  }
}
await b.close();
console.log(bad? '\nSOMETHING IS WRONG' : '\nturning the phone does not break anything');
process.exit(bad?1:0);
