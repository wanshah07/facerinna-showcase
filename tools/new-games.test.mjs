/* Magic Tiles, Pack Slicer and Match Factory, played as a visitor plays them.

   For each game: every screen from a TV to a phone on its side (the board is big,
   whole, clear of the corner buttons and drawn at device resolution), the two ways
   to start (Redeem gift and Normal play), the game's own rules, the gift (the run
   stops on the exact point and shows the winner screen), the idle loop, and a page
   with no errors. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8274, BASE='http://127.0.0.1:'+PORT;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++; console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.jpg':'image/jpeg'};
const srv=http.createServer((q,r)=>{
  const f=decodeURIComponent(new URL(q.url,BASE).pathname), fp=path.join(ROOT,f);
  if(f==='/sw.js'||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ r.writeHead(404); return r.end(); }
  r.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'}); r.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch();

const GAMES=[
  {id:'magic-tiles',  hook:'__magictiles',  name:'Magic Tiles'},
  {id:'pack-slicer',  hook:'__packslicer',  name:'Pack Slicer'},
  {id:'match-factory',hook:'__matchfactory',name:'Match Factory'},
];
/* `gift` stands in for the booth script: {on, need} answers the config call */
async function open(G,vp,touch,dsf,gift){
  const c=await b.newContext({viewport:vp,isMobile:touch,hasTouch:touch,deviceScaleFactor:dsf});
  await c.route(u=>!u.href.startsWith(BASE),r=>r.abort());          // never reach the real ranking
  await c.addInitScript((api)=>{ window.__BOOTH_API=api; try{ localStorage.setItem('fx.player','Tester'); }catch(e){}
    window.__rafs=0; const raf=window.requestAnimationFrame.bind(window); window.requestAnimationFrame=cb=>raf(t=>{ window.__rafs++; cb(t); }); }, gift?BASE+'/api':'');
  if(gift) await c.route(BASE+'/api',async route=>{
    let q={}; try{ q=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    let out={ok:false};
    if(q.action==='config') out={ok:true,settings:{gift_active:gift.on?'yes':'no'},gift_needs:gift.need?{[G.id]:gift.need}:{}};
    else if(q.action==='gift.claim') out=q.score>=gift.need?{ok:true,claim:'44444444-4444-4444-8444-444444444444'}:{ok:false,reason:'short'};
    else out={ok:true};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(out)});
  });
  const p=await c.newPage(); const errs=[];
  p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{ if(m.type()==='error' && !/cloudflare|rum|ERR_FAILED|sw\.js|404|script\.google|net::/i.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE+'/'+G.id+'-4k.html',{waitUntil:'load'});
  await p.waitForFunction(h=>window[h]&&window[h].snapshot().cw>0,G.hook,{timeout:8000}).catch(()=>{});
  await sleep(500);
  return {c,p,errs};
}
const snap=(p,G)=>p.evaluate(h=>window[h].snapshot(),G.hook);
const until=async(p,fn,arg,ms=9000)=>{ const t=Date.now(); while(Date.now()-t<ms){ if(await p.evaluate(fn,arg)) return true; await sleep(30);} return false; };

/* a patient player for each game: calls `step` until the run has ended */
const PLAYERS={
  'magic-tiles':(p)=>p.evaluate(()=>{ const m=window.__magictiles, s=m.snapshot(); if(s.state!=='play') return;
    m.lanes().forEach(t=>{ if(!t.dead && Math.abs(t.y+s.cell*.31-s.hitY)<s.cell*.35) m.tapLane(t.lane); }); }),
  'pack-slicer':(p)=>p.evaluate(()=>{ const m=window.__packslicer; if(m.snapshot().state!=='play') return;
    m.items().forEach(i=>{ if(!i.bomb) m.sliceAlong(i.x-90,i.y,i.x+90,i.y); }); }),
  'match-factory':(p)=>p.evaluate(()=>{ const m=window.__matchfactory, s=m.snapshot(); if(s.state!=='play'||s.busy) return;
    const h=m.hint(); if(h) m.attemptSwap(h.c1,h.r1,h.c2,h.r2); }),
};
async function playUntil(p,G,pred,ms=60000){ const t=Date.now(); while(Date.now()-t<ms){ await PLAYERS[G.id](p); if(await p.evaluate(([h,f])=>eval(f)(window[h].snapshot()),[G.hook,pred])) return true; await sleep(35);} return false; }

const VPS=[
  ['TV 1920x1080',1920,1080,false,1],['TV 4K 3840x2160',3840,2160,false,1],['desktop 1366x768',1366,768,false,1],
  ['tablet upright 820x1180',820,1180,true,2],['tablet on its side 1180x820',1180,820,true,2],
  ['phone upright 390x844',390,844,true,3],['small phone 360x640',360,640,true,3],['phone on its side 844x390',844,390,true,3],
  ['tall kiosk 1080x1920',1080,1920,true,1],['tall TV 4K 2160x3840',2160,3840,false,1],['squarer desktop 1280x1024',1280,1024,false,1],['tablet upright small 768x1024',768,1024,true,2],
];

for (const G of GAMES){
  console.log('\n══ '+G.name+' ══');
  console.log('every screen');
  for (const [name,w,h,touch,dsf] of VPS){
    const {c,p,errs}=await open(G,{width:w,height:h},touch,dsf);
    const menu=await p.evaluate(()=>{ const R=s=>{const b=document.querySelector(s).getBoundingClientRect(); return {l:b.left,t:b.top,r:b.right,b:b.bottom};}; return {cab:R('#cab'),g:R('#goGift'),n:R('#goPlay')}; });
    const within=(a,o)=>a.l>=o.l-1&&a.r<=o.r+1&&a.t>=o.t-1&&a.b<=o.b+1;
    chk(name+': Redeem gift and Normal play are inside the board and tappable', within(menu.g,menu.cab)&&within(menu.n,menu.cab)&&(menu.g.b-menu.g.t)>=40&&(menu.n.b-menu.n.t)>=40, menu);
    await p.evaluate(h=>window[h].start('play'),G.hook); await sleep(1300);
    const m=await p.evaluate(()=>{ const R=s=>{const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return {l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height};};
      const vis=e=>e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>0;
      const bk=document.querySelector('.fxr-back'), sh=document.querySelector('.fxr-show'), cv=document.getElementById('game');
      return {cab:R('#cab'),cv:R('#game'),back:vis(bk)?R('.fxr-back'):null,show:vis(sh)?R('.fxr-show'):null,
        sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,iw:innerWidth,ih:innerHeight,cw:cv.width,ch:cv.height,
        side:[...document.querySelectorAll('.left .card,.right .card')].filter(e=>e.offsetWidth>0).map(e=>{const b=e.getBoundingClientRect(); return {t:b.top,b:b.bottom,l:b.left,r:b.right};})}; });
    const hit=(a,o)=>a&&o&&a.l<o.r-1&&a.r>o.l+1&&a.t<o.b-1&&a.b>o.t+1;
    chk(name+': the whole board is on screen, and the page does not scroll', m.cab.l>=0&&m.cab.t>=0&&m.cab.r<=m.iw&&m.cab.b<=m.ih&&m.sw<=m.iw&&m.sh<=m.ih, {cab:m.cab,iw:m.iw,ih:m.ih});
    chk(name+': the board is big ('+Math.round(m.cab.r-m.cab.l)+'x'+Math.round(m.cab.b-m.cab.t)+')', (m.cab.b-m.cab.t)>=0.5*m.ih || (m.cab.r-m.cab.l)>=0.5*m.iw, m.cab);
    chk(name+': every side card is fully on screen', m.side.every(q=>q.t>=-1&&q.b<=m.ih+1&&q.l>=-1&&q.r<=m.iw+1), m.side);
    chk(name+': the board does not sit under the Back and Ranking buttons', !hit(m.cab,m.back)&&!hit(m.cab,m.show), {back:m.back,show:m.show,cab:m.cab});
    chk(name+': drawn at device resolution (canvas '+m.cw+'x'+m.ch+' for '+Math.round(m.cv.w)+'x'+Math.round(m.cv.h)+' CSS px)', m.cw>=Math.round(m.cv.w)*(m.cv.w*m.cv.h>1.2e6?1.5:2)-2, {cw:m.cw,cvw:m.cv.w});   /* a very large board keeps to the pixel budget: at least 1.5x */
    chk(name+': no page errors', errs.length===0, errs);
    await c.close();
  }

  console.log('\nthe gift desk and the two ways to start');
  for (const [label,gift,expect] of [['gifts on, target 300',{on:true,need:300},'ready'],['gifts off',{on:false,need:300},'off'],['no target set',{on:true,need:0},'unset']]){
    const {c,p,errs}=await open(G,{width:1366,height:768},false,1,gift);
    await until(p,h=>window[h].snapshot().giftState!=='wait',G.hook,6000);
    const s=await snap(p,G), ui=await p.evaluate(()=>({dis:document.getElementById('goGift').disabled,sub:document.getElementById('giftSub').textContent,play:document.getElementById('goPlay').disabled}));
    chk(label+': Redeem gift is '+expect+(expect==='ready'?' and says the target':', greyed out'), s.giftState===expect && (expect==='ready'?(!ui.dis&&/300/.test(ui.sub)):ui.dis), {s:s.giftState,ui});
    chk(label+': Normal play is always open', !ui.play);
    if(expect==='ready'){
      await p.click('#goGift'); await sleep(250);
      const g2=await snap(p,G);
      chk('Redeem gift starts a gift run with the target of 300', g2.mode==='gift'&&g2.need===300&&g2.state==='play', g2);
      chk('the gift bar and the "Gift" tag are shown', await p.evaluate(()=>!document.getElementById('giftBox').hidden && /gift/i.test(document.getElementById('modeTag').textContent)));
      const won=await playUntil(p,G,'s=>s.state==="won"',90000);
      const s1=await snap(p,G); await sleep(1500); const s2=await snap(p,G);
      chk('the run stops the moment the target is reached', won && s1.score>=300, s1);
      chk('...and the score does not move afterwards', s2.score===s1.score && s2.state==='won', {s1:s1.score,s2:s2.score});
      await sleep(900);
      chk('the winner screen shows the exact score', await p.evaluate(()=>{ const r=document.getElementById('result'); return !r.classList.contains('hidden') && r.classList.contains('win'); }) && (await p.evaluate(()=>document.getElementById('rScore').textContent))===String(s2.score));
      chk('the ranking is told which game this is (and only opens on a tap)', await p.evaluate((id)=>window.FX_RANK&&window.FX_RANK.id===id&&window.FX_RANK.manual===true&&typeof window.FX_RANK.giftGate==='function',G.id));
    }else{
      await p.click('#goPlay'); await sleep(250);
      const g2=await snap(p,G);
      chk('Normal play still starts', g2.mode==='play'&&g2.state==='play'&&g2.need===0, g2);
    }
    chk('no page errors', errs.length===0, errs);
    await c.close();
  }

  console.log('\nnormal play');
  {
    const {c,p,errs}=await open(G,{width:1366,height:768},false,1);
    await p.click('#goPlay'); await sleep(300);
    let s=await snap(p,G);
    chk('Normal play starts level 1 with a goal', s.mode==='play'&&s.level===1&&s.goal>0&&s.state==='play'&&s.score===0, s);
    await playUntil(p,G,'s=>s.score>=200',45000);
    s=await snap(p,G);
    chk('playing scores points', s.score>=200, s);
    chk('Normal play never stops on a target: it plays on past it', s.state==='play'||s.state==='over', s.state);
    await p.keyboard.press('p'); await sleep(250);
    chk('P pauses, P resumes', (await snap(p,G)).state==='pause' && (await p.keyboard.press('p'),await sleep(250),(await snap(p,G)).state)==='play');
    chk('no page errors', errs.length===0, errs);
    await c.close();
  }
}

/* ───────────────────────── the rules of each game */
console.log('\n══ Magic Tiles: the rules ══');
{
  const G=GAMES[0], {c,p,errs}=await open(G,{width:1366,height:768},false,1);
  await p.evaluate(()=>window.__magictiles.start('play')); await sleep(200);
  const fast=await p.evaluate(()=>{ const s=window.__magictiles.snapshot(); return {speed:s.speed,lives:s.lives}; });
  chk('three lives, speed starts at 150 px/s (on a 640 px board)', fast.lives===3&&fast.speed===150, fast);
  chk('four lanes', await p.evaluate(()=>{ const s=window.__magictiles.snapshot(); return Math.round(s.cw/s.dpr/s.cell)===4; }));
  const before=(await snap(p,G)).lives;
  await until(p,h=>window[h].snapshot().lives<3||window[h].snapshot().state==='over',G.hook,20000);
  chk('a tile that crosses the line unplayed costs a life', (await snap(p,G)).lives<before);
  await until(p,h=>window[h].snapshot().state==='over',G.hook,40000);
  await sleep(900);
  const s=await snap(p,G);
  chk('three lives gone ends the run and shows the result', s.state==='over'&&s.lives<=0&&await p.evaluate(()=>!document.getElementById('result').classList.contains('hidden')) , s);
  chk('the board scales its fall speed with its height (a 4K cabinet is not slow)', await (async()=>{
    const q=await open(G,{width:3840,height:2160},false,1); await q.p.evaluate(()=>window.__magictiles.start('play')); await sleep(1500);
    const lanes=await q.p.evaluate(()=>window.__magictiles.lanes().map(t=>t.y)); const s1=await snap(q.p,G); await sleep(500);
    const lanes2=await q.p.evaluate(()=>window.__magictiles.lanes().map(t=>t.y)); await q.c.close();
    return lanes.length&&lanes2[0]-lanes[0]>150*(s1.ch/s1.dpr/640)*.35; })());
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
console.log('\n══ Pack Slicer: the rules ══');
{
  const G=GAMES[1], {c,p,errs}=await open(G,{width:1366,height:768},false,1);
  await p.evaluate(()=>window.__packslicer.start('play')); await sleep(300);
  chk('three misses end the run, none yet', (await snap(p,G)).misses===0);
  await until(p,h=>window[h].items().length>0,G.hook,5000);
  const it=await p.evaluate(()=>window.__packslicer.items().find(i=>!i.bomb));
  const s0=await snap(p,G);
  await p.evaluate(i=>window.__packslicer.sliceAlong(i.x-200,i.y,i.x+200,i.y),it); await sleep(60);
  const s1=await snap(p,G);
  chk('a flick across a pack slices it for points', s1.score>s0.score, {a:s0.score,b:s1.score});
  await p.evaluate(()=>window.__packslicer.forceBomb()); await sleep(30);
  const bm=await p.evaluate(()=>window.__packslicer.items().find(i=>i.bomb));
  await p.evaluate(i=>window.__packslicer.sliceAlong(i.x-200,i.y,i.x+200,i.y),bm); await sleep(60);
  chk('slicing a bomb costs a life (a miss)', (await snap(p,G)).misses===s1.misses+1, await snap(p,G));
  chk('a throw rises to a fair part of the board and comes back (nothing flies off for ever)', await (async()=>{
    const q=await open(G,{width:3840,height:2160},false,1); await q.p.evaluate(()=>window.__packslicer.start('play'));
    let maxUp=1e9; const t=Date.now(); let H=0;
    while(Date.now()-t<3500){ const r=await q.p.evaluate(()=>({i:window.__packslicer.items(),h:window.__packslicer.snapshot().ch/window.__packslicer.snapshot().dpr})); H=r.h; r.i.forEach(i=>{ if(i.y<maxUp) maxUp=i.y; }); await sleep(40); }
    await q.c.close(); return maxUp>-0.5*H && maxUp<0.7*H; })());
  await until(p,h=>window[h].snapshot().state==='over',G.hook,45000);
  chk('missing three packs ends the run', (await snap(p,G)).state==='over');
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
console.log('\n══ Match Factory: the rules ══');
{
  const G=GAMES[2], {c,p,errs}=await open(G,{width:1366,height:768},false,1);
  await p.evaluate(()=>window.__matchfactory.start('play')); await sleep(1500);
  let s=await snap(p,G);
  chk('an 8x8 bench, 64 packs, 30 moves', s.tiles===64&&s.moves===30, s);
  chk('a new bench has no ready line and has a move', await p.evaluate(()=>{ const m=window.__matchfactory, b=m.board(); for(let r=0;r<8;r++)for(let q=0;q<6;q++){ if(b[r*8+q]===b[r*8+q+1]&&b[r*8+q]===b[r*8+q+2]) return false; } for(let q=0;q<8;q++)for(let r=0;r<6;r++){ if(b[r*8+q]===b[(r+1)*8+q]&&b[r*8+q]===b[(r+2)*8+q]) return false; } return m.findMoves()>0; }));
  const bad=await p.evaluate(()=>{ const m=window.__matchfactory,b=m.board(); for(let r=0;r<8;r++)for(let q=0;q<7;q++){ if(b[r*8+q]!==b[r*8+q+1]&&!m.isLegal(q,r,q+1,r)) return {c1:q,r1:r,c2:q+1,r2:r}; } return null; });
  const b0=await p.evaluate(()=>window.__matchfactory.board().join(','));
  await p.evaluate(m=>window.__matchfactory.attemptSwap(m.c1,m.r1,m.c2,m.r2),bad); await sleep(700);
  s=await snap(p,G);
  chk('an illegal swap slides back and costs nothing', s.moves===30 && (await p.evaluate(()=>window.__matchfactory.board().join(',')))===b0, s);
  const h=await p.evaluate(()=>window.__matchfactory.hint());
  await p.evaluate(m=>window.__matchfactory.attemptSwap(m.c1,m.r1,m.c2,m.r2),h);
  await until(p,k=>!window[k].snapshot().busy,G.hook,5000);
  s=await snap(p,G);
  chk('a legal swap scores, costs a move, and the bench refills to 64', s.moves===29&&s.score>0&&s.tiles===64, s);
  chk('the refill leaves no ready line, and the bench always has a move', await p.evaluate(()=>{ const m=window.__matchfactory,b=m.board(); for(let r=0;r<8;r++)for(let q=0;q<6;q++){ if(b[r*8+q]===b[r*8+q+1]&&b[r*8+q]===b[r*8+q+2]) return false; } for(let q=0;q<8;q++)for(let r=0;r<6;r++){ if(b[r*8+q]===b[(r+1)*8+q]&&b[r*8+q]===b[(r+2)*8+q]) return false; } return m.findMoves()>0; }));
  await playUntil(p,G,'s=>s.state==="over"',90000);
  s=await snap(p,G);
  chk('the moves running out ends the run', s.state==='over'&&s.moves===0, s);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\n══ idle: the loop parks when nothing moves ══');
for (const G of GAMES){
  const {c,p}=await open(G,{width:1366,height:768},false,1);
  await sleep(1500); const a=await p.evaluate(()=>window.__rafs); await sleep(1500); const z=await p.evaluate(()=>window.__rafs);
  chk(G.name+': on the start screen the frame loop is parked ('+(z-a)+' frames in 1.5 s)', z-a<=6, z-a);
  await c.close();
}

await b.close(); srv.close();
console.log('\n'+(bad?bad+' FAILED':'all passed')); process.exit(bad?1:0);
