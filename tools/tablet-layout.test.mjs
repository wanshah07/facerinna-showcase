/* What a phone and a TABLET actually get, on every page.

   mobile-test.mjs measures one page at five phone widths; rotation.test.mjs
   turns seven pages on their side at one size. Between them sat the gap this
   fills: a tablet, portrait and landscape, on every page the booth publishes
   -- including the four (admin, privacy, the two benchmarks) that no
   responsive test had ever opened.

   It also measures the two things on the front page that are not "does it
   fit": the hero slideshow, which a visitor drives with their thumb, and the
   admin ribbon, which is fixed to the top of the screen directly over a
   header that is also fixed to the top of the screen.

   Excluded from "sticks out", for the same reasons mobile-test.mjs excludes
   them: a child an ancestor clips on purpose, and a position:fixed layer,
   which cannot scroll the page whatever its box says -- the benchmark pages'
   .fr-plane is a blurred backdrop bled past every edge by design. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const {chromium}=pkg;
const DIR='file:///workspace/facerinna-showcase/';
const PAGES=['index.html','admin.html','privacy.html','uv-card.html','lab-run.html','deep-lab.html',
  'match-lab.html','pack-match.html','shelf-shot.html','events/index.html',
  'facerinna-test-reports-claims/index.html','facerinna-test-reports-claims/embed.html',
  'facerinna-benchmark-anon/index.html','facerinna-efficacy-benchmark/index.html'];
/* one phone, then a tablet held both ways, at the two sizes that between them
   cover an iPad, an iPad Pro and the common Android tablets */
const VIEWS=[['phone 390',390,844],['tablet 768',768,1024],
             ['tablet 1024 landscape',1024,768],['tablet 1180 landscape',1180,820]];
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const open_ = async (page, w, h, init) => {
  const c=await b.newContext({viewport:{width:w,height:h},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  if(init) await c.addInitScript(init);
  const p=await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.route('**/*', r=>{const u=r.request().url();
    return (u.startsWith('file://')||u.startsWith('data:')||u.startsWith('blob:'))?r.continue():r.abort();});
  await p.goto(DIR+page,{waitUntil:'load',timeout:25000});
  return {c,p,errs};
};

/* ---------------------------------------------------------------- 1. fit */
console.log('every page, on a phone and on a tablet');
for(const page of PAGES){
  for(const [tag,w,h] of VIEWS){
    const {c,p,errs}=await open_(page,w,h);
    /* scroll the whole page: a lazy image or a chart that only lays out when
       it is reached can be the thing that sticks out */
    await p.evaluate(async()=>{ for(let y=0;y<document.body.scrollHeight;y+=700){
      window.scrollTo(0,y); await new Promise(r=>setTimeout(r,20)); } window.scrollTo(0,0); });
    await p.waitForTimeout(800);
    const r=await p.evaluate(()=>{
      const W=innerWidth, out=[];
      const clipped=el=>{ for(let a=el.parentElement;a;a=a.parentElement){ const o=getComputedStyle(a).overflowX;
        if(o==='hidden'||o==='clip'||o==='auto'||o==='scroll') return true; } return false; };
      for(const el of document.querySelectorAll('body *')){
        const s=getComputedStyle(el);
        if(s.display==='none'||s.visibility==='hidden'||s.position==='fixed') continue;
        const b=el.getBoundingClientRect();
        if(b.width===0&&b.height===0) continue;
        if((b.right>W+1||b.left<-1)&&!clipped(el))
          out.push(el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+'.'+String(el.className||'').trim().split(/\s+/)[0]
                   +` [${Math.round(b.left)}..${Math.round(b.right)}]`);
      }
      return {sw:document.documentElement.scrollWidth, W, out:out.slice(0,4)};
    });
    chk(`${page} @ ${tag}: no sideways scroll`, r.sw<=r.W+1, {scrollWidth:r.sw,width:r.W});
    chk(`${page} @ ${tag}: nothing sticking out`, r.out.length===0, r.out);
    chk(`${page} @ ${tag}: no page errors`, errs.length===0, errs[0]);
    await c.close();
  }
}

/* ------------------------------------------------------- 2. the slideshow */
console.log('\nthe hero slideshow, under a thumb');
for(const [tag,w,h] of VIEWS){
  const {c,p,errs}=await open_('index.html',w,h);
  await p.waitForTimeout(1500);
  const g=await p.evaluate(()=>{
    const q=s=>document.querySelector(s), R=e=>e.getBoundingClientRect();
    const rr=e=>{const b=R(e);return{x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)};};
    const slides=[...document.querySelectorAll('#heroShow .slide')];
    const vis=slides.filter(s=>{const cs=getComputedStyle(s); return cs.visibility!=='hidden'&&+cs.opacity>0.02;});
    const act=slides.find(s=>s.classList.contains('active'));
    return {n:slides.length, visible:vis.length, active:slides.filter(s=>s.classList.contains('active')).length,
      stage:rr(q('.hero-stage')), show:rr(q('#heroShow')), slide:rr(act),
      prev:rr(q('#heroPrev')), next:rr(q('#heroNext')),
      counter:rr(q('#heroCount')), text:q('#heroCount').textContent.trim(), W:innerWidth, H:innerHeight};
  });
  const on = b => b.x>=-1 && b.y>=-1 && b.x+b.w<=g.W+1 && b.y+b.h<=g.H+1;
  const hits = (a,b) => a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y;
  chk(`${tag}: one slide on screen at a time, out of ${g.n}`, g.visible===1&&g.active===1, g);
  /* the slideshow, not the stage: the stage keeps a small padding-bottom of
     its own on a wide screen, and the slide filling the box INSIDE that is
     the correct outcome, not a short slide */
  chk(`${tag}: the slide fills the slideshow`,
      Math.abs(g.slide.w-g.show.w)<=2 && Math.abs(g.slide.h-g.show.h)<=2, {slide:g.slide,show:g.show});
  chk(`${tag}: both arrows are on the screen`, on(g.prev)&&on(g.next), {prev:g.prev,next:g.next,W:g.W,H:g.H});
  /* 34px is what the phone rule sets them to. Below the 44px both platforms
     ask for -- reported rather than changed, since the size is a design
     decision -- but pinned here so it cannot quietly get smaller. */
  chk(`${tag}: the arrows are big enough to press`,
      Math.min(g.prev.w,g.prev.h,g.next.w,g.next.h)>=34, {prev:g.prev,next:g.next});
  chk(`${tag}: no arrow sits on the counter`, !hits(g.prev,g.counter)&&!hits(g.next,g.counter),
      {prev:g.prev,next:g.next,counter:g.counter});
  /* the arrow and the swipe are the two ways through the deck, and a slide
     that will not advance is the same bug either way */
  const first=g.text;
  await p.click('#heroNext'); await p.waitForTimeout(250);
  const afterTap=await p.evaluate(()=>document.querySelector('#heroCount').textContent.trim());
  chk(`${tag}: the arrow moves it on`, afterTap!==first, {from:first,to:afterTap});
  /* A REAL touch, through the browser's own input pipeline -- not a mouse
     drag, and not a synthetic PointerEvent. It has to be: what was broken
     here was that the browser CLAIMED the gesture and cancelled the pointer
     stream, and only a genuine touch reproduces that. A dispatched event
     skips the very stage that failed. */
  const sh=g.show, cy=Math.round(sh.y+sh.h/2), cx=Math.round(sh.x+sh.w/2);
  const cdp=await c.newCDPSession(p);
  const touch=(type,x)=>cdp.send('Input.dispatchTouchEvent',
    {type, touchPoints: type==='touchEnd'?[]:[{x, y:cy, id:1}]});
  await touch('touchStart', cx+120);
  for(const x of [cx+100,cx+60,cx+10,cx-40,cx-90,cx-120]){ await touch('touchMove', x); await new Promise(r=>setTimeout(r,35)); }
  await touch('touchEnd', cx-120);
  await p.waitForTimeout(350);
  const afterSwipe=await p.evaluate(()=>document.querySelector('#heroCount').textContent.trim());
  chk(`${tag}: a finger swipe moves it on`, afterSwipe!==afterTap, {from:afterTap,to:afterSwipe});
  /* the same drag with a mouse, for the laptop in the office: it used to
     start a native image drag, which ends in pointercancel just the same */
  await p.mouse.move(cx+120,cy); await p.mouse.down();
  await p.mouse.move(cx-120,cy,{steps:8}); await p.mouse.up();
  await p.waitForTimeout(300);
  const afterDrag=await p.evaluate(()=>document.querySelector('#heroCount').textContent.trim());
  chk(`${tag}: a mouse drag moves it on too`, afterDrag!==afterSwipe, {from:afterSwipe,to:afterDrag});
  chk(`${tag}: no page errors`, errs.length===0, errs[0]);
  await c.close();
}

/* ---------------------------------------------------- 3. the admin ribbon */
/* Fixed to the top of the screen, at z-index 99999, directly over a header
   that is sticky at the same top:0 -- so until --rb it painted over the
   header instead of making room: 30px of 65 on a tablet, and on a phone,
   where the sentence wraps to two lines, 48px, which is the logo and the
   burger both. Only an admin sees it, which is why it lasted. */
console.log('\nthe admin ribbon and the header underneath it');
const asAdmin = states => ({settings:{page_mode:'open',welcome:'show'}, segments:[], section_states:states});
for(const [tag,w,h] of VIEWS){
  /* a URL that is never reachable: the loader only defines its test hook when
     it has an address to call, and every request is aborted by the route */
  const {c,p,errs}=await open_('index.html',w,h,()=>{ window.__BOOTH_API='https://stub.invalid/exec'; });
  await p.waitForTimeout(900);

  const clean=await p.evaluate(()=>({rb:getComputedStyle(document.documentElement).getPropertyValue('--rb').trim(),
    pad:getComputedStyle(document.body).paddingTop, ribbon:!!document.querySelector('.booth-ribbon')}));
  chk(`${tag}: a visitor gets no ribbon and not one pixel of room for one`,
      !clean.ribbon && clean.pad==='0px' && (clean.rb===''||clean.rb==='0px'), clean);

  await p.evaluate(a=>window.__boothApply(a,true), asAdmin(
    [{id:'qrcore',label:'QR Code',mode:'hidden'},{id:'game',label:'Games',mode:'locked'}]));
  await p.waitForTimeout(400);
  const r=await p.evaluate(()=>{
    const rb=document.querySelector('.booth-ribbon'), hd=document.querySelector('header.nav');
    const R=e=>{const b=e.getBoundingClientRect();return{t:Math.round(b.top),b:Math.round(b.bottom),h:Math.round(b.height)};};
    const brand=document.querySelector('header.nav .brand')||document.querySelector('header.nav a');
    const bb=brand.getBoundingClientRect();
    const at=(x,y)=>{const e=document.elementFromPoint(Math.round(x),Math.round(y));
      return e?e.tagName.toLowerCase()+'.'+String(e.className||'').split(' ')[0]:null;};
    return {ribbon:R(rb), header:R(hd), rbVar:getComputedStyle(document.documentElement).getPropertyValue('--rb').trim(),
      atBrandTop:at(bb.left+bb.width/2, bb.top+2), atBrandMid:at(bb.left+bb.width/2, bb.top+bb.height/2)};
  });
  chk(`${tag}: the ribbon does not cover the header`, r.ribbon.b<=r.header.t, {ribbon:r.ribbon,header:r.header});
  chk(`${tag}: --rb is the ribbon's measured height, not a guess`,
      r.rbVar===r.ribbon.h+'px', {rb:r.rbVar,measured:r.ribbon.h});
  chk(`${tag}: the top of the brand is the brand, not the ribbon`,
      r.atBrandTop!==null && !String(r.atBrandTop).includes('booth-ribbon'), r);
  /* sticky, not static: the header has to still clear the ribbon once the
     page is scrolled, which is the state the admin is actually looking at */
  await p.evaluate(()=>window.scrollTo(0,900)); await p.waitForTimeout(300);
  const sc=await p.evaluate(()=>{
    const R=e=>{const b=e.getBoundingClientRect();return{t:Math.round(b.top),b:Math.round(b.bottom)};};
    return {ribbon:R(document.querySelector('.booth-ribbon')), header:R(document.querySelector('header.nav'))};
  });
  chk(`${tag}: and still does not cover it once the page is scrolled`,
      sc.ribbon.b<=sc.header.t, sc);
  chk(`${tag}: no page errors`, errs.length===0, errs[0]);
  await c.close();
}

/* the deck turns every section into one whole screen, so it cannot take the
   body padding the scrolling page takes -- it puts the ribbon into --slide-top
   instead, and that is a different rule that can rot on its own */
console.log('\nthe ribbon in presentation mode');
for(const [tag,w,h] of [VIEWS[1],VIEWS[2]]){
  const {c,p,errs}=await open_('index.html',w,h,()=>{ window.__BOOTH_API='https://stub.invalid/exec'; });
  await p.waitForTimeout(1200);
  await p.evaluate(a=>window.__boothApply(a,true), asAdmin([{id:'game',label:'Games',mode:'locked'}]));
  await p.evaluate(()=>window.__deck&&window.__deck.on('v'));
  await p.waitForTimeout(900);
  const r=await p.evaluate(()=>{
    const R=e=>{const b=e.getBoundingClientRect();return{t:Math.round(b.top),b:Math.round(b.bottom)};};
    const first=document.querySelector('body.slides > section');
    const cs=first?getComputedStyle(first):null;
    return {deck:document.body.classList.contains('slides'),
      ribbon:R(document.querySelector('.booth-ribbon')), header:R(document.querySelector('header.nav')),
      slideTop:cs?cs.paddingTop:null,
      rb:getComputedStyle(document.documentElement).getPropertyValue('--rb').trim()};
  });
  chk(`${tag}: the deck is on`, r.deck===true, r);
  chk(`${tag}: the ribbon does not cover the header in the deck either`,
      r.ribbon.b<=r.header.t, {ribbon:r.ribbon,header:r.header});
  chk(`${tag}: the first slide starts below the header`,
      parseFloat(r.slideTop) >= r.header.b - 1, {slideTop:r.slideTop, headerBottom:r.header.b});
  chk(`${tag}: no page errors`, errs.length===0, errs[0]);
  await c.close();
}

await b.close();
console.log(bad? '\nSOMETHING IS WRONG' : '\nphone and tablet: every page fits, the slideshow drives, the ribbon keeps off the header');
process.exit(bad?1:0);
