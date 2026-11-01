/* Pack Crush, played as a visitor plays it.

   The rules are the candy-game grammar, so each one is checked on a board set up
   to show it: a swap that lines up three scores and spends a move; one that does
   not goes back and costs nothing; four makes a striped pack, an L a wrapped one,
   five a rainbow; two specials swapped together blast more than either alone.
   Then the levels (moves run out, the target is reached and the bonus is paid), the
   gift (the run stops on the exact point), the three ways to move a pack (drag, two
   taps, the keyboard), every screen from a TV to a phone on its side, and a whole
   run played by a bot, checking after every move that the board is whole. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8263, BASE='http://127.0.0.1:'+PORT;
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
  await c.addInitScript((api)=>{ window.__BOOTH_API=api; try{ localStorage.setItem('fx.player','Tester'); }catch(e){}
    window.__rafs=0; const raf=window.requestAnimationFrame.bind(window); window.requestAnimationFrame=cb=>raf(t=>{ window.__rafs++; cb(t); }); }, gift?BASE+'/api':'');
  const calls=[];
  if(gift) await c.route(BASE+'/api', async route=>{
    let q={}; try{ q=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    calls.push(q);
    let out={ok:false};
    if(q.action==='config') out={ok:true,settings:{gift_active:gift.on?'yes':'no'},gift_needs:gift.need?{'pack-crush':gift.need}:{}};
    else if(q.action==='gift.claim') out=q.score>=gift.need?{ok:true,claim:'44444444-4444-4444-8444-444444444444'}:{ok:false,reason:'short'};
    else out={ok:true};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(out)});
  });
  const p=await c.newPage(); const errs=[];
  p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{ if(m.type()==='error' && !/cloudflare|rum|ERR_FAILED|sw\.js|404|script\.google|net::/i.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE+'/pack-crush-4k.html',{waitUntil:'load'});
  await p.waitForFunction(()=>window.__packcrush && window.__packcrush.snapshot().loaded>=6,null,{timeout:8000}).catch(()=>{});
  /* give the name the way a visitor does, so the Ranking button is there as it is for them */
  await p.fill('#fxrName','Tester').catch(()=>{}); await p.click('#fxrGo').catch(()=>{}); await sleep(250);
  return {c,p,errs,calls};
}
const snap=p=>p.evaluate(()=>window.__packcrush.snapshot());
const until=async(p,fn,ms=9000)=>{ const t=Date.now(); while(Date.now()-t<ms){ if(await p.evaluate(fn)) return true; await sleep(30);} return false; };
const quiet=p=>until(p,()=>['play','over','won','levelend'].includes(window.__packcrush.state()),20000);
const SPN={sh:1,sv:2,wrap:3,rain:4};

/* a board with no run and no move to speak of: kinds step by one along a row and by two down a column */
const base=(r,c)=>(c+2*r)%6;
const rows0=()=>Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>base(r,c)));
function scenario(name){
  const R=rows0(), S={}; const set=(r,c,k)=>{ R[r][c]=k; };
  if(name==='three'){ set(3,0,0);set(3,1,0);set(3,2,5);set(3,3,0); return {R,S,swap:[3,2,3,3]}; }
  if(name==='four'){  set(3,0,0);set(3,1,0);set(3,2,5);set(3,3,0); return {R,S,swap:[3,2,2,2]}; }
  if(name==='five'){  set(3,0,0);set(3,1,0);set(3,2,5);set(3,3,0);set(3,4,0); return {R,S,swap:[3,2,2,2]}; }
  if(name==='L'){     set(3,0,0);set(3,1,0);set(3,2,5);set(3,3,0);set(4,2,0);set(5,2,0); return {R,S,swap:[3,2,3,3]}; }
  if(name==='none'){  return {R,S,swap:[0,0,0,1]}; }
  return {R,S};
}
async function setup(p,sc){
  await p.evaluate(([R,S])=>window.__packcrush.set(R,S),[sc.R,sc.S]);
  return p.evaluate(()=>{ const b=window.__packcrush.board(); let runs=0;
    for(let r=0;r<8;r++) for(let c=0;c<6;c++) if(b[r][c]&&b[r][c+1]&&b[r][c+2]&&b[r][c].t===b[r][c+1].t&&b[r][c].t===b[r][c+2].t) runs++;
    for(let c=0;c<8;c++) for(let r=0;r<6;r++) if(b[r][c]&&b[r+1][c]&&b[r+2][c]&&b[r][c].t===b[r+1][c].t&&b[r][c].t===b[r+2][c].t) runs++;
    return runs; });
}
const doSwap=(p,s)=>p.evaluate(a=>window.__packcrush.swap(...a),s);
const cellXY=async(p,r,c)=>{ const bb=await p.evaluate(()=>{const b=document.getElementById('game').getBoundingClientRect(); return {l:b.left,t:b.top,w:b.width,h:b.height};}); return {x:bb.l+(c+.5)*bb.w/8, y:bb.t+(r+.5)*bb.h/8, step:bb.w/8}; };
const newGame=async(p,mode='play')=>{ await p.evaluate(m=>window.__packcrush.start(m),mode); await until(p,()=>window.__packcrush.state()==='play'); };

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
  await p.evaluate(()=>window.__packcrush.start('play')); await sleep(1700);
  const m=await p.evaluate(()=>{
    const R=s=>{const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return {l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height,vis:getComputedStyle(e).display!=='none'&&b.width>0};};
    const cv=document.getElementById('game'), s=window.__packcrush.snapshot();
    const back=document.querySelector('.fxr-back'), bb=back&&back.getBoundingClientRect(), show=document.querySelector('.fxr-show'), sb=show&&getComputedStyle(show).display!=='none'&&show.getBoundingClientRect();
    return {cab:R('#cab'),cv:R('#game'),padL:R('.padL'),padR:R('.padR'),btnL:R('.padL .pb'),btnR:R('.padR .pb'),
      back:bb?{l:bb.left,t:bb.top,r:bb.right,b:bb.bottom}:null, show:sb?{l:sb.left,t:sb.top,r:sb.right,b:sb.bottom}:null,
      sw:document.documentElement.scrollWidth, sh:document.documentElement.scrollHeight, iw:innerWidth, ih:innerHeight, cw:cv.width, ch:cv.height, snap:s,
      side:[...document.querySelectorAll('.left .card,.right .card')].filter(e=>e.offsetWidth>0).map(e=>{const b=e.getBoundingClientRect(); return {t:b.top,b:b.bottom,l:b.left,r:b.right};})};
  });
  const hit=(a,b)=>a&&b&&a.l<b.r-1&&a.r>b.l+1&&a.t<b.b-1&&a.b>b.t+1;
  chk(name+': the whole board is on screen, and the page does not scroll', m.cab.l>=0&&m.cab.t>=0&&m.cab.r<=m.iw&&m.cab.b<=m.ih && m.sw<=m.iw && m.sh<=m.ih, {cab:m.cab,iw:m.iw,ih:m.ih,sw:m.sw,sh:m.sh});
  chk(name+': every side card (stats, goal, specials) is fully on screen', m.side.every(c=>c.t>=-1&&c.b<=m.ih+1&&c.l>=-1&&c.r<=m.iw+1), m.side);
  chk(name+': a pack is big enough to read ('+m.snap.cell+'px)', m.snap.cell>=(h<=700?30:40), m.snap.cell);
  chk(name+': the board does not sit under the pads or the Back and Ranking buttons', !hit(m.cab,m.padL&&m.padL.vis?m.padL:null)&&!hit(m.cab,m.padR&&m.padR.vis?m.padR:null)&&!hit(m.cab,m.back)&&!hit(m.cab,m.show), m);
  chk(name+': the pad buttons do not cover the Back or Ranking buttons', !hit(m.btnL&&m.btnL.vis?m.btnL:null,m.back)&&!hit(m.btnR&&m.btnR.vis?m.btnR:null,m.show)&&!hit(m.btnL&&m.btnL.vis?m.btnL:null,m.show)&&!hit(m.btnR&&m.btnR.vis?m.btnR:null,m.back), m);
  chk(name+': the hint and shuffle pads are there on a touch screen and gone on a desktop screen', touch ? (m.padL.vis&&m.padR.vis) : (!m.padL.vis&&!m.padR.vis), {touch,padL:m.padL});
  chk(name+': drawn at device resolution (canvas '+m.cw+'x'+m.ch+' for '+Math.round(m.cv.w)+'x'+Math.round(m.cv.h)+' CSS px)', m.cw>=Math.round(m.cv.w)*2-2 && m.ch>=Math.round(m.cv.h)*2-2, {cw:m.cw,cvw:m.cv.w});
  chk(name+': all 6 packshots loaded and baked into glass blocks', m.snap.loaded===6 && m.snap.sprites>=24, m.snap);
  chk(name+': no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 2. the board a game starts with */
console.log('\na new game');
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await newGame(p,'play');
  const s=await snap(p);
  const bd=await p.evaluate(()=>window.__packcrush.board());
  const pre=await setup(p,{R:bd.map(r=>r.map(t=>t.t)),S:{}});
  chk('Normal play starts level 1 with 25 moves and a target to reach', s.mode==='play' && s.level===1 && s.moves===25 && s.target>=3000 && s.score===0, s);
  chk('the board is 8x8, full, and starts with no line already made', s.tiles===64 && pre===0, {tiles:s.tiles,pre});
  chk('and there is a move to make', (await p.evaluate(()=>window.__packcrush.moves().length))>0);
  chk('no gift bar in Normal play', await p.evaluate(()=>document.getElementById('giftBox').hidden));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 3. the swap */
console.log('\nswapping');
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await newGame(p,'play');

  let pre=await setup(p,scenario('three'));
  chk('(the board for the next checks starts with no line made)', pre===0, pre);
  await doSwap(p,scenario('three').swap);
  await until(p,()=>window.__packcrush.phase()==='clearing');
  let s=await snap(p);
  chk('three in a line: those three go and score 3 x 60', s.cleared===3 && s.score===180, s);
  chk('...and it costs one move', s.moves===24, s.moves);
  await quiet(p); s=await snap(p);
  chk('the board settles whole again, ready for the next move', s.state==='play' && s.tiles===64, s);

  await setup(p,scenario('none'));
  const s0=await snap(p);
  const before=await p.evaluate(()=>JSON.stringify(window.__packcrush.board()));
  await doSwap(p,scenario('none').swap);
  await sleep(120);
  chk('a swap that lines up nothing goes back...', await until(p,()=>window.__packcrush.state()==='play'));
  s=await snap(p);
  chk('...with the board as it was, no move spent and nothing scored', (await p.evaluate(()=>JSON.stringify(window.__packcrush.board())))===before && s.moves===s0.moves && s.score===s0.score, {s,s0});
  chk('two packs that are not neighbours cannot be swapped', await p.evaluate(()=>window.__packcrush.swap(0,0,0,2)===false && window.__packcrush.swap(0,0,1,1)===false));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 4. making specials */
console.log('\nstriped, wrapped and rainbow packs');
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await newGame(p,'play');
  const made=async(name)=>{ await newGame(p,'play'); await setup(p,scenario(name)); await doSwap(p,scenario(name).swap);
    await until(p,()=>window.__packcrush.phase()==='clearing');
    return p.evaluate(()=>({b:window.__packcrush.board(),s:window.__packcrush.snapshot()})); };
  let r=await made('four');
  chk('four in a line prints a striped pack where the swap was, in the pack it was made of', r.b[3][2] && r.b[3][2].sp===SPN.sv && r.b[3][2].t===0 && r.s.cleared===3, r.b[3][2]);
  r=await made('L');
  chk('an L (here a T of four and three) prints a wrapped pack at the corner', r.b[3][2] && r.b[3][2].sp===SPN.wrap && r.b[3][2].t===0 && r.s.cleared===5, {at:r.b[3][2],cleared:r.s.cleared});
  r=await made('five');
  chk('five in a line prints a rainbow pack', r.b[3][2] && r.b[3][2].sp===SPN.rain && r.s.cleared===4, {at:r.b[3][2],cleared:r.s.cleared});
  await quiet(p);
  chk('and the board carries on whole', (await snap(p)).tiles===64);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 5. two specials, swapped */
console.log('\nspecials, swapped');
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await newGame(p,'play');
  const count=k=>p.evaluate(k=>window.__packcrush.board().flat().filter(t=>t&&t.t===k).length,k);
  const fire=async(sp,swap)=>{ await newGame(p,'play'); const R=rows0(); await p.evaluate(([R,S])=>window.__packcrush.set(R,S),[R,sp]); await doSwap(p,swap);
    await until(p,()=>window.__packcrush.phase()==='clearing'); const s=await snap(p); await quiet(p); return s; };
  let s=await fire({'3,3':SPN.sh,'3,4':SPN.sv},[3,3,3,4]);
  chk('striped + striped: a whole row and a whole column go (15 packs)', s.cleared===15, s.cleared);
  s=await fire({'3,3':SPN.wrap,'3,4':SPN.wrap},[3,3,3,4]);
  chk('wrapped + wrapped: a 5x5 blast (25 packs)', s.cleared===25, s.cleared);
  s=await fire({'3,3':SPN.sh,'3,4':SPN.wrap},[3,3,3,4]);
  chk('striped + wrapped: three rows and three columns (39 packs)', s.cleared===39, s.cleared);
  const k4=(await p.evaluate(()=>{ const R=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>(c+2*r)%6)); return R.flat().filter(k=>k===4).length; }));
  s=await fire({'3,3':SPN.rain},[3,3,3,4]);
  chk('rainbow + a pack: every pack of that kind goes, and the rainbow ('+(k4+1)+')', s.cleared===k4+1, {cleared:s.cleared,k4});
  s=await fire({'3,3':SPN.rain,'3,4':SPN.rain},[3,3,3,4]);
  chk('rainbow + rainbow: the whole board', s.cleared===64, s.cleared);
  s=await fire({'3,3':SPN.rain,'3,4':SPN.sh},[3,3,3,4]);
  chk('rainbow + striped: every pack of its kind turns striped and fires, far more than a plain clear', s.cleared>2*k4+10, {cleared:s.cleared,k4});
  chk('a striped pack beside a plain one is not a move on its own', await (async()=>{ const R=rows0(); await p.evaluate(([R,S])=>window.__packcrush.set(R,S),[R,{'3,3':SPN.sh}]); const before=(await snap(p)).moves;
    await doSwap(p,[3,3,3,4]); await until(p,()=>window.__packcrush.state()==='play'); await sleep(200); return (await snap(p)).moves===before; })());
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 6. levels */
console.log('\nlevels');
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await newGame(p,'play');
  await setup(p,scenario('three'));
  await p.evaluate(()=>window.__packcrush.setMoves(1));
  await doSwap(p,scenario('three').swap);
  await quiet(p); await sleep(1200);
  let r=await p.evaluate(()=>({st:window.__packcrush.state(), shown:!document.getElementById('result').classList.contains('hidden'), win:document.getElementById('result').classList.contains('win'),
    sub:document.getElementById('rSub').textContent, score:+document.getElementById('rScore').textContent, board:JSON.parse(localStorage.getItem('fx.rank.pack-crush')||'[]'), snap:window.__packcrush.snapshot()}));
  chk('out of moves short of the target: the run ends', r.st==='over' && r.shown && !r.win && /Out of moves on level 1/.test(r.sub), r);
  chk('and the result screen shows the real score, which the booth ranking took', r.score===r.snap.score && r.score>0 && r.board.length===1 && r.board[0].s===r.score && r.board[0].n==='Tester', r.board);

  await newGame(p,'play');
  await setup(p,scenario('three'));
  await p.evaluate(()=>{ window.__packcrush.addScore(5900); window.__packcrush.setMoves(10); });
  await doSwap(p,scenario('three').swap);
  await until(p,()=>window.__packcrush.state()==='levelend',20000);
  await sleep(1200);
  r=await p.evaluate(()=>({st:window.__packcrush.state(), up:!document.getElementById('levelup').classList.contains('hidden'), stars:document.querySelectorAll('#luStars .on').length,
    head:document.getElementById('luHead').textContent, bonus:document.getElementById('luBonus').textContent, s:window.__packcrush.snapshot()}));
  chk('reaching the target ends the level, and says so', r.st==='levelend' && r.up && /Level 1 complete/.test(r.head), r);
  chk('the moves left are paid out (9 x 300) on top of the score', /2,700/.test(r.bonus) && r.s.score>=5900+180+2700, r);
  chk('and they decide the stars (9 of 25 moves left: two)', r.stars===2, r.stars);
  await p.click('#luNext'); await until(p,()=>window.__packcrush.state()==='play');
  const n=await snap(p);
  chk('Next level: level 2, a fresh 25 moves, a higher target, a full board', n.level===2 && n.moves===25 && n.target>r.s.target && n.tiles===64 && n.levelScore===0, n);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 7. redeem: stop the instant the target is reached */
console.log('\nredeem gift');
{
  const {c,p,errs,calls}=await open({width:390,height:844},true,2,{on:true,need:400});
  await p.waitForFunction(()=>window.__packcrush.snapshot().giftState==='ready',null,{timeout:6000}).catch(()=>{});
  const ui=await p.evaluate(()=>({txt:document.getElementById('goGift').innerText, dis:document.getElementById('goGift').disabled, play:document.getElementById('goPlay').innerText}));
  chk('with a target set, Redeem gift says what to reach', !ui.dis && ui.txt.includes('400'), ui);
  await p.tap('#goGift'); await until(p,()=>window.__packcrush.state()==='play');
  let s=await snap(p);
  chk('Redeem gift starts a run aimed at 400, with the gift bar', s.mode==='gift' && s.need===400 && !(await p.evaluate(()=>document.getElementById('giftBox').hidden)), s);
  await setup(p,scenario('three'));
  await p.evaluate(()=>window.__packcrush.addScore(399));
  chk('one point short: still playing', (await snap(p)).state==='play');
  await doSwap(p,scenario('three').swap);
  await until(p,()=>window.__packcrush.state()==='won',3000);
  s=await snap(p);
  chk('the very move that reaches it stops the game', s.state==='won' && s.score>=400, s);
  const y1=await p.evaluate(()=>JSON.stringify(window.__packcrush.board())); await sleep(600);
  chk('and nothing carries on falling or clearing afterwards', await p.evaluate(j=>JSON.stringify(window.__packcrush.board())===j,y1));
  await sleep(1000);
  const r=await p.evaluate(()=>({shown:!document.getElementById('result').classList.contains('hidden'), win:document.getElementById('result').classList.contains('win'),
    h:getComputedStyle(document.getElementById('rWin')).display, gift:(document.querySelector('.fxg')||{}).innerText||'', btn:!!document.querySelector('.fxg button')&&getComputedStyle(document.querySelector('.fxg button')).display}));
  chk('"You are a winner!" comes up, gold, with the gift to claim', r.shown && r.win && r.h!=='none' && /earned the gift/i.test(r.gift) && r.btn==='inline-block', r);
  await p.tap('.fxg button'); await sleep(900);
  chk('claiming hands over the code', /waiting/i.test(await p.evaluate(()=>(document.querySelector('.fxg')||{}).innerText||'')) && calls.some(q=>q.action==='gift.claim'&&q.game==='pack-crush'&&q.score>=400), calls.map(q=>q.action));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
{
  const {c,p,errs}=await open({width:1366,height:768},false,1,{on:true,need:400});
  await p.waitForFunction(()=>window.__packcrush.snapshot().giftState==='ready',null,{timeout:6000}).catch(()=>{});
  await p.click('#goPlay'); await until(p,()=>window.__packcrush.state()==='play');
  await setup(p,scenario('three')); await p.evaluate(()=>{ window.__packcrush.addScore(9000); window.__packcrush.setMoves(1); });
  await doSwap(p,scenario('three').swap);
  await until(p,()=>['over','levelend'].includes(window.__packcrush.state()),20000); await sleep(1500);
  const r=await p.evaluate(()=>({st:window.__packcrush.state(), win:document.getElementById('result').classList.contains('win'), gift:(document.querySelector('.fxg')&&document.querySelector('.fxg').style.display)||'none'}));
  chk('a Normal run past the gift score is never stopped or offered a gift', r.st!=='won' && !r.win && r.gift==='none', r);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
{
  const {c,p}=await open({width:1366,height:768},false,1,{on:false,need:400});
  await sleep(900);
  const ui=await p.evaluate(()=>({gs:window.__packcrush.snapshot().giftState, dis:document.getElementById('goGift').disabled}));
  chk('with gifts off, Redeem gift is greyed out; Normal play still starts', ui.gs==='off' && ui.dis && (await (async()=>{ await p.click('#goPlay'); return until(p,()=>window.__packcrush.state()==='play'); })()), ui);
  await c.close();
}

/* ───────────────────────── 8. moving a pack: drag, two taps, keys */
console.log('\nmoving packs');
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await newGame(p,'play');
  await setup(p,scenario('three'));
  let a=await cellXY(p,3,2);
  await p.mouse.move(a.x,a.y); await p.mouse.down(); await p.mouse.move(a.x+a.step*.7,a.y,{steps:6}); await p.mouse.up();
  await until(p,()=>window.__packcrush.phase()==='clearing',3000);
  let s=await snap(p);
  chk('dragging a pack onto its neighbour swaps them', s.moves===24 && s.cleared===3, s);
  await quiet(p);

  await newGame(p,'play'); await setup(p,scenario('three'));
  a=await cellXY(p,3,2); const t=await cellXY(p,3,3);
  await p.mouse.click(a.x,a.y); await sleep(80); await p.mouse.click(t.x,t.y);
  await until(p,()=>window.__packcrush.phase()==='clearing',3000);
  s=await snap(p);
  chk('tapping a pack and then its neighbour swaps them', s.moves===24 && s.cleared===3, s);
  await quiet(p);

  await newGame(p,'play'); await setup(p,scenario('three'));
  const far=await cellXY(p,6,6);
  await p.mouse.click(a.x,a.y); await sleep(80); await p.mouse.click(far.x,far.y); await sleep(300);
  chk('tapping a pack and one far away just picks the second up', (await snap(p)).moves===25);
  await p.mouse.click(far.x,far.y); await sleep(100);

  await newGame(p,'play'); await setup(p,scenario('three'));
  await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft');
  await p.keyboard.press('Space'); await p.keyboard.press('ArrowRight');
  await until(p,()=>window.__packcrush.phase()==='clearing',3000);
  chk('the keyboard can pick one up and swap it too', (await snap(p)).moves===24);
  await quiet(p);

  await p.keyboard.press('p'); await sleep(200);
  chk('P pauses and shows the pause screen', await p.evaluate(()=>window.__packcrush.state()==='pause' && !document.getElementById('paused').classList.contains('hidden')));
  await p.keyboard.press('p'); await sleep(200);
  chk('P again carries on', await p.evaluate(()=>window.__packcrush.state()==='play'));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 9. hint, shuffle, a board with nothing left */
console.log('\nhint and shuffle');
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await newGame(p,'play');
  await p.click('.tools [data-a=hint]'); await sleep(300);
  chk('Hint shows a move without spending one', (await snap(p)).moves===25 && (await snap(p)).state==='play');
  await p.click('.tools [data-a=shuffle]'); await until(p,()=>window.__packcrush.state()==='play');
  const s=await snap(p);
  const ok=await p.evaluate(()=>window.__packcrush.moves().length>0);
  chk('Shuffle costs one move and leaves a whole board with a move on it', s.moves===24 && s.tiles===64 && ok, s);
  await setup(p,{R:rows0(),S:{}});
  const dead=(await p.evaluate(()=>window.__packcrush.moves().length))===0;
  chk('(the board for the next check has no move on it)', dead);
  await p.evaluate(()=>window.__packcrush.endMove());
  await until(p,()=>window.__packcrush.state()==='play',8000);
  chk('a board with no move left is reshuffled on its own, free, into one that has', (await p.evaluate(()=>window.__packcrush.moves().length))>0 && (await snap(p)).moves===24);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 10. a whole run, every move checked */
console.log('\na whole run, played by a bot');
{
  const {c,p,errs}=await open({width:1000,height:700},false,1);
  await newGame(p,'play');
  let moves=0, broken=[], t0=Date.now(), prev=25, spentOk=true, lvlSeen=1;
  while(Date.now()-t0<55000){
    const st=await snap(p); if(st.state==='over'||st.state==='won') break;
    if(st.state==='levelend'){ lvlSeen=Math.max(lvlSeen,st.level); await p.click('#luNext'); await sleep(200); prev=25; continue; }
    if(st.state==='play'){
      const inv=await p.evaluate(()=>{ const b=window.__packcrush.board(); let n=0,runs=0; b.forEach(r=>r.forEach(t=>{ if(t) n++; }));
        for(let r=0;r<8;r++) for(let c=0;c<6;c++) if(b[r][c]&&b[r][c+1]&&b[r][c+2]&&b[r][c].t>=0&&b[r][c].t===b[r][c+1].t&&b[r][c].t===b[r][c+2].t) runs++;
        for(let c=0;c<8;c++) for(let r=0;r<6;r++) if(b[r][c]&&b[r+1][c]&&b[r+2][c]&&b[r][c].t>=0&&b[r][c].t===b[r+1][c].t&&b[r][c].t===b[r+2][c].t) runs++;
        return {n,runs,moves:window.__packcrush.moves().length}; });
      if(inv.n!==64||inv.runs||!inv.moves) broken.push(inv);
      if(st.moves>prev) spentOk=false; prev=st.moves;
      await p.evaluate(()=>{ const m=window.__packcrush.moves(); const x=m[Math.floor(Math.random()*m.length)]; window.__packcrush.swap(x.r1,x.c1,x.r2,x.c2); }); moves++;
    }
    await sleep(25);
  }
  const f=await snap(p);
  console.log('        '+moves+' moves played, reached level '+Math.max(lvlSeen,f.level)+', score '+f.score);
  chk('after every move the board is full, with no line left standing and a move to make', moves>=15 && broken.length===0, {moves,broken:broken.slice(0,3)});
  chk('moves only ever go down', spentOk);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

/* ───────────────────────── 11. a still board does not burn the battery */
console.log('\nidle');
{
  const {c,p,errs}=await open({width:1366,height:768},false,1);
  await newGame(p,'play'); await quiet(p); await sleep(2600);   /* the level banner has gone by now */
  const r0=await p.evaluate(()=>window.__rafs); await sleep(1500); const r1=await p.evaluate(()=>window.__rafs);
  const sp=await p.evaluate(()=>window.__packcrush.snapshot().specials);
  chk('a still board with no special on it is not redrawn at all ('+(r1-r0)+' frames in 1.5 s)', !sp && r1-r0<=4, {frames:r1-r0,sp});
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

await b.close(); srv.close();
console.log(bad?`\n${bad} FAILED`:'\nALL PASS'); process.exit(bad?1:0);
