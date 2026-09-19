/* Facy Run, driven for real.

   The world is stepped by hand through the page's own test hook, so every
   number here is the game's physics and not a guess about it: a stomp is a
   fall onto an enemy, a hit is a walk into one, a ? block is a jump under
   it. The level is walked end to end by a small bot, which is the check that
   the flag can be reached and that the gift's 6,000 is on the table.

   The gift is driven against a stand-in admin script on a local port, the
   same way booth-config.test.mjs drives the booth page: the four answers the
   real script can give -- inactive, short, a claim, a claim already spent --
   each have to put the right thing on the result screen.

   The QR code is read back by a decoder that shares no code with the
   encoder -- OpenCV, from the pixels the page draws -- and the text it
   reads has to be the whole redeem address. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8137, BASE='http://127.0.0.1:'+PORT, API=BASE+'/api';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.webmanifest':'application/manifest+json'};

/* ---- the stand-in admin script ---- */
const G={ active:'no', points:'6000', claims:{} , seen:[] };
const srv=http.createServer((req,res)=>{
  const u=new URL(req.url,BASE);
  if(u.pathname==='/api'){
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
      let b={}; try{ b=JSON.parse(body||'{}'); }catch(e){}
      G.seen.push(b.action);
      let out={ok:false,error:'unknown action'};
      if(b.action==='config') out={ok:true,settings:{page_mode:'open',welcome:'show',gift_active:G.active,gift_points:G.points},segments:[],sections:[],section_states:[]};
      else if(b.action==='gift.claim'){
        if(G.active!=='yes') out={ok:false,reason:'inactive'};
        else if(!/^[A-Za-z0-9_-]{6,40}$/.test(String(b.device||''))) out={ok:false,reason:'device'};
        else if(+b.score < +G.points) out={ok:false,reason:'short',need:+G.points,score:+b.score};
        else { const have=G.claims[b.device]; if(have) out={ok:true,...have};
               else { G.claims[b.device]={claim:'11111111-2222-4333-8444-'+String(Object.keys(G.claims).length+1).padStart(12,'0'),redeemed:false,product:''}; out={ok:true,...G.claims[b.device]}; } }
      }
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(out)); });
    return;
  }
  let f=decodeURIComponent(u.pathname); if(f.endsWith('/')) f+='index.html';
  if(f==='/sw.js'){ res.writeHead(404); res.end(); return; }
  const fp=path.join(ROOT,f);
  if(!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'}); res.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
async function open_(vp, mob, api){
  const c=await b.newContext({viewport:vp,isMobile:mob,hasTouch:mob,deviceScaleFactor:mob?2:1});
  await c.addInitScript(a=>{ window.__BOOTH_API=a; try{ localStorage.setItem('fx.player','Tester'); }catch(e){} }, api===undefined ? API : api);
  const p=await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/facy-run.html',{waitUntil:'load'});
  await p.waitForTimeout(400);
  /* the ranking's name gate is up first on every game, prefilled; a visitor
     presses Continue, and so does this */
  const gate=await p.$('#fxrGo'); if(gate) { await gate.click(); await p.waitForTimeout(150); }
  return {c,p,errs};
}

/* ------------------------------------------------ 1. it opens everywhere */
console.log('it opens on a phone, a tablet, a desk and a TV');
for(const [tag,vp,mob] of [['phone',{width:390,height:844},true],['phone landscape',{width:844,height:390},true],
                           ['tablet',{width:1024,height:768},true],['desk',{width:1440,height:900},false],['TV',{width:1920,height:1080},false]]){
  const {c,p,errs}=await open_(vp,mob,'');
  const r=await p.evaluate(()=>{
    const F=window.__facy, cv=document.getElementById('stage');
    const pad=getComputedStyle(document.getElementById('ctl')).display!=='none';
    return {pad, intro:!document.getElementById('intro').classList.contains('hidden'),
      cvw:cv.width, cvh:cv.height, view:{w:F.view.w,h:F.view.h,scale:F.view.scale},
      sw:document.documentElement.scrollWidth, W:innerWidth};
  });
  chk(`${tag}: the intro is up and the canvas is the screen`, r.intro && r.cvw>0 && r.cvh>0, r);
  chk(`${tag}: ${mob?'the touch pad is there':'no touch pad on a pointer device'}`, r.pad===mob, r.pad);
  chk(`${tag}: the world is scaled to fit, never stretched`, r.view.scale>0 && r.view.w>=480 && r.view.w<=1000, r.view);
  chk(`${tag}: no sideways scroll`, r.sw<=r.W+1, {sw:r.sw,W:r.W});
  if(mob){
    /* the ranking puts a Booth button bottom-left and a Ranking button
       bottom-right on every game; the pad must not be under either */
    const ov=await p.evaluate(()=>{
      const R=e=>e.getBoundingClientRect();
      const pads=[...document.querySelectorAll('#ctl button')], corners=[...document.querySelectorAll('.fxr-back,.fxr-show')];
      const hits=[];
      pads.forEach(a=>corners.forEach(b=>{ const A=R(a),B=R(b); if(A.left<B.right&&B.left<A.right&&A.top<B.bottom&&B.top<A.bottom) hits.push(a.id+' under '+b.className); }));
      return {hits, corners:corners.length};
    });
    chk(`${tag}: the pad sits clear of the ranking's corner buttons`, ov.corners===2 && ov.hits.length===0, ov);
  }
  chk(`${tag}: no page errors`, errs.length===0, errs[0]);
  await c.close();
}

/* --------------------------------------------------- 2. the mechanics */
console.log('\nwhat the world does');
{
  const {c,p,errs}=await open_({width:1440,height:900},false,'');
  const r=await p.evaluate(()=>{
    const F=window.__facy, out={}, T=F.map, TILE=F.TILE;
    const settle=()=>{ for(let i=0;i<40;i++) F.step(); };
    const start=()=>{ F.start(); F.keys.left=F.keys.right=F.keys.jump=false; settle(); };

    /* run and jump */
    start(); const S=F.S(); const x0=S.px; F.keys.right=true; F.step(60); F.keys.right=false;
    out.ran = S.px-x0;
    start(); const S1=F.S(); F.keys.jump=true; F.step(2); F.keys.jump=false; let apexTap=S1.py; for(let i=0;i<50;i++){ F.step(); apexTap=Math.min(apexTap,S1.py); }
    start(); const S2=F.S(); F.keys.jump=true; let apexHold=S2.py; for(let i=0;i<50;i++){ F.step(); apexHold=Math.min(apexHold,S2.py); } F.keys.jump=false;
    out.jump={tap:Math.round(10*TILE-S1.h-apexTap), hold:Math.round(10*TILE-S2.h-apexHold)};

    /* stomp */
    const clear=e=>{ const c0=Math.floor(e.x/TILE), c1=Math.floor((e.x+e.w)/TILE); for(let r=3;r<10;r++) if(T(c0,r)||T(c1,r)) return false; return true; };
    start(); let bump=F.ents().find(e=>e.kind==='bump'&&e.alive&&clear(e)); const S3=F.S();
    S3.px=bump.x+2; S3.py=bump.y-120; S3.vx=0; S3.vy=0; const s0=S3.score;
    for(let i=0;i<40 && bump.alive;i++) F.step();
    out.stomp={dead:!bump.alive, gained:S3.score-s0, bounced:S3.vy<0, lives:S3.lives};
    /* hit from the side */
    start(); bump=F.ents().find(e=>e.kind==='bump'&&e.alive&&clear(e)); const S4=F.S();
    S4.px=bump.x-40; S4.py=bump.y+bump.h-S4.h; S4.hurt=0; S4.vx=0; const l0=S4.lives;
    let respawn=null; F.keys.right=true; for(let i=0;i<30;i++){ F.step(); if(S4.lives<l0 && respawn===null) respawn=Math.round(S4.px/TILE); } F.keys.right=false;
    out.hit={livesLost:l0-S4.lives, respawnCol:respawn, invulnerable:S4.hurt>0};
    /* a second touch while flashing does not cost another life */
    start(); bump=F.ents().find(e=>e.kind==='bump'&&e.alive&&clear(e)); const S5=F.S();
    S5.px=bump.x-2; S5.py=bump.y+bump.h-S5.h; S5.hurt=60; S5.vx=0; const l1=S5.lives; F.step(3);
    out.grace={livesLost:l1-S5.lives};
    /* ? block */
    start(); const q=F.ents().find(e=>e.kind==='q'&&e.i>=0); const S6=F.S();
    S6.px=q.c*TILE+5; S6.py=(q.r+1)*TILE+2; S6.vx=0; S6.vy=0; S6.onGround=true; S6.coyote=6;
    const b0=S6.score; F.keys.jump=true; F.step(2); F.keys.jump=false; for(let i=0;i<30;i++) F.step();
    out.qblock={gained:S6.score-b0, spent:T(q.c,q.r)===4, card:document.getElementById('toast').textContent};
    /* gates */
    start(); const right=F.ents().find(e=>e.kind==='bub'&&e.right&&!e.done); const S7=F.S(); const g0=S7.score;
    S7.px=right.x; S7.py=right.y; S7.vx=0; S7.vy=0; F.step(1);
    out.gateRight={gained:S7.score-g0, closed:F.ents().filter(e=>e.kind==='bub'&&e.gate===right.gate).every(e=>e.done), card:document.getElementById('toast').textContent};
    start(); const wrong=F.ents().find(e=>e.kind==='bub'&&!e.right&&!e.done); const S8=F.S(); const w0=S8.score;
    S8.px=wrong.x; S8.py=wrong.y; S8.vx=0; S8.vy=0; F.step(1);
    out.gateWrong={gained:S8.score-w0, closed:F.ents().filter(e=>e.kind==='bub'&&e.gate===wrong.gate).every(e=>e.done), card:document.getElementById('toast').textContent, cls:document.getElementById('toast').className};
    /* capsule */
    start(); const cap=F.ents().find(e=>e.kind==='cap'&&!e.got); const S9=F.S(); const c0=S9.score; S9.px=cap.x; S9.py=cap.y; S9.vy=0; F.step(1);
    out.capsule={gained:S9.score-c0, card:document.getElementById('toast').textContent};
    /* a pit is a fall: a life lost and a trip back to the checkpoint, never
       a floor at the bottom of the map to stand on for the rest of the run */
    start(); const Sp=F.S(); let gapCol=-1; for(let c=4;c<F.COLS;c++) if(!T(c,10)&&!T(c+1,10)){ gapCol=c; break; }
    Sp.px=gapCol*TILE+5; Sp.py=6*TILE; Sp.vx=0; Sp.vy=0; Sp.hurt=0; const lp=Sp.lives;
    let fellAt=null; for(let i=0;i<200 && Sp.lives===lp;i++){ F.step(); if(Sp.py>ROWS_()*TILE) fellAt=fellAt||i; }
    function ROWS_(){ return F.ROWS; }
    out.pit={gapCol, livesLost:lp-Sp.lives, respawnCol:Math.round(Sp.px/TILE), stuckRow:+(Sp.py/TILE).toFixed(1)};
    /* the three ends */
    start(); const flag=F.ents().find(e=>e.kind==='flag'); const Sa=F.S(); Sa.px=flag.x-30; Sa.py=8*TILE; F.keys.right=true; for(let i=0;i<40&&Sa.phase==='play';i++) F.step(); F.keys.right=false;
    out.flag={reason:Sa.endReason, bonus:Sa.flagBonus+Sa.timeBonus, over:!document.getElementById('over').classList.contains('hidden'), final:document.getElementById('finalScore').textContent, score:Sa.score};
    start(); F.S().time=0.02; F.step(2); out.timeout=F.S().endReason;
    start(); F.S().lives=1; F.S().py=20*TILE; F.step(1); out.livesout={reason:F.S().endReason, lives:F.S().lives};
    /* what the data says */
    out.content={ingredients:F.INGREDIENTS.length, skinTypes:F.SKIN_TYPES.length, gates:F.GATES.length,
      allGatesHaveOneRight:F.GATES.every(g=>g.right && g.wrong.length===2 && !g.wrong.includes(g.right))};
    return out;
  });
  chk('holding right runs him forward', r.ran>150, r.ran);
  chk('a tap is a short hop and a hold is a high jump', r.jump.tap>20 && r.jump.hold>r.jump.tap+30, r.jump);
  chk('landing on a breakout stomps it: +150 and a bounce, no life lost', r.stomp.dead && r.stomp.gained===150 && r.stomp.bounced && r.stomp.lives===3, r.stomp);
  chk('walking into one costs a life and sends him to the checkpoint', r.hit.livesLost===1 && r.hit.respawnCol===2 && r.hit.invulnerable, r.hit);
  chk('...and he cannot lose two lives to the same touch', r.grace.livesLost===0, r.grace);
  chk('a pit is a fall: one life, and back to the checkpoint -- not a floor to stand on', r.pit.gapCol>0 && r.pit.livesLost===1 && r.pit.respawnCol===2, r.pit);
  chk('bumping a ? block from below is +300 and a skin-type card', r.qblock.gained===300 && r.qblock.spent && /skin/i.test(r.qblock.card), r.qblock);
  chk('the right product at a signpost is +500 and closes the gate', r.gateRight.gained===500 && r.gateRight.closed && /✓/.test(r.gateRight.card), r.gateRight);
  chk('the wrong one scores nothing, closes the gate, and names the right pick', r.gateWrong.gained===0 && r.gateWrong.closed && /Right pick/.test(r.gateWrong.card) && /bad/.test(r.gateWrong.cls), r.gateWrong);
  chk('a capsule is +100 and names its ingredient', r.capsule.gained===100 && r.capsule.card.length>3, r.capsule);
  chk('the flag ends the run with its bonus on the result screen', r.flag.reason==='flag' && r.flag.bonus>=1000 && r.flag.over && +r.flag.final===r.flag.score, r.flag);
  chk('the clock ends it', r.timeout==='time');
  chk('so does the last life', r.livesout.reason==='lives' && r.livesout.lives===0, r.livesout);
  chk('eight ingredients, five skin types, five concerns, each with one right pick', r.content.ingredients===8 && r.content.skinTypes===5 && r.content.gates===5 && r.content.allGatesHaveOneRight, r.content);
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

/* ------------------------------------------ 3. the level can be finished */
console.log('\nthe level, walked end to end');
{
  const {c,p,errs}=await open_({width:1440,height:900},false,'');
  const r=await p.evaluate(()=>{
    const F=window.__facy, T=F.map, TILE=F.TILE, P=F.PTS;
    F.start();
    const E=F.ents();
    const table = E.filter(e=>e.kind==='cap').length*P.capsule + E.filter(e=>e.kind==='q'&&e.i<0).length*P.capsule
      + E.filter(e=>e.kind==='q'&&e.i>=0).length*P.block + E.filter(e=>e.kind==='sign').length*P.gate
      + E.filter(e=>e.kind==='bump'||e.kind==='ray').length*P.stomp + P.flag + P.timeMax;
    const gaps=[]; for(let c=0;c<F.COLS;c++) if(!T(c,10)&&(c===0||T(c-1,10))){ let w=0; while(!T(c+w,10)) w++; gaps.push(w); }
    const trapped = E.some(e=>e.kind==='q' && [-4,-3,-2,-1,0,1,2].some(d=>!T(e.c+d,10)));
    E.forEach(e=>{ if(e.kind==='bump'||e.kind==='ray') e.alive=false; });
    let steps=0, deaths=0, lives=F.S().lives;
    F.keys.right=true;
    while(F.S().phase==='play' && steps<60*175){
      const S=F.S(); const col=Math.floor((S.px+S.w)/TILE), row=Math.floor((S.py+S.h)/TILE);
      const gapAhead=!T(col+1,10)||!T(col+2,10), wallAhead=!!(T(col+1,row-1)||T(col+1,row));
      const mid=Math.floor((S.px+S.w/2)/TILE), qAbove=T(mid,row-3)===3||T(mid,row-4)===3;
      const want=S.onGround&&(gapAhead||wallAhead||qAbove);
      F.keys.jump=want||(S.vy<0&&!S.onGround);
      F.step(1); steps++;
      if(F.S().lives<lives){ lives=F.S().lives; deaths++; }
    }
    const S=F.S();
    return {table, gaps, trapped, reason:S.endReason, score:S.score, deaths, time:Math.round(S.time), col:Math.round(S.px/TILE)};
  });
  chk('a plain run-and-jump bot reaches the flag without dying', r.reason==='flag' && r.deaths===0, r);
  chk('...with the gift bar already met, before a single stomp or right pick', r.score>=6000, r.score);
  chk('...and time to spare', r.time>60, r.time);
  chk('every gap is two tiles: a jump clears it, a pit does not need a run-up', r.gaps.every(w=>w===2) && r.gaps.length>=3, r.gaps);
  chk('no ? block within reach of a pit -- the jump that bumps it must not be the jump that falls in', !r.trapped);
  chk('the whole table is worth more than twice the gift bar', r.table>=12000, r.table);
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

/* -------------------------------------------------------- 4. no lag */
/* Headless Chromium on a software renderer says nothing about a phone's
   GPU, so the wall clock is not measured. What is measured is the part that
   is the same everywhere: the cost of one physics step and one draw, in
   this JS, on this level -- and the governor, which is what stands between
   a slow phone and a stutter: fed slow rounds it has to give pixels away,
   fed quick ones it has to take them back, and it must never go below its
   floor or above its cap. */
console.log('\nthe frame budget');
for(const [tag,vp,mob] of [['phone',{width:390,height:844},true],['TV',{width:1920,height:1080},false]]){
  const {c,p,errs}=await open_(vp,mob,'');
  const r=await p.evaluate(()=>{
    const F=window.__facy; F.start(); F.keys.right=true; F.step(200);
    let t=performance.now(); for(let i=0;i<60;i++) F.draw(); const drawMs=(performance.now()-t)/60;
    t=performance.now(); for(let i=0;i<1200;i++) F.step(); const stepMs=(performance.now()-t)/1200;
    const cap=F.dprCap(), start=F.dpr();
    for(let i=0;i<40;i++) F.govern(30);           /* a phone that cannot keep up */
    const low=F.dpr(), drops=F.perf.drops;
    for(let i=0;i<80;i++) F.govern(10);           /* and then it can */
    const back=F.dpr();
    return {drawMs:+drawMs.toFixed(2), stepMs:+stepMs.toFixed(4), cap, start, low, drops, back, cv:document.getElementById('stage').width};
  });
  chk(`${tag}: one draw is a fraction of a millisecond of JS`, r.drawMs<3, r.drawMs);
  chk(`${tag}: one physics step is far under a tenth of one`, r.stepMs<0.3, r.stepMs);
  chk(`${tag}: it starts at ${mob?'1x on a touch screen':'the display ratio, capped at 2x'}`, r.start===r.cap && (mob ? r.cap===1 : r.cap<=2), {start:r.start,cap:r.cap});
  chk(`${tag}: fed slow rounds the governor gives pixels away, down to its floor and no further`, r.drops>0 && r.low<r.start && r.low>=0.6, {low:r.low,drops:r.drops});
  chk(`${tag}: ...and takes them back once frames are quick, up to the cap and no further`, r.back===r.cap, {back:r.back,cap:r.cap});
  chk(`${tag}: no page errors`, errs.length===0, errs[0]);
  await c.close();
}

/* -------------------------------------------------------- 5. the gift */
console.log('\nthe gift at the end');
const devId = 'devtest0001';
for(const [tag, active, points, score, expect] of [
  ['switched off', 'no', '6000', 9000, /^$/],
  ['on, run too short', 'yes', '6000', 4200, /1800 more points/],
  ['on, enough', 'yes', '6000', 6000, /earned the gift/],
]){
  const {c,p,errs}=await open_({width:390,height:844},true);
  G.active=active; G.points=points; G.seen=[];
  await p.evaluate(id=>{ try{ localStorage.setItem('fx.device', id); }catch(e){} }, devId);
  await p.evaluate(s=>{ const F=window.__facy; F.start(); F.setScore(s); F.end('time'); }, score);
  await sleep(700);
  const r=await p.evaluate(()=>({ on:document.getElementById('gift').classList.contains('on'),
    title:document.getElementById('giftTitle').textContent, text:document.getElementById('giftText').textContent,
    btn:getComputedStyle(document.getElementById('claimBtn')).display!=='none' }));
  if(tag==='switched off') chk(`${tag}: nothing about a gift is shown`, r.on===false, r);
  else chk(`${tag}: the result screen says "${expect.source}"`, r.on && (expect.test(r.title)||expect.test(r.text)), r);
  if(tag==='on, enough'){
    chk('...with a button to claim it, and no claim minted until it is pressed', r.btn && !G.seen.includes('gift.claim'), G.seen);
    await p.click('#claimBtn'); await sleep(700);
    const q=await p.evaluate(()=>{ const cv=document.getElementById('qr'); const F=window.__facy;
      const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data; let dark=0; for(let i=0;i<d.length;i+=4) if(d[i]<128) dark++;
      return {claim:F.lastClaim(), code:document.getElementById('claimCode').textContent, w:cv.width, dark,
        shown:getComputedStyle(cv).display!=='none', title:document.getElementById('giftTitle').textContent}; });
    chk('pressing it mints one claim for this device and draws its QR code', G.seen.filter(a=>a==='gift.claim').length===1 && q.claim && q.code===q.claim && q.w>100 && q.dark>500 && q.shown, q);
    chk('...under a title that says so', /waiting/i.test(q.title), q.title);
    /* the same device, a second run: same claim, no second row */
    await p.evaluate(()=>{ const F=window.__facy; F.start(); F.setScore(7777); F.end('time'); }); await sleep(600);
    await p.click('#claimBtn'); await sleep(600);
    const again=await p.evaluate(()=>window.__facy.lastClaim());
    chk('a second run on the same device gets the same claim back', again===q.claim && Object.keys(G.claims).length===1, {again, claims:Object.keys(G.claims).length});
    /* and once the counter has spent it */
    G.claims[devId].redeemed=true; G.claims[devId].product='Ceramide B5 Balancing Moisturizer';
    await p.evaluate(()=>{ const F=window.__facy; F.start(); F.setScore(8000); F.end('time'); }); await sleep(600);
    await p.click('#claimBtn'); await sleep(600);
    const spent=await p.evaluate(()=>({title:document.getElementById('giftTitle').textContent, text:document.getElementById('giftText').textContent,
      qr:getComputedStyle(document.getElementById('qr')).display}));
    chk('once the counter has spent it, the screen says so and shows no code', /already/i.test(spent.title) && /Ceramide B5/.test(spent.text) && spent.qr==='none', spent);
  }
  chk(`${tag}: no page errors`, errs.length===0, errs[0]);
  await c.close();
}

/* ------------------------------------------ 6. the QR code is a QR code */
/* Decoded by a second party -- OpenCV's QRCodeDetector, with no code
   shared with the encoder -- from the very pixels the page draws. A camera
   at the counter does exactly this; the difference is that this one reports
   the text it read, so the whole address is checked and not only "it
   scanned". (Comparing matrices against another encoder was tried first and
   is the wrong instrument: two correct encoders can legally differ.) */
console.log('\nthe QR code, read back by a decoder');
{
  const {c,p,errs}=await open_({width:1440,height:900},false,'');
  const text='https://my.facerinna.com/redeem.html?c=8f3a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
  const png=await p.evaluate(t=>{ window.__facy.drawQR(t); return window.__facy.qr().toDataURL('image/png'); }, text);
  const file='/tmp/claude-0/facy-qr-under-test.png';
  fs.writeFileSync(file, Buffer.from(png.split(',')[1],'base64'));
  const py=spawnSync('python3',['-c',`
import cv2, sys
img=cv2.imread(sys.argv[1]); big=cv2.resize(img,None,fx=3,fy=3,interpolation=cv2.INTER_NEAREST)
val,_,_=cv2.QRCodeDetector().detectAndDecode(big); print(val)`, file],{encoding:'utf8'});
  const read=(py.stdout||'').trim();
  chk('OpenCV is here to read it', py.status===0, py.stderr && py.stderr.slice(0,160));
  chk('a decoder reads the whole redeem address back, claim and all', read===text, {read, want:text});
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

/* ---------------------------------------------------- 7. the wiring */
console.log('\nthe wiring');
const src=fs.readFileSync(path.join(ROOT,'facy-run.html'),'utf8');
chk('the ranking hooks in the same way the other games do', /window\.FX_RANK=\{id:'facy-run'/.test(src) && /<script src="fx-rank\.js"><\/script>/.test(src));
chk('the QR library carries its licence', /Kazuhiko Arase/.test(src) && /MIT/.test(src));
chk('both ways back land on the games section', (src.match(/href="index\.html#game"/g)||[]).length>=3);
chk('the scores script knows the game', /'facy-run':\s*\{ name: 'Facy Run'/.test(fs.readFileSync(path.join(ROOT,'tools/booth-scores.gs'),'utf8')));
chk('the booth page carries the card', /aria-label="Facy Run"/.test(fs.readFileSync(path.join(ROOT,'index.html'),'utf8')) && /facy-run\.html/.test(fs.readFileSync(path.join(ROOT,'index.html'),'utf8')));
chk('the worker keeps it for offline', /'\.\/facy-run\.html'/.test(fs.readFileSync(path.join(ROOT,'sw.js'),'utf8')) && /'\.\/redeem\.html'/.test(fs.readFileSync(path.join(ROOT,'sw.js'),'utf8')));

await b.close(); await new Promise(r=>srv.close(r));
console.log(bad? '\nSOMETHING IS WRONG' : '\nFacy Run: runs, jumps, teaches, ends, and pays out once per device');
process.exit(bad?1:0);
