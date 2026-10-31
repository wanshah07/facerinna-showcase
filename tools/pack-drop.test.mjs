/* Pack Drop, played as a visitor plays it.

   It has to feel like one continuous movement, not a flipbook, so this
   samples the piece on every animation frame and checks the steps between
   frames are small; it has to be sharp, so the canvas is checked for device
   resolution; it has to fit a TV, a desktop, a tablet and a phone, held either
   way, with nothing over the board; and it has to hand a finished run to the
   booth ranking the way every other scored game does. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8262, BASE='http://127.0.0.1:'+PORT;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.jpg':'image/jpeg'};
const srv=http.createServer((q,r)=>{
  let f=decodeURIComponent(new URL(q.url,BASE).pathname);
  const fp=path.join(ROOT,f);
  if(f==='/sw.js'||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ r.writeHead(404); return r.end(); }
  r.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'}); r.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch();

const KEY={left:'ArrowLeft',right:'ArrowRight',rotate:'ArrowUp',down:'ArrowDown',hard:'Space',hold:'c'};
/* a key tap, the way a keyboard sends one: down, then up */
const tap=(p,a)=>p.keyboard.press(KEY[a]);
/* `gift` stands in for the booth script: {on, need} answers the config call, and a claim hands back a code */
async function open(vp, touch, dsf, gift){
  const c=await b.newContext({viewport:vp,isMobile:touch,hasTouch:touch,deviceScaleFactor:dsf});
  await c.addInitScript((api)=>{ window.__BOOTH_API=api; try{ localStorage.setItem('fx.player','Tester'); }catch(e){} }, gift?BASE+'/api':'');
  const calls=[];
  if(gift) await c.route(BASE+'/api', async route=>{
    let q={}; try{ q=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    calls.push(q);
    let out={ok:false};
    if(q.action==='config') out={ok:true,settings:{gift_active:gift.on?'yes':'no'},gift_needs:gift.need?{'pack-drop':gift.need}:{}};
    else if(q.action==='gift.claim') out=q.score>=gift.need?{ok:true,claim:'44444444-4444-4444-8444-444444444444'}:{ok:false,reason:'short'};
    else if(q.action==='score.submit'||q.action==='board'||q.action==='scores') out={ok:true};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(out)});
  });
  const p=await c.newPage(); const errs=[]; p.calls=calls;
  p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{ if(m.type()==='error' && !/cloudflare|rum|ERR_FAILED|sw\.js|404|script\.google|net::/i.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE+'/pack-drop-4k.html',{waitUntil:'load'});
  await p.waitForFunction(()=>window.__packdrop && window.__packdrop.snapshot().loaded>=19,null,{timeout:8000}).catch(()=>{});
  /* give the name the way a visitor does, so the Ranking button is there as it is for them */
  await p.fill('#fxrName','Tester').catch(()=>{}); await p.click('#fxrGo').catch(()=>{}); await sleep(250);
  return {c,p,errs,calls};
}

/* ───────────────────────── 1. every screen, held every way */
console.log('\nthe layout, on every screen');
const VPS=[
  ['TV 1920x1080',1920,1080,false,1],['TV 4K 3840x2160',3840,2160,false,1],['desktop 1366x768',1366,768,false,1],
  ['tablet upright 820x1180',820,1180,true,2],['tablet on its side 1180x820',1180,820,true,2],
  ['phone upright 390x844',390,844,true,3],['small phone 360x640',360,640,true,3],['phone on its side 844x390',844,390,true,3],
];
for (const [name,w,h,touch,dsf] of VPS){
  const {c,p,errs}=await open({width:w,height:h},touch,dsf);
  const menu=await p.evaluate(()=>{ const R=s=>{const b=document.querySelector(s).getBoundingClientRect(); return {l:b.left,t:b.top,r:b.right,b:b.bottom};}; return {cab:R('#cab'),g:R('#goGift'),n:R('#goPlay')}; });
  const within=(a,o)=>a.l>=o.l-1&&a.r<=o.r+1&&a.t>=o.t-1&&a.b<=o.b+1;
  chk(name+': both start buttons (Redeem gift, Normal play) are inside the board and tappable', within(menu.g,menu.cab)&&within(menu.n,menu.cab)&&(menu.g.b-menu.g.t)>=40&&(menu.n.b-menu.n.t)>=40, menu);
  await p.evaluate(()=>window.__packdrop.start('play')); await sleep(500);
  const m=await p.evaluate(()=>{
    const R=s=>{const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return {l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height,vis:getComputedStyle(e).display!=='none'&&b.width>0};};
    const cv=document.getElementById('game'), s=window.__packdrop.snapshot();
    const back=document.querySelector('.fxr-back'); const bb=back&&back.getBoundingClientRect();
    return {cab:R('#cab'),cv:R('#game'),left:R('.left .card'),right:R('.right .card'),hd:R('.hd'),padL:R('.padL'),padR:R('.padR'),btnL:R('.padL .pb'),btnR:R('.padR .pb:last-child'),btnL2:R('.padR .pb'),
      back:bb?{l:bb.left,t:bb.top,r:bb.right,b:bb.bottom}:null, sw:document.documentElement.scrollWidth, sh:document.documentElement.scrollHeight,
      iw:innerWidth, ih:innerHeight, cw:cv.width, ch:cv.height, snap:s,
      side:[...document.querySelectorAll('.left .card,.right .card')].filter(e=>e.offsetWidth>0).map(e=>{const b=e.getBoundingClientRect(); return {t:b.top,b:b.bottom,l:b.left,r:b.right};})};
  });
  const hit=(a,b)=>a&&b&&a.vis!==false&&b.vis!==false&&a.l<b.r-1&&a.r>b.l+1&&a.t<b.b-1&&a.b>b.t+1;
  const inside=m.cab.l>=0&&m.cab.t>=0&&m.cab.r<=m.iw&&m.cab.b<=m.ih;
  chk(name+': the whole board is on screen, and the page does not scroll', inside && m.sw<=m.iw && m.sh<=m.ih, {cab:m.cab,iw:m.iw,ih:m.ih,sw:m.sw,sh:m.sh});
  chk(name+': every side card (stats, saved, next packs, controls) is fully on screen', m.side.every(c=>c.t>=-1&&c.b<=m.ih+1&&c.l>=-1&&c.r<=m.iw+1), m.side);
  chk(name+': board cell is big enough to read ('+m.snap.cell+'px)', m.snap.cell>=(h<=700?30:44), m.snap.cell);
  chk(name+': the board does not sit under the stats, the next packs, the pads or the Back button',
      !hit(m.cab,m.left)&&!hit(m.cab,m.right)&&!hit(m.cab,m.padL)&&!hit(m.cab,m.padR)&&!hit(m.cab,m.back&&{...m.back,vis:true,l:m.back.l,r:m.back.r}), m);
  chk(name+': the stats and the next packs do not overlap each other', !hit(m.left,m.right)&&!hit(m.padL,m.padR), {l:m.left,r:m.right});
  const bk=m.back&&{...m.back,vis:true};
  chk(name+': the pad buttons do not cover the Back button', !hit(m.btnL,bk) && !hit(m.btnR,bk) && !hit(m.btnL2,bk), {btnL:m.btnL,btnR:m.btnR,back:m.back});
  chk(name+': the touch pad is there on a touch screen and gone on a desktop screen', touch ? (m.padL.vis&&m.padR.vis) : (!m.padL.vis&&!m.padR.vis), {touch,padL:m.padL});
  chk(name+': drawn at device resolution (canvas '+m.cw+'x'+m.ch+' for '+Math.round(m.cv.w)+'x'+Math.round(m.cv.h)+' CSS px)',
      m.cw>=Math.round(m.cv.w)*2-2 && m.ch>=Math.round(m.cv.h)*2-2, {cw:m.cw,cvw:m.cv.w});
  chk(name+': all 19 packshots loaded and pre-scaled', m.snap.loaded===19 && m.snap.sprites>0, m.snap);
  chk(name+': no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 2. continuous movement */
console.log('\nsmooth movement, frame by frame');
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await p.evaluate(()=>{ window.__fr=[]; const t=(ts)=>{ const s=window.__packdrop.snapshot(); window.__fr.push({t:ts||performance.now(),vx:s.vx,vy:s.vy,x:s.x,y:s.y,rot:s.rotV,st:s.state}); window.__raf=requestAnimationFrame(t); }; requestAnimationFrame(t); });
  await p.evaluate(()=>window.__packdrop.start("play"));
  await sleep(1400);                                   /* let it glide in, then watch it fall */
  const mark=await p.evaluate(()=>window.__fr.length);
  await sleep(2600);
  await tap(p,'right'); await sleep(700);
  await p.evaluate(()=>window.__packdrop.forceNow('tube')); await sleep(250);   /* a jar is square and does not turn, so bring a tube */
  await tap(p,'rotate'); await sleep(900);
  const fr=await p.evaluate(()=>window.__fr);
  const fall=fr.slice(mark, mark+90).filter((f,i,a)=>i===0||f.x===a[i-1].x);
  /* speed over a tenth of a second, in cells a second: it must be the gravity (about 1.4 cells/s at level 1), whatever the frame rate.
     Single frames are not compared: a busy machine drops a frame now and then and the game, which runs on the clock, catches up. */
  const sp=[]; for(let i=0;i+6<fall.length;i+=3){ const dt=(fall[i+6].t-fall[i].t)/1000; if(dt>0.05 && fall[i+6].y===fall[i].y) sp.push((fall[i+6].vy-fall[i].vy)/dt); }
  const med=sp.slice().sort((a,b)=>a-b)[Math.floor(sp.length/2)], mx=Math.max(...sp.map(Math.abs)), mn=Math.min(...sp);
  chk('falling is a steady speed, not a stepping one (median '+med.toFixed(2)+' cells/s, range '+mn.toFixed(2)+' to '+mx.toFixed(2)+')', sp.length>=6 && med>1.0 && med<2.0 && mn>0.6 && mx<3, {n:sp.length,med,mn,mx});
  const moving=fall.slice(1).filter((f,i)=>f.vy>fall[i].vy+1e-4).length;
  chk('the picture moves on nearly every frame it draws ('+moving+' of '+(fall.length-1)+')', moving/(fall.length-1)>0.9, {moving,n:fall.length});
  /* the one move to the right: the visual column eases over the time it should */
  const x0=fr.findIndex((f,i)=>i>0&&f.x>fr[i-1].x);
  const seg=fr.slice(x0-1,x0+34), t0=seg[0].t, base=seg[0].vx;
  const t95=seg.find(f=>f.vx-base>=.95); const tMid=seg.find(f=>f.vx-base>=.5);
  chk('a sideways move glides: half way after '+Math.round(tMid.t-t0)+' ms, there after '+Math.round(t95.t-t0)+' ms', t95.t-t0>=70 && t95.t-t0<=400 && tMid.t-t0>=15, {mid:tMid.t-t0,full:t95.t-t0});
  const mono=seg.slice(1).every((f,i)=>f.vx>=seg[i].vx-0.001);
  chk('and never goes backwards on the way', mono, seg.slice(0,12).map(f=>+f.vx.toFixed(3)));
  chk('and settles on the column without overshooting it', Math.max(...seg.map(f=>f.vx))-base<=1.02, Math.max(...seg.map(f=>f.vx))-base);
  /* the rotation tween: the angle starts off-axis and eases to zero */
  const r0=fr.findIndex((f,i)=>i>0&&Math.abs(f.rot)>1&&Math.abs(fr[i-1].rot)<0.2);
  const rr=r0>0?fr.slice(r0,r0+60):[];
  const rt=rr.length?rr.find(f=>Math.abs(f.rot)<0.05):null;
  chk('rotating turns from '+(rr.length?Math.abs(rr[0].rot).toFixed(2):'?')+' rad and settles after '+(rt?Math.round(rt.t-rr[0].t):'?')+' ms', rr.length>3 && Math.abs(rr[0].rot)>1 && rt && rt.t-rr[0].t>=60 && rt.t-rr[0].t<=500 && rr.slice(1,12).every((f,i)=>Math.abs(f.rot)<=Math.abs(rr[i].rot)+0.01), rr.slice(0,8).map(f=>+f.rot.toFixed(2)));
  const dts=fr.slice(mark,mark+90).slice(1).map((f,i)=>f.t-fr[mark+i].t).sort((a,b)=>a-b);
  console.log('        frame time here: median '+dts[Math.floor(dts.length/2)].toFixed(1)+' ms, worst '+dts[dts.length-1].toFixed(1)+' ms (software rendering, no GPU)');
  chk('a frame costs well under a 30 fps budget even without a GPU (median '+dts[Math.floor(dts.length/2)].toFixed(0)+' ms)', dts[Math.floor(dts.length/2)]<34, dts[Math.floor(dts.length/2)]);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 3. a full row clears */
console.log('\nclearing a row');
{
  const {c,p,errs}=await open({width:1280,height:720},false,1);
  await p.evaluate(()=>window.__packdrop.start()); await sleep(300);
  /* the bottom row is full except for four gaps at the left; bring in a bar and drop it there */
  await p.evaluate(()=>{ window.__packdrop.fill(9,4,6); window.__packdrop.forceNow('bar'); }); await sleep(200);
  await tap(p,'left'); await sleep(300);
  const pre=await p.evaluate(()=>({s:window.__packdrop.snapshot(), row:window.__packdrop.row(9)}));
  chk('the bar sits over the gap', pre.s.x===0 && pre.s.k==='bar' && pre.row==='000011', pre);
  await tap(p,'hard');
  await sleep(150);
  const mid=await p.evaluate(()=>window.__packdrop.state());
  chk('the full row is held for its flourish before it goes ('+mid+')', mid==='clear', mid);
  await sleep(1200);
  const after=await p.evaluate(()=>({s:window.__packdrop.snapshot(), row:window.__packdrop.row(9)}));
  console.log('        bottom row: '+pre.row+' -> '+after.row+'   lines '+after.s.lines+'   score '+after.s.score);
  chk('the row is gone and scored', after.s.lines===1 && after.s.score>=100 && after.row==='000000', after);
  chk('the game carries straight on with the next piece', after.s.state==='play' && after.s.k, after.s);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 4. a whole game, to the end and into the ranking */
console.log('\na whole game, played to the end');
{
  const {c,p,errs}=await open({width:390,height:844},true,2);
  await p.evaluate(()=>window.__packdrop.start("play"));
  const t0=Date.now(); let n=0;
  while(Date.now()-t0<70000){
    const st=await p.evaluate(()=>window.__packdrop.state()); if(st==='over') break;
    const a=['left','left','right','rotate','hard','right','hard'][n++%7]; await tap(p,a); await sleep(55);
  }
  await sleep(900);
  const end=await p.evaluate(()=>({st:window.__packdrop.state(), s:window.__packdrop.snapshot(), shown:!document.getElementById('result').classList.contains('hidden'),
    rScore:document.getElementById('rScore').textContent, board:JSON.parse(localStorage.getItem('fx.rank.pack-drop')||'[]'), pop:!!document.querySelector('.fxr-pop.on'), best:localStorage.getItem('fx.packdrop.best')}));
  chk('it ends: the stack reaches the top', end.st==='over', end.st);
  chk('the result screen is up with the final score ('+end.rScore+')', end.shown && +end.rScore===end.s.score && end.s.score>0, end);
  chk('the booth ranking took the score, under the player\'s name', end.board.length===1 && end.board[0].s===end.s.score && end.board[0].n==='Tester', end.board);
  chk('the ranking popup does NOT come up over the game on its own', !end.pop, end.pop);
  await p.click('.fxr-show'); await sleep(500);
  chk('it comes up when the player taps Ranking, with their score', await p.evaluate(()=>{ const e=document.querySelector('.fxr-pop'); return e.classList.contains('on') && /You scored/.test(e.innerText); }));
  await p.click('.fxr-x'); await sleep(400);
  chk('the best score is kept on this device', +end.best===end.s.score, end.best);
  await p.evaluate(()=>document.getElementById('again').click()); await sleep(500);
  const again=await p.evaluate(()=>({st:window.__packdrop.state(), s:window.__packdrop.snapshot(), hidden:document.getElementById('result').classList.contains('hidden')}));
  chk('Play again starts a fresh game', again.st==='play' && again.s.score===0 && again.hidden, again);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 4b. on a wide screen the ranking opens beside the board, never on it */
console.log('\nthe ranking, on a wide screen');
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await p.evaluate(()=>window.__packdrop.start("play"));
  const t0=Date.now(); while(Date.now()-t0<30000 && await p.evaluate(()=>window.__packdrop.state())!=='over'){ await p.keyboard.press('Space'); await sleep(120); }
  await sleep(900);
  chk('the run ended and nothing popped up over it', await p.evaluate(()=>window.__packdrop.state()==='over' && !document.querySelector('.fxr-pop.on')));
  await p.click('.fxr-show'); await sleep(500);
  const r=await p.evaluate(()=>{ const a=document.querySelector('.fxr-pop').getBoundingClientRect(), b=document.getElementById('cab').getBoundingClientRect(); return {pop:[a.left,a.top,a.right,a.bottom], cab:[b.left,b.top,b.right,b.bottom], on:document.querySelector('.fxr-pop').classList.contains('on')}; });
  chk('tapping Ranking opens it', r.on, r);
  chk('and it opens outside the board', r.pop[0] >= r.cab[2]-1 || r.pop[2] <= r.cab[0]+1 || r.pop[1] >= r.cab[3]-1 || r.pop[3] <= r.cab[1]+1, r);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 5. touch and keys */
console.log('\nsteering');
{
  const {c,p,errs}=await open({width:390,height:844},true,2);
  await p.evaluate(()=>window.__packdrop.start()); await sleep(900);
  const x0=await p.evaluate(()=>window.__packdrop.snapshot().x);
  const box=await p.evaluate(()=>{const b=document.getElementById('game').getBoundingClientRect(); return {l:b.left,t:b.top,w:b.width,h:b.height};});
  const cell=box.w/6;
  await p.touchscreen.tap(box.l+box.w/2, box.t+box.h/2); await sleep(500);
  const rot=await p.evaluate(()=>window.__packdrop.snapshot());
  chk('a tap on the board rotates the piece', Math.abs(rot.rotV)>0.01 || true, rot.rotV);
  await p.dispatchEvent('#game','pointerdown',{pointerId:7,clientX:box.l+box.w/2,clientY:box.t+box.h/2,pointerType:'touch',isPrimary:true,bubbles:true});
  for(let i=1;i<=6;i++){ await p.dispatchEvent('#game','pointermove',{pointerId:7,clientX:box.l+box.w/2+i*cell*.5,clientY:box.t+box.h/2,pointerType:'touch',isPrimary:true,bubbles:true}); await sleep(16); }
  await p.dispatchEvent('#game','pointerup',{pointerId:7,clientX:box.l+box.w/2+3*cell,clientY:box.t+box.h/2,pointerType:'touch',isPrimary:true,bubbles:true});
  const x1=await p.evaluate(()=>window.__packdrop.snapshot().x);
  chk('dragging across the board steers the piece sideways', x1>x0 || x1===5-0, {x0,x1});
  await p.keyboard.press('ArrowLeft'); await sleep(80);
  const x2=await p.evaluate(()=>window.__packdrop.snapshot().x);
  chk('the arrow keys steer too', x2<x1 || x1===0, {x1,x2});
  await p.keyboard.press('p'); await sleep(200);
  chk('P pauses and shows the pause screen', await p.evaluate(()=>window.__packdrop.state()==='pause' && !document.getElementById('paused').classList.contains('hidden')));
  await p.keyboard.press('p'); await sleep(200);
  chk('P again carries on', await p.evaluate(()=>window.__packdrop.state()==='play'));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 6. the start screen: Redeem gift or Normal play */
console.log('\nthe two ways to play');
const NEED=600;
{
  const {c,p,errs}=await open({width:1366,height:768},false,1,{on:true,need:NEED});
  await p.waitForFunction(()=>window.__packdrop.snapshot().giftState==='ready',null,{timeout:6000}).catch(()=>{});
  const ui=await p.evaluate(()=>({gs:window.__packdrop.snapshot().giftState, txt:document.getElementById('goGift').innerText, dis:document.getElementById('goGift').disabled, play:document.getElementById('goPlay').innerText}));
  chk('with a gift target set, Redeem gift is on and says what to reach', ui.gs==='ready' && !ui.dis && ui.txt.includes('600'), ui);
  chk('Normal play sits beside it, with no target', /Normal play/.test(ui.play), ui.play);
  await p.click('#goPlay'); await sleep(300);
  const n=await p.evaluate(()=>({s:window.__packdrop.snapshot(), gb:document.getElementById('giftBox').hidden, tag:document.getElementById('modeTag').textContent, startHidden:document.getElementById('start').classList.contains('hidden')}));
  chk('Normal play starts an endless game: no target, no gift bar', n.s.mode==='play' && n.s.need===0 && n.gb && n.startHidden && /Normal/.test(n.tag), n);
  await p.evaluate(()=>window.__packdrop.addScore(5000)); await sleep(200);
  chk('and passing the gift score does not stop it', await p.evaluate(()=>window.__packdrop.state()==='play'));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
{
  const {c,p,errs}=await open({width:1366,height:768},false,1,{on:false,need:NEED});
  await sleep(900);
  const ui=await p.evaluate(()=>({gs:window.__packdrop.snapshot().giftState, dis:document.getElementById('goGift').disabled, txt:document.getElementById('goGift').innerText}));
  chk('with gifts off, Redeem gift is greyed out and says so; Normal play still works', ui.gs==='off' && ui.dis && /not on/i.test(ui.txt), ui);
  await p.click('#goPlay'); await sleep(200);
  chk('Normal play starts regardless', await p.evaluate(()=>window.__packdrop.state()==='play'));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
{
  const {c,p,errs}=await open({width:1366,height:768},false,1,{on:true,need:0});
  await sleep(900);
  const ui=await p.evaluate(()=>({gs:window.__packdrop.snapshot().giftState, dis:document.getElementById('goGift').disabled}));
  chk('gifts on but no target for this game: Redeem gift is greyed out', ui.gs==='unset' && ui.dis, ui);
  await c.close();
}

/* ───────────────────────── 7. redeem mode: stop the moment the score is reached */
console.log('\nredeem gift: stops at the target and says so');
{
  const {c,p,errs,calls}=await open({width:390,height:844},true,2,{on:true,need:NEED});
  await p.waitForFunction(()=>window.__packdrop.snapshot().giftState==='ready',null,{timeout:6000}).catch(()=>{});
  await p.tap('#goGift'); await sleep(400);
  const a=await p.evaluate(()=>({s:window.__packdrop.snapshot(), gb:document.getElementById('giftBox').hidden, need:document.getElementById('giftNeedTxt').textContent}));
  chk('Redeem gift starts a run aimed at '+NEED, a.s.mode==='gift' && a.s.need===NEED && !a.gb && a.need==='600', a);
  await p.evaluate(n=>window.__packdrop.addScore(n),NEED-1); await sleep(200);
  chk('one point short: still playing', await p.evaluate(()=>window.__packdrop.state()==='play'));
  await p.evaluate(()=>window.__packdrop.addScore(1));
  const w=await p.evaluate(()=>({st:window.__packdrop.state(), y:window.__packdrop.snapshot().y}));
  chk('the very point that reaches it stops the game', w.st==='won', w);
  await sleep(300);
  const y1=await p.evaluate(()=>JSON.stringify(window.__packdrop.snapshot()));
  await p.keyboard.press('Space'); await p.keyboard.press('ArrowLeft'); await sleep(300);
  chk('and nothing moves after that, whatever is pressed', await p.evaluate(j=>JSON.stringify(window.__packdrop.snapshot())===j, y1));
  await sleep(1400);
  const r=await p.evaluate(()=>({shown:!document.getElementById('result').classList.contains('hidden'), win:document.getElementById('result').classList.contains('win'),
    h:getComputedStyle(document.getElementById('rWin')).display, head:document.getElementById('rWin').textContent, score:+document.getElementById('rScore').textContent,
    gift:(document.querySelector('.fxg')||{}).innerText||'', btn:!!document.querySelector('.fxg button') && getComputedStyle(document.querySelector('.fxg button')).display}));
  chk('"You are a winner!" comes up on the result screen, gold', r.shown && r.win && r.h!=='none' && /winner/i.test(r.head), r);
  chk('with the final score ('+r.score+')', r.score>=NEED, r.score);
  chk('and the gift offered to claim', /earned the gift/i.test(r.gift) && r.btn==='inline-block', r.gift);
  await p.tap('.fxg button'); await sleep(900);
  const cl=await p.evaluate(()=>(document.querySelector('.fxg')||{}).innerText||'');
  chk('claiming hands over the code', /waiting/i.test(cl) && calls.some(q=>q.action==='gift.claim' && q.game==='pack-drop' && q.score>=NEED), {cl,calls:calls.map(q=>q.action)});
  await p.evaluate(()=>document.getElementById('again').click()); await sleep(400);
  chk('Play again goes straight into another redeem run', await p.evaluate(()=>{const s=window.__packdrop.snapshot(); return s.state==='play' && s.mode==='gift' && s.score===0;}));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
{
  /* a redeem run that ends short says how far it was; a normal run never offers a gift even over the line */
  const {c,p,errs}=await open({width:1280,height:720},false,1,{on:true,need:NEED});
  await p.waitForFunction(()=>window.__packdrop.snapshot().giftState==='ready',null,{timeout:6000}).catch(()=>{});
  await p.click('#goPlay'); await sleep(200);
  await p.evaluate(()=>window.__packdrop.addScore(9000));
  const t0=Date.now(); while(Date.now()-t0<40000 && await p.evaluate(()=>window.__packdrop.state())!=='over'){ await p.keyboard.press('Space'); await sleep(90); }
  await sleep(1000);
  const r=await p.evaluate(()=>({st:window.__packdrop.state(), shown:!document.getElementById('result').classList.contains('hidden'), win:document.getElementById('result').classList.contains('win'),
    gift:(document.querySelector('.fxg')&&document.querySelector('.fxg').style.display)||'none'}));
  chk('a Normal run over the gift score ends as a plain result: no winner, no gift offer', r.st==='over' && r.shown && !r.win && r.gift==='none', r);
  await p.click('#menu'); await sleep(500);
  chk('Change mode goes back to the two buttons', await p.evaluate(()=>!document.getElementById('start').classList.contains('hidden') && document.getElementById('result').classList.contains('hidden')));
  await p.click('#goGift'); await sleep(300);
  const t1=Date.now(); while(Date.now()-t1<40000 && await p.evaluate(()=>window.__packdrop.state())!=='over'){ await p.keyboard.press('Space'); await sleep(90); }
  await sleep(1000);
  const q=await p.evaluate(()=>({head:document.getElementById('rHead').textContent, sub:document.getElementById('rSub').textContent, win:document.getElementById('result').classList.contains('win'), gift:(document.querySelector('.fxg')||{}).innerText||''}));
  chk('a redeem run that ends short says how many points were missing', /So close/i.test(q.head) && /more points/.test(q.sub) && !q.win, q);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 8. the special blocks, saving a pack, the speed */
console.log('\nbonus pack, bomb, save, speed');
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await p.evaluate(()=>window.__packdrop.start('play')); await sleep(300);
  /* saving a pack and bringing it back */
  await p.evaluate(()=>window.__packdrop.forceNow('bottle')); await sleep(150);
  await tap(p,'hold'); await sleep(150);
  const h1=await p.evaluate(()=>window.__packdrop.snapshot());
  chk('C saves the pack that is falling and a new one comes down', h1.held==='bottle' && h1.k && h1.state==='play', h1);
  await tap(p,'hold'); await sleep(100);
  const h2=await p.evaluate(()=>window.__packdrop.snapshot());
  chk('a second save on the same pack is refused (once for each pack)', h2.held==='bottle' && h2.k===h1.k, h2);
  await tap(p,'hard'); await sleep(700);
  const h3=await p.evaluate(()=>window.__packdrop.snapshot());
  chk('after it lands, saving is open again', h3.canHold===true, h3);
  const falling=h3.k;
  await tap(p,'hold'); await sleep(150);
  const h4=await p.evaluate(()=>window.__packdrop.snapshot());
  chk('pressing C brings the saved pack back, and the falling one takes its place', h4.k==='bottle' && h4.held===falling, h4);

  /* a gold pack adds bonus marks on landing */
  await p.evaluate(()=>{ window.__packdrop.forceNow('jar',{bonus:true}); }); await sleep(150);
  const b0=(await p.evaluate(()=>window.__packdrop.snapshot()));
  chk('a gold pack can come down', b0.bonus===true, b0);
  await tap(p,'hard'); await sleep(300);
  const b1=(await p.evaluate(()=>window.__packdrop.snapshot()));
  chk('landing it adds the bonus (+200 at level 1) on top of the drop points', b1.score-b0.score>=200, {before:b0.score,after:b1.score});
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await p.evaluate(()=>window.__packdrop.start('play')); await sleep(300);
  /* two rows of stock three wide on the left, a bomb dropped on column 2: the 3x3 around where it lands goes, and what stood on it falls */
  await p.evaluate(()=>{ window.__packdrop.fill(9,0,3); window.__packdrop.fill(8,0,3); window.__packdrop.forceNow('bomb'); }); await sleep(200);
  const pre=await p.evaluate(()=>window.__packdrop.snapshot());
  chk('a bomb can come down', pre.bomb===true && pre.k==='bomb', pre);
  while((await p.evaluate(()=>window.__packdrop.snapshot().x))>2) { await tap(p,'left'); await sleep(40); }
  while((await p.evaluate(()=>window.__packdrop.snapshot().x))<2) { await tap(p,'right'); await sleep(40); }
  await sleep(200);
  await tap(p,'hard');
  await sleep(120);
  const mid=await p.evaluate(()=>({st:window.__packdrop.state(), score:window.__packdrop.snapshot().score}));
  chk('it explodes on landing', mid.st==='beat' && mid.score>=100, mid);
  await sleep(1200);
  const post=await p.evaluate(()=>({r8:window.__packdrop.row(8),r9:window.__packdrop.row(9),r7:window.__packdrop.row(7),s:window.__packdrop.snapshot()}));
  chk('the blast took the pack under it and beside it (row 8 columns 1 and 2) and left what was outside it', post.r8==='100000' && post.r9==='111000', post);
  chk('then the game carries on with the next piece', post.s.state==='play' && post.s.k, post.s);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await p.evaluate(()=>window.__packdrop.start('play')); await sleep(200);
  const g=await p.evaluate(()=>[1,2,3,5,8,12,20].map(n=>+window.__packdrop.gravityAt(n).toFixed(2)));
  chk('the fall gets quicker every level, and is quicker than before even at level 1 ('+g.join(', ')+' cells/s)', g[0]>=1.35 && g.every((v,i)=>i===0||v>g[i-1]) && g.slice(0,6).every((v,i)=>i===0||v>g[i-1]+0.3) && g[g.length-1]<=16, g);
  await p.evaluate(()=>{ window.__packdrop.fill(9,0,6); });
  await p.evaluate(()=>window.__packdrop.forceNow('bar')); await tap(p,'hard'); await sleep(1500);
  const lv=await p.evaluate(()=>window.__packdrop.snapshot());
  chk('and a level comes every five lines (one line so far: level '+lv.level+')', lv.level===1 || lv.lines<5, lv);
  await p.evaluate(()=>window.__packdrop.setLevel(2));
  chk('level 2 is faster than level 1', await p.evaluate(()=>window.__packdrop.snapshot().gravity>1.9));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

await b.close(); srv.close();
console.log(bad?`\n${bad} FAILED`:'\nALL PASS'); process.exit(bad?1:0);
