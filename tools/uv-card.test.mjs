/* UV Card, played by a synthetic thumb.

   What is proved: the page loads with no errors, Start deals four cards that
   all fit on the screen, tapping one brings it to the centre and clears the
   rest, the lens follows the finger, the ink number stays pinned to the
   brochure while the lens moves, stopping over it reveals the number the
   game chose, and Play again starts over. For smoothness it checks the two
   things that make a drag stutter on a phone and can be measured headlessly:
   layout reads per move (must be none) and long tasks (must be none).

   What is not proved: frame rate on a real Android GPU. Headless Chromium
   under SwiftShader tells you nothing useful about that. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const {chromium}=pkg;
const PAGE='file:///workspace/facerinna-showcase/uv-card.html';
const SHOTS=process.env.SHOTS ? process.env.SHOTS.replace(/\/$/,'')+'/' : null;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, ms=2500, step=40){ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(step);} return fn(); }

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
async function open(size, query=''){
  const c=await b.newContext({viewport:size,isMobile:true,hasTouch:true,deviceScaleFactor:2});
  const p=await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{ if(m.type()==='error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.route('**/*', r=>{const u=r.request().url();
    return (u.startsWith('file://')||u.startsWith('data:')||u.startsWith('blob:'))?r.continue():r.abort();});
  await p.goto(PAGE+query,{waitUntil:'load'});
  await sleep(300);
  return {c,p,errs};
}
const st = p => p.evaluate(()=>window.__uv.state());
const rect = (p,sel) => p.evaluate(s=>{const r=document.querySelector(s).getBoundingClientRect();
  return {x:r.left,y:r.top,w:r.width,h:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2};}, sel);
const inside = (r,W,H,slack=1) => r.x>=-slack && r.y>=-slack && r.x+r.w<=W+slack && r.y+r.h<=H+slack;
const cardRects = p => p.evaluate(()=>[...document.querySelectorAll('.card')].map(c=>{
  const r=c.getBoundingClientRect(), s=getComputedStyle(c);
  return {x:r.left,y:r.top,w:r.width,h:r.height,op:+s.opacity,vis:s.visibility,img:c.querySelector('img').naturalWidth>0};}));

/* ------------------------------------------------------------------ portrait */
{
  const W=390,H=844;
  const {c,p,errs}=await open({width:W,height:H});
  chk('loads: the intro is showing, the deck is not',
      await p.evaluate(()=>getComputedStyle(document.getElementById('intro')).opacity==='1'
                         && getComputedStyle(document.getElementById('deck')).visibility==='hidden'));
  chk('loads: nothing is asked of the player but Start (no name gate)', !(await p.$('#fxrName')));
  if(SHOTS) await p.screenshot({path:SHOTS+'uv-1-intro.png'});

  await p.tap('#startBtn');
  chk('start: four cards deal in', await until(async()=>(await st(p)).phase==='pick'));
  let cs=await cardRects(p);
  chk('start: all four show the brochure', cs.length===4 && cs.every(r=>r.img));
  chk('start: all four are fully visible and on screen', cs.every(r=>r.op===1 && r.vis==='visible' && inside(r,W,H)), cs);
  chk('start: two columns, two rows', new Set(cs.map(r=>Math.round(r.x))).size===2 && new Set(cs.map(r=>Math.round(r.y))).size===2, cs);
  const overlap=cs.some((a,i)=>cs.some((b,j)=>j>i && a.x<b.x+b.w && b.x<a.x+a.w && a.y<b.y+b.h && b.y<a.y+a.h));
  chk('start: none of them overlap', !overlap);
  chk('start: the intro is gone', await p.evaluate(()=>getComputedStyle(document.getElementById('intro')).opacity==='0'));
  if(SHOTS) await p.screenshot({path:SHOTS+'uv-2-deck.png'});
  const small=cs[1];

  /* instrument before anything moves */
  await p.evaluate(()=>{
    window.__reads=0; window.__count=false;
    const o=Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect=function(){ if(window.__count) window.__reads++; return o.apply(this,arguments); };
    for(const k of ['offsetWidth','offsetHeight','clientWidth','clientHeight']){
      const d=Object.getOwnPropertyDescriptor(HTMLElement.prototype,k)||Object.getOwnPropertyDescriptor(Element.prototype,k);
      if(d&&d.get) Object.defineProperty(HTMLElement.prototype,k,{get(){ if(window.__count) window.__reads++; return d.get.call(this); },configurable:true});
    }
    window.__long=0; window.__longs=[];
    try{ new PerformanceObserver(l=>{ for(const e of l.getEntries()){ window.__long++; window.__longs.push({at:Math.round(e.startTime),ms:Math.round(e.duration)}); } }).observe({type:'longtask'}); }catch(e){}
  });

  await p.tap('.card[data-i="1"]');
  chk('choose: the game moves to the search phase', await until(async()=>(await st(p)).phase==='search'));
  let s=await st(p);
  chk('choose: the chosen card is the one tapped', s.chosen===1 && s.number===s.numbers[1], s);
  const big=await rect(p,'.card[data-i="1"]');
  chk('choose: it is much larger than it was', big.w>small.w*1.6, {before:small.w, after:big.w});
  chk('choose: centred across the screen', Math.abs(big.cx-W/2)<2, big);
  chk('choose: entirely on screen', inside(big,W,H), big);
  cs=await cardRects(p);
  chk('choose: the other three are gone', cs.every((r,i)=>i===1 || r.op===0 || r.vis==='hidden'), cs);
  const lens=await rect(p,'#lens');
  chk('lens: visible and on screen', await until(()=>p.evaluate(()=>getComputedStyle(document.getElementById('lens')).opacity==='1')) && inside(lens,W,H), lens);
  chk('lens: resting on the card', lens.cy>big.y && lens.cy<big.y+big.h+lens.h, {lens,big});

  /* the ink stays pinned to the brochure whatever the lens does */
  const pinned=async()=>{ const was=await p.evaluate(()=>{const w=window.__count; window.__count=false; return w;});
    const r=await rect(p,'#inkNum'); const t=await st(p);
    await p.evaluate(w=>{ window.__count=w; }, was);
    return Math.hypot(r.cx-t.spot.x, r.cy-t.spot.y)<2.5; };
  chk('ink: the number sits where the game put it on the brochure', await pinned());

  /* drag: grab the lens by its centre and sweep the brochure like a player
     would, stopping the moment the number is under the glass */
  await p.evaluate(()=>{ window.__count=true; window.__reads=0; window.__long=0; });
  await p.mouse.move(lens.cx, lens.cy);
  await p.mouse.down();
  await p.mouse.move(lens.cx+30, lens.cy-40, {steps:6});
  let l2=await st(p);
  chk('lens: follows the finger', Math.abs((l2.lens.x+l2.lens.w/2)-(lens.cx+30))<2 && Math.abs((l2.lens.y+l2.lens.h/2)-(lens.cy-40))<2, l2.lens);
  chk('ink: still pinned while the lens has moved', await pinned());
  let sawIt=false, moves=0;
  outer:
  for(let y=big.y+l2.lens.h/2; y<=big.y+big.h-l2.lens.h/2+1; y+=l2.lens.h*0.45){
    for(let x=big.x+l2.lens.w/2; x<=big.x+big.w-l2.lens.w/2+1; x+=12){
      await p.mouse.move(x,y,{steps:2}); moves++;
      const t=await st(p);
      const pad=Math.round(t.big.w*0.40)*0.22;
      const under = t.spot.x>t.lens.x+pad && t.spot.x<t.lens.x+t.lens.w-pad && t.spot.y>t.lens.y+pad && t.spot.y<t.lens.y+t.lens.h-pad;
      if(under){ sawIt=true; break outer; }
    }
  }
  chk('search: the number came under the glass during the sweep ('+moves+' moves)', sawIt);
  chk('search: nothing is revealed while the finger is still passing over it', !(await st(p)).found);
  if(SHOTS) await p.screenshot({path:SHOTS+'uv-3-lens.png'});
  chk('search: holding still over it reveals it', await until(async()=>(await st(p)).found, 1500));
  await p.mouse.up();
  const perf=await p.evaluate(()=>({reads:window.__reads, long:window.__long, longs:window.__longs, now:Math.round(performance.now())}));
  await p.evaluate(()=>{ window.__count=false; });
  chk('smooth: the drag read no layout at all ('+moves+' moves, '+perf.reads+' reads)', perf.reads===0, perf);
  chk('smooth: no long task during the drag', perf.long===0, perf);

  s=await st(p);
  chk('reveal: the badge appears on top of the card', await until(()=>p.evaluate(()=>document.getElementById('reveal').classList.contains('on')), 1500));
  const badge=await rect(p,'#reveal .badge');
  chk('reveal: it is inside the card\'s frame', badge.cx>big.x && badge.cx<big.x+big.w && badge.cy>big.y && badge.cy<big.y+big.h, {badge,big});
  const shown=await p.textContent('#bigNum');
  chk('reveal: it shows the number this card hid', shown===s.number && s.numbers.includes(shown), {shown, s});
  chk('reveal: the lens no longer takes the finger', await p.evaluate(()=>getComputedStyle(document.getElementById('lens')).pointerEvents==='none'));
  if(SHOTS) await p.screenshot({path:SHOTS+'uv-4-reveal.png'});

  /* turning the phone with the result up */
  await p.setViewportSize({width:H,height:W});
  await sleep(500);
  const big2=await rect(p,'.card[data-i="1"]'), badge2=await rect(p,'#reveal .badge');
  chk('rotate: the card refits the landscape screen', inside(big2,H,W) && big2.h>W*0.5, big2);
  chk('rotate: the badge stays on it', badge2.cx>big2.x && badge2.cx<big2.x+big2.w, {badge2,big2});
  await p.setViewportSize({width:W,height:H});
  await sleep(500);

  await p.tap('#againBtn');
  chk('again: four cards are dealt once more', await until(async()=>(await st(p)).phase==='pick'));
  cs=await cardRects(p);
  chk('again: all four back, visible, on screen', cs.length===4 && cs.every(r=>r.op===1 && r.vis==='visible' && inside(r,W,H)), cs);
  chk('again: the result and the lens are put away', await p.evaluate(()=>!document.getElementById('reveal').classList.contains('on')
      && getComputedStyle(document.getElementById('lens')).opacity==='0'));

  /* a finger landing away from the lens brings the lens to it */
  await p.tap('.card[data-i="3"]');
  await until(async()=>(await st(p)).phase==='search');
  const b3=await rect(p,'.card[data-i="3"]');
  const tx=b3.x+b3.w*0.5, ty=b3.y+b3.h*0.3;
  await p.mouse.move(tx,ty); await p.mouse.down(); await sleep(260);
  const t3=await st(p);
  chk('lens: a touch elsewhere brings the lens under the finger', Math.abs(t3.lens.x+t3.lens.w/2-tx)<2 && Math.abs(t3.lens.y+t3.lens.h/2-ty)<2, {want:{tx,ty},lens:t3.lens});
  await p.mouse.up();

  chk('portrait: no page errors'+(errs.length?': '+errs[0]:''), errs.length===0);
  await c.close();
}

/* ------------------------------------------------------------------ landscape, small phone */
for(const size of [{width:844,height:390},{width:360,height:640}]){
  const W=size.width,H=size.height;
  const {c,p,errs}=await open(size);
  await p.tap('#startBtn');
  await until(async()=>(await st(p)).phase==='pick');
  const cs=await cardRects(p);
  const rows=new Set(cs.map(r=>Math.round(r.y))).size;
  chk(`${W}x${H}: four cards on screen, none clipped`, cs.length===4 && cs.every(r=>inside(r,W,H)), cs);
  chk(`${W}x${H}: laid out ${W>H?'in one row':'two by two'}`, W>H ? rows===1 : rows===2, cs);
  chk(`${W}x${H}: the page does not scroll`, await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight));
  await p.tap('.card[data-i="0"]');
  await until(async()=>(await st(p)).phase==='search');
  const big=await rect(p,'.card[data-i="0"]'), lens=await rect(p,'#lens');
  chk(`${W}x${H}: the chosen card and the lens fit the screen`, inside(big,W,H) && inside(lens,W,H), {big,lens});
  if(SHOTS) await p.screenshot({path:SHOTS+`uv-5-${W}x${H}.png`});
  chk(`${W}x${H}: no page errors`+(errs.length?': '+errs[0]:''), errs.length===0);
  await c.close();
}

/* ------------------------------------------------------------------ the booth's own numbers */
{
  const {c,p,errs}=await open({width:390,height:844},'?numbers=7,14,21,28');
  await p.tap('#startBtn');
  await until(async()=>(await st(p)).phase==='pick');
  const s=await st(p);
  chk('?numbers: the four cards hold the four numbers given, shuffled', s.numbers.slice().sort((a,b)=>a-b).join()==='14,21,28,7'.split(',').sort((a,b)=>a-b).join(), s.numbers);
  await p.tap('.card[data-i="2"]');
  await until(async()=>(await st(p)).phase==='search');
  const t=await st(p);
  /* put the lens straight onto the spot and hold */
  await p.mouse.move(t.spot.x, t.spot.y); await p.mouse.down();
  chk('?numbers: holding the glass over the spot reveals it', await until(async()=>(await st(p)).found, 1500));
  await p.mouse.up();
  await until(()=>p.evaluate(()=>document.getElementById('reveal').classList.contains('on')), 1500);
  chk('?numbers: the number shown is from that set', ['7','14','21','28'].includes(await p.textContent('#bigNum')));
  chk('?numbers: no page errors'+(errs.length?': '+errs[0]:''), errs.length===0);
  await c.close();
}

/* ------------------------------------------------------------------ back to the four, pick a second */
{
  const W=390,H=844;
  const {c,p,errs}=await open({width:W,height:H});
  const findIt=async()=>{ const t=await st(p); await p.mouse.move(t.spot.x,t.spot.y); await p.mouse.down();
    const ok=await until(async()=>(await st(p)).found, 1500); await p.mouse.up();
    await until(()=>p.evaluate(()=>document.getElementById('reveal').classList.contains('on')), 1500); return ok; };
  const hud=()=>p.evaluate(()=>({cards:!document.getElementById('cardsBtn').hidden && getComputedStyle(document.getElementById('cardsBtn')).display!=='none',
    booth:!document.getElementById('boothLink').hidden}));
  await p.tap('#startBtn'); await until(async()=>(await st(p)).phase==='pick');
  const dealt=(await st(p)).numbers;
  let h=await hud(); chk('back: with four cards up, the corner says Booth, not Cards', h.booth && !h.cards, h);
  await p.tap('.card[data-i="1"]'); await until(async()=>(await st(p)).phase==='search');
  h=await hud(); chk('back: with one card up, the corner says Cards', h.cards && !h.booth, h);
  chk('back: found the first number', await findIt());
  const first=(await st(p)).number;
  chk('back: the result bar offers Pick another', await p.evaluate(()=>{const b=document.getElementById('pickBtn'); return !b.hidden && getComputedStyle(b).display!=='none';}));

  await p.tap('#cardsBtn');
  chk('back: Cards brings the four back', await until(async()=>(await st(p)).phase==='pick'));
  let cs=await cardRects(p);
  chk('back: all four visible and on screen again', cs.length===4 && cs.every(r=>r.op===1 && r.vis==='visible' && inside(r,W,H)), cs);
  let s=await st(p);
  chk('back: same deal, numbers not reshuffled', s.numbers.join()===dealt.join(), {before:dealt, after:s.numbers});
  const done=await p.evaluate(()=>{const c=document.querySelector('.card[data-i="1"]'); return {done:c.classList.contains('done'), disabled:c.disabled, stamp:c.querySelector('.stamp').textContent, shown:getComputedStyle(c.querySelector('.stamp')).display};});
  chk('back: the found card comes back stamped with its number and out of play', done.done && done.disabled && done.stamp===first && done.shown!=='none', done);
  chk('back: the others are still in play', await p.evaluate(()=>[0,2,3].every(i=>{const c=document.querySelector('.card[data-i="'+i+'"]'); return !c.disabled && !c.classList.contains('done');})));
  chk('back: lens and result are put away', await p.evaluate(()=>getComputedStyle(document.getElementById('lens')).opacity==='0' && !document.getElementById('reveal').classList.contains('on')));
  h=await hud(); chk('back: the corner is Booth again', h.booth && !h.cards, h);

  await p.tap('.card[data-i="1"]',{force:true}); await sleep(500);   // a disabled button; force past the actionability wait
  chk('back: tapping the stamped card does nothing', (await st(p)).phase==='pick');

  await p.tap('.card[data-i="2"]'); await until(async()=>(await st(p)).phase==='search');
  chk('back: a second card can be chosen and hides its own number', (await st(p)).chosen===2 && (await st(p)).number===dealt[2]);
  await p.tap('#cardsBtn'); await until(async()=>(await st(p)).phase==='pick');
  chk('back: leaving before finding it does not stamp it', await p.evaluate(()=>{const c=document.querySelector('.card[data-i="2"]'); return !c.disabled && !c.classList.contains('done');}));
  chk('back: and it is not counted as revealed', Object.keys((await st(p)).revealed).join()==='1');

  /* find the other three, returning through the result bar each time */
  for(const i of [0,2,3]){
    await p.tap('.card[data-i="'+i+'"]'); await until(async()=>(await st(p)).phase==='search');
    chk('back: card '+i+' found', await findIt());
    const last = i===3;
    chk('back: Pick another is '+(last?'gone once all four are found':'still offered'), await p.evaluate(()=>{const b=document.getElementById('pickBtn'); return b.hidden || getComputedStyle(b).display==='none';})===last);
    if(!last){ await p.tap('#pickBtn'); chk('back: Pick another brings the four back', await until(async()=>(await st(p)).phase==='pick')); }
  }
  await p.tap('#cardsBtn'); await until(async()=>(await st(p)).phase==='pick');
  s=await st(p);
  chk('back: all four stamped', Object.keys(s.revealed).length===4 && await p.evaluate(()=>[...document.querySelectorAll('.card')].every(c=>c.classList.contains('done') && c.disabled)));
  chk('back: the stamps are the dealt numbers', [0,1,2,3].every(i=>s.revealed[i]===dealt[i]), {revealed:s.revealed, dealt});
  chk('back: with nothing left to pick, Play again is offered', await p.evaluate(()=>document.getElementById('actions').classList.contains('on')));
  await p.tap('#againBtn'); await until(async()=>(await st(p)).phase==='pick');
  chk('back: Play again clears the stamps', await p.evaluate(()=>[...document.querySelectorAll('.card')].every(c=>!c.classList.contains('done') && !c.disabled && c.querySelector('.stamp').textContent==='')) && Object.keys((await st(p)).revealed).length===0);
  chk('back: no page errors'+(errs.length?': '+errs[0]:''), errs.length===0);
  await c.close();
}

await b.close();
console.log(bad? '\nSOMETHING IS WRONG' : '\nuv card: deals, picks, slides, reveals');
process.exit(bad?1:0);
