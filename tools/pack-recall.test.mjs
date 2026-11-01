/* Pack Recall, played as a visitor plays it.

   Every block shows, then closes; a pair opens and stays; a wrong pair costs a try;
   the tries running out ends the run; the last pair found clears the level, and the
   next one is a recall round with a question for each answer and blocks that slide.
   Then the gift (the run stops on the exact point), the pause, the keyboard, every
   screen from a TV to a phone on its side, and the idle loop. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8264, BASE='http://127.0.0.1:'+PORT;
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

/* `gift` stands in for the booth script: {on, need} answers the config call, and a claim hands back a code */
async function open(vp, touch, dsf, gift){
  const c=await b.newContext({viewport:vp,isMobile:touch,hasTouch:touch,deviceScaleFactor:dsf});
  await c.route(u=>!u.href.startsWith(BASE), r=>r.abort());       // nothing leaves for the real scripts: a test run must not put names on the live ranking
  await c.addInitScript((api)=>{ window.__BOOTH_API=api; try{ localStorage.setItem('fx.player','Tester'); }catch(e){}
    window.__rafs=0; const raf=window.requestAnimationFrame.bind(window); window.requestAnimationFrame=cb=>raf(t=>{ window.__rafs++; cb(t); }); }, gift?BASE+'/api':'');
  const calls=[];
  if(gift) await c.route(BASE+'/api', async route=>{
    let q={}; try{ q=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    calls.push(q);
    let out={ok:false};
    if(q.action==='config') out={ok:true,settings:{gift_active:gift.on?'yes':'no'},gift_needs:gift.need?{'pack-recall':gift.need}:{}};
    else if(q.action==='gift.claim') out=q.score>=gift.need?{ok:true,claim:'44444444-4444-4444-8444-444444444444'}:{ok:false,reason:'short'};
    else out={ok:true};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(out)});
  });
  const p=await c.newPage(); const errs=[];
  p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{ if(m.type()==='error' && !/cloudflare|rum|ERR_FAILED|sw\.js|404|script\.google|net::/i.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE+'/pack-recall-4k.html',{waitUntil:'load'});
  await p.waitForFunction(()=>window.__packrecall && window.__packrecall.snapshot().loaded>=8,null,{timeout:8000}).catch(()=>{});
  await sleep(250);                       /* the name is asked once, and 'Tester' is already held: no gate to get past */
  return {c,p,errs,calls};
}
const snap=p=>p.evaluate(()=>window.__packrecall.snapshot());
const cardsOf=p=>p.evaluate(()=>window.__packrecall.cards());
const until=async(p,fn,ms=9000)=>{ const t=Date.now(); while(Date.now()-t<ms){ if(await p.evaluate(fn)) return true; await sleep(30);} return false; };
const toPlay=async p=>{ await p.evaluate(()=>window.__packrecall.skipPreview()); return until(p,()=>window.__packrecall.state()==='play'); };
const newGame=async(p,mode='play')=>{ await p.evaluate(m=>window.__packrecall.start(m),mode); await until(p,()=>window.__packrecall.state()==='preview'); await sleep(150); await toPlay(p); };
const tap=(p,i)=>p.evaluate(i=>window.__packrecall.tap(i),i);
/* the two cards of a pair, and two that are not */
const pairOf=async(p,n=0)=>{ const cs=await cardsOf(p); const ids=[...new Set(cs.filter(c=>!c.matched).map(c=>c.pair))]; const k=ids[n]; return cs.filter(c=>c.pair===k).map(c=>c.i); };
const notPair=async p=>{ const cs=await cardsOf(p).then(a=>a.filter(c=>!c.matched)); const a=cs[0]; const o=cs.find(c=>c.pair!==a.pair); return [a.i,o.i]; };
const clearLevel=async p=>{ for(let k=0;k<8;k++){ const [a,c]=await pairOf(p); await tap(p,a); await tap(p,c); await sleep(60); if((await snap(p)).state!=='play') break; } };

/* ───────────────────────── 1. every screen, held every way */
console.log('\nthe layout, on every screen');
const VPS=[
  ['TV 1920x1080',1920,1080,false,1],['TV 4K 3840x2160',3840,2160,false,1],['desktop 1366x768',1366,768,false,1],
  ['tablet upright 820x1180',820,1180,true,2],['tablet on its side 1180x820',1180,820,true,2],
  ['phone upright 390x844',390,844,true,3],['small phone 360x640',360,640,true,3],['phone on its side 844x390',844,390,true,3],
  ['tall kiosk 1080x1920',1080,1920,true,1],['tall TV 4K 2160x3840',2160,3840,false,1],['squarer desktop 1280x1024',1280,1024,false,1],['tablet upright small 768x1024',768,1024,true,2],
];
for (const [name,w,h,touch,dsf] of VPS){
  const {c,p,errs}=await open({width:w,height:h},touch,dsf);
  const menu=await p.evaluate(()=>{ const R=s=>{const b=document.querySelector(s).getBoundingClientRect(); return {l:b.left,t:b.top,r:b.right,b:b.bottom};}; return {cab:R('#cab'),g:R('#goGift'),n:R('#goPlay')}; });
  const within=(a,o)=>a.l>=o.l-1&&a.r<=o.r+1&&a.t>=o.t-1&&a.b<=o.b+1;
  chk(name+': both start buttons (Redeem gift, Normal play) are inside the board and tappable', within(menu.g,menu.cab)&&within(menu.n,menu.cab)&&(menu.g.b-menu.g.t)>=40&&(menu.n.b-menu.n.t)>=40, menu);
  await p.evaluate(()=>window.__packrecall.start('play')); await sleep(1200);
  const m=await p.evaluate(()=>{
    const R=s=>{const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return {l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height,vis:getComputedStyle(e).display!=='none'&&b.width>0};};
    const cv=document.getElementById('game'), s=window.__packrecall.snapshot();
    const back=document.querySelector('.fxr-back'), bb=back&&back.getBoundingClientRect(), show=document.querySelector('.fxr-show'), sb=show&&getComputedStyle(show).display!=='none'&&show.getBoundingClientRect();
    return {cab:R('#cab'),cv:R('#game'),padL:R('.padL'),padR:R('.padR'),btnL:R('.padL .pb'),btnR:R('.padR .pb'),
      back:bb?{l:bb.left,t:bb.top,r:bb.right,b:bb.bottom}:null, show:sb?{l:sb.left,t:sb.top,r:sb.right,b:sb.bottom}:null,
      sw:document.documentElement.scrollWidth, sh:document.documentElement.scrollHeight, iw:innerWidth, ih:innerHeight, cw:cv.width, ch:cv.height, snap:s,
      side:[...document.querySelectorAll('.left .card,.right .card')].filter(e=>e.offsetWidth>0).map(e=>{const b=e.getBoundingClientRect(); return {t:b.top,b:b.bottom,l:b.left,r:b.right};})};
  });
  const hit=(a,b)=>a&&b&&a.l<b.r-1&&a.r>b.l+1&&a.t<b.b-1&&a.b>b.t+1;
  const cabSide=Math.min(m.cab.r-m.cab.l,m.cab.b-m.cab.t);
  chk(name+': the whole board is on screen, and the page does not scroll', m.cab.l>=0&&m.cab.t>=0&&m.cab.r<=m.iw&&m.cab.b<=m.ih && m.sw<=m.iw && m.sh<=m.ih, {cab:m.cab,iw:m.iw,ih:m.ih,sw:m.sw,sh:m.sh});
  chk(name+': the board is big: '+Math.round(cabSide)+'px, '+Math.round(100*cabSide/Math.min(m.iw,m.ih))+'% of the short side', cabSide>=0.62*Math.min(m.iw,m.ih), {cabSide,iw:m.iw,ih:m.ih});
  chk(name+': every side card is fully on screen', m.side.every(c=>c.t>=-1&&c.b<=m.ih+1&&c.l>=-1&&c.r<=m.iw+1), m.side);
  chk(name+': a block is big enough to read ('+m.snap.cell+'px)', m.snap.cell>=(h<=700?60:80), m.snap.cell);
  chk(name+': the board does not sit under the pads or the Back and Ranking buttons', !hit(m.cab,m.padL&&m.padL.vis?m.padL:null)&&!hit(m.cab,m.padR&&m.padR.vis?m.padR:null)&&!hit(m.cab,m.back)&&!hit(m.cab,m.show), m);
  chk(name+': the pad buttons do not cover the Back or Ranking buttons', !hit(m.btnL&&m.btnL.vis?m.btnL:null,m.back)&&!hit(m.btnR&&m.btnR.vis?m.btnR:null,m.show)&&!hit(m.btnL&&m.btnL.vis?m.btnL:null,m.show)&&!hit(m.btnR&&m.btnR.vis?m.btnR:null,m.back), m);
  chk(name+': the peek and pause pads are there on a touch screen or an upright one, and gone on a wide desktop screen', touch||h>w ? (m.padL.vis&&m.padR.vis) : (!m.padL.vis&&!m.padR.vis), {touch,padL:m.padL});
  chk(name+': drawn at device resolution (canvas '+m.cw+'x'+m.ch+' for '+Math.round(m.cv.w)+'x'+Math.round(m.cv.h)+' CSS px)', m.cw>=Math.round(m.cv.w)*2-2 && m.ch>=Math.round(m.cv.h)*2-2, {cw:m.cw,cvw:m.cv.w});
  chk(name+': all 8 packshots loaded and baked into glass blocks', m.snap.loaded===8 && m.snap.sprites>=9, m.snap);
  chk(name+': no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 2. a new game: look, then they close */
console.log('\nthe preview');
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await p.evaluate(()=>window.__packrecall.start('play'));
  await until(p,()=>window.__packrecall.state()==='preview'); await sleep(900);
  let cs=await cardsOf(p), s=await snap(p);
  chk('Normal play starts level 1, a Packs round, 16 blocks, 9 tries, shown for 2,200 ms', s.mode==='play' && s.level===1 && s.kind==='packs' && s.cards===16 && s.tries===9 && s.previewMs===2200 && s.state==='preview', s);
  chk('every block is face up for the look', cs.every(x=>x.up) && cs.length===16, cs.map(x=>x.up));
  const packs=[...new Set(cs.map(x=>x.img))];
  chk('eight different packs, each exactly twice, so no two pairs can be mistaken', packs.length===8 && packs.every(k=>cs.filter(x=>x.img===k).length===2), packs);
  chk('and exactly one pair is gold', cs.filter(x=>x.gold).length===2 && cs.filter(x=>x.gold)[0].pair===cs.filter(x=>x.gold)[1].pair);
  await sleep(2100);
  s=await snap(p); cs=await cardsOf(p);
  chk('then they all close and the game is on', s.state==='play' && cs.every(x=>!x.up && !x.matched), {state:s.state});
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 3. pairs, and the card in the top-left corner */
console.log('\nfinding pairs');
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await newGame(p,'play');
  let cs=await cardsOf(p);
  const zero=cs.find(x=>x.i===0), partner=cs.find(x=>x.pair===zero.pair && x.i!==0);
  await tap(p,0); await tap(p,partner.i); await sleep(150);
  let s=await snap(p); cs=await cardsOf(p);
  chk('card 0 can start a pair (it could not, once, because 0 is falsy)', cs[0].matched && cs[partner.i].matched && s.found===1, s);
  chk('a pair scores 160 on level 1, plus 500 if it is the gold one', s.score===(zero.gold?660:160), {score:s.score,gold:zero.gold});
  const [a,d]=await pairOf(p,0); await tap(p,a); await tap(p,d); await sleep(150);
  s=await snap(p);
  chk('a second pair in a row builds the streak (200)', s.streak===2 && s.found===2, s);
  const [x,y]=await notPair(p); await tap(p,x); await tap(p,y);
  chk('a wrong pair costs a try and the streak', await until(p,()=>window.__packrecall.snapshot().tries===8 && window.__packrecall.snapshot().streak===0), await snap(p));
  await until(p,()=>window.__packrecall.state()==='play');
  cs=await cardsOf(p);
  chk('...and both close again, the pairs found stay open', !cs[x].up && !cs[y].up && cs.filter(q=>q.matched).length===4, cs.map(q=>[q.up,q.matched]));
  await tap(p,x); await tap(p,x);
  chk('the same block twice is not a pair', (await snap(p)).tries===8);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 4. clearing a level, and the recall round */
console.log('\nlevels and the recall round');
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await newGame(p,'play');
  const before=await snap(p);
  await clearLevel(p);
  let s=await snap(p);
  chk('the last pair clears the level and pays the tries left (9 x 150)', s.state==='clear' && s.found===8 && s.score>=before.score+8*160+1350-1, s);
  await until(p,()=>window.__packrecall.snapshot().level===2,6000); await until(p,()=>window.__packrecall.state()==='preview'); await sleep(900);
  s=await snap(p); let cs=await cardsOf(p);
  chk('level 2 is a recall round: shorter look (1,980 ms), blocks that slide (every 5,000 ms), fresh tries', s.kind==='recall' && s.previewMs===1980 && s.shuffleMs===5000 && s.tries===9, s);
  const qs=cs.filter(x=>x.role==='q'), as=cs.filter(x=>x.role==='a');
  chk('eight questions and eight answers, a question and its answer sharing a pair', qs.length===8 && as.length===8 && qs.every(q=>as.some(a=>a.pair===q.pair && a.pack===q.pack)), {qs:qs.length,as:as.length});
  chk('no two questions say the same thing, no two answers do either, so each question has one answer', new Set(qs.map(q=>q.title)).size===8 && new Set(as.map(a=>a.title)).size===8, {q:qs.map(q=>q.title),a:as.map(a=>a.title)});
  chk('no gold pair in a recall round (a star on two blocks would give the pairing away)', cs.every(x=>!x.gold));
  await toPlay(p); await sleep(150);
  cs=await cardsOf(p);
  const slotsBefore=cs.map(x=>x.slot);
  await p.evaluate(()=>window.__packrecall.scatter()); await sleep(900);
  cs=await cardsOf(p);
  chk('the slide moves the blocks to new places, and they arrive there', cs.some((x,i)=>x.slot!==slotsBefore[i]) && cs.every(x=>Math.abs(x.x-x.tx)<=2 && Math.abs(x.y-x.ty)<=2), cs.slice(0,4));
  /* tap the block by where it is drawn now, with the mouse */
  const target=cs.find(x=>x.role==='q'); const bb=await p.evaluate(()=>{const b=document.getElementById('game').getBoundingClientRect(); return {l:b.left,t:b.top,w:b.width,h:b.height,cell:window.__packrecall.snapshot().cell};});
  await p.mouse.click(bb.l+target.tx*bb.w/(4*bb.cell)+bb.w/8, bb.t+target.ty*bb.h/(4*bb.cell)+bb.h/8); await sleep(250);
  chk('a tap on a block opens the block that is drawn there, not the one that was', (await cardsOf(p))[target.i].up===true);
  await p.evaluate(()=>window.__packrecall.start('play')); await newGame(p,'play');
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
{
  /* the slide, on its own timer */
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await newGame(p,'play'); await clearLevel(p);
  await until(p,()=>window.__packrecall.snapshot().level===2,6000); await until(p,()=>window.__packrecall.state()==='preview'); await toPlay(p);
  const s0=(await cardsOf(p)).map(x=>x.slot); await sleep(5600);
  const s1=(await cardsOf(p)).map(x=>x.slot);
  chk('in a recall round the blocks slide by themselves, about every five seconds', s0.some((v,i)=>v!==s1[i]));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 5. tries run out */
console.log('\ntries');
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await newGame(p,'play');
  const [a,d]=await pairOf(p); await tap(p,a); await tap(p,d); await sleep(100);
  await p.evaluate(()=>window.__packrecall.setTries(1));
  const [x,y]=await notPair(p); await tap(p,x); await tap(p,y);
  await until(p,()=>window.__packrecall.state()==='over',6000); await sleep(1700);
  const r=await p.evaluate(()=>({st:window.__packrecall.state(), shown:!document.getElementById('result').classList.contains('hidden'), win:document.getElementById('result').classList.contains('win'),
    sub:document.getElementById('rSub').textContent, score:+document.getElementById('rScore').textContent, board:JSON.parse(localStorage.getItem('fx.rank.pack-recall')||'[]'), snap:window.__packrecall.snapshot()}));
  chk('no tries left: the run ends, and says how many pairs were still out', r.st==='over' && r.shown && !r.win && /Out of tries on level 1 with 7 pairs/.test(r.sub), r);
  chk('and the result shows the real score, which the booth ranking took', r.score===r.snap.score && r.score>0 && r.board.length===1 && r.board[0].s===r.score && r.board[0].n==='Tester', r.board);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await newGame(p,'play');
  await p.evaluate(()=>window.__packrecall.peek()); await sleep(250);
  let cs=await cardsOf(p), s=await snap(p);
  chk('Peek turns every closed block over, for one try', s.state==='peek' && s.tries===8 && cs.every(x=>x.up), {s,ups:cs.filter(x=>x.up).length});
  await until(p,()=>window.__packrecall.state()==='play'); cs=await cardsOf(p);
  chk('...then they close again', cs.every(x=>!x.up));
  await p.evaluate(()=>window.__packrecall.setTries(1)); await p.evaluate(()=>window.__packrecall.peek()); await sleep(200);
  chk('the last try is kept: Peek will not spend it', (await snap(p)).tries===1 && (await snap(p)).state==='play');
  await p.keyboard.press('h'); await sleep(100);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 6. redeem: stop the instant the target is reached */
console.log('\nredeem gift');
{
  const {c,p,errs,calls}=await open({width:390,height:844},true,2,{on:true,need:400});
  await p.waitForFunction(()=>window.__packrecall.snapshot().giftState==='ready',null,{timeout:6000}).catch(()=>{});
  const ui=await p.evaluate(()=>({txt:document.getElementById('goGift').innerText, dis:document.getElementById('goGift').disabled}));
  chk('with a target set, Redeem gift says what to reach', !ui.dis && ui.txt.includes('400'), ui);
  await p.tap('#goGift'); await until(p,()=>window.__packrecall.state()==='preview'); await sleep(150); await toPlay(p);
  let s=await snap(p);
  chk('Redeem gift starts a run aimed at 400, with the gift bar', s.mode==='gift' && s.need===400 && !(await p.evaluate(()=>document.getElementById('giftBox').hidden)), s);
  await p.evaluate(()=>window.__packrecall.addScore(300));
  chk('short of it: still playing', (await snap(p)).state==='play');
  const [a,d]=await pairOf(p); await tap(p,a); await tap(p,d);
  await until(p,()=>window.__packrecall.state()==='won',3000);
  s=await snap(p);
  chk('the very pair that reaches it stops the game', s.state==='won' && s.score>=400, s);
  const t1=await p.evaluate(()=>JSON.stringify(window.__packrecall.cards())); const [x,y]=[0,1]; await tap(p,x); await sleep(500);
  chk('and nothing else can be turned over afterwards', await p.evaluate(j=>JSON.stringify(window.__packrecall.cards())===j,t1));
  await sleep(900);
  const r=await p.evaluate(()=>({shown:!document.getElementById('result').classList.contains('hidden'), win:document.getElementById('result').classList.contains('win'),
    h:getComputedStyle(document.getElementById('rWin')).display, gift:(document.querySelector('.fxg')||{}).innerText||'', btn:!!document.querySelector('.fxg button')&&getComputedStyle(document.querySelector('.fxg button')).display}));
  chk('"You are a winner!" comes up, gold, with the gift to claim', r.shown && r.win && r.h!=='none' && /earned the gift/i.test(r.gift) && r.btn==='inline-block', r);
  await p.tap('.fxg button'); await sleep(900);
  chk('claiming hands over the code', /waiting/i.test(await p.evaluate(()=>(document.querySelector('.fxg')||{}).innerText||'')) && calls.some(q=>q.action==='gift.claim'&&q.game==='pack-recall'&&q.score>=400), calls.map(q=>q.action));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
{
  const {c,p,errs}=await open({width:1366,height:768},false,1,{on:true,need:400});
  await p.waitForFunction(()=>window.__packrecall.snapshot().giftState==='ready',null,{timeout:6000}).catch(()=>{});
  await p.click('#goPlay'); await until(p,()=>window.__packrecall.state()==='preview'); await sleep(150); await toPlay(p);
  await p.evaluate(()=>window.__packrecall.addScore(9000)); await sleep(200);
  chk('a Normal run past the gift score is never stopped', await p.evaluate(()=>window.__packrecall.state()==='play'));
  await p.evaluate(()=>window.__packrecall.setTries(1)); const [x,y]=await notPair(p); await tap(p,x); await tap(p,y);
  await until(p,()=>window.__packrecall.state()==='over',6000); await sleep(1700);
  const r=await p.evaluate(()=>({win:document.getElementById('result').classList.contains('win'), gift:(document.querySelector('.fxg')&&document.querySelector('.fxg').style.display)||'none'}));
  chk('...and ends as a plain result: no winner, no gift offer', !r.win && r.gift==='none', r);
  await p.click('#menu'); await sleep(500);
  chk('Change mode goes back to the two buttons', await p.evaluate(()=>!document.getElementById('start').classList.contains('hidden')));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
{
  const {c,p}=await open({width:1366,height:768},false,1,{on:false,need:400});
  await sleep(900);
  const ui=await p.evaluate(()=>({gs:window.__packrecall.snapshot().giftState, dis:document.getElementById('goGift').disabled}));
  chk('with gifts off, Redeem gift is greyed out; Normal play still starts', ui.gs==='off' && ui.dis && (await (async()=>{ await p.click('#goPlay'); return until(p,()=>window.__packrecall.state()==='preview'); })()), ui);
  await c.close();
}

/* ───────────────────────── 7. pause, keys, idle */
console.log('\npause, keys, idle');
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await p.evaluate(()=>window.__packrecall.start('play')); await until(p,()=>window.__packrecall.state()==='preview'); await sleep(300);
  await p.keyboard.press('p'); await sleep(200);
  chk('P pauses, even in the middle of the look', await p.evaluate(()=>window.__packrecall.state()==='pause' && !document.getElementById('paused').classList.contains('hidden')));
  await p.keyboard.press('p'); await sleep(200);
  chk('P again goes back to the look, not straight into the game (it used to lose the preview)', await p.evaluate(()=>window.__packrecall.state()==='preview'));
  await toPlay(p);
  /* the keyboard: arrows to a block, space to turn it over */
  const cs=await cardsOf(p); const at=cs.find(x=>x.slot===5);
  await sleep(300); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('Space');
  chk('arrows move to a block and space turns it over', await p.waitForFunction(i=>window.__packrecall.cards()[i].up===true, at.i, {timeout:3000}).then(()=>true).catch(()=>false));
  await sleep(2600);
  const r0=await p.evaluate(()=>window.__rafs); await sleep(1500); const r1=await p.evaluate(()=>window.__rafs);
  chk('a settled Packs round does not redraw at all ('+(r1-r0)+' frames in 1.5 s)', r1-r0<=4, r1-r0);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

await b.close(); srv.close();
console.log(bad?`\n${bad} FAILED`:'\nALL PASS'); process.exit(bad?1:0);
