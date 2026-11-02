/* The six older games (Match Lab, Pack Match, Shelf Shot, Deep Lab, Lab Run,
   Facy Run) open on the same two buttons as the newer ones.

   Redeem gift: the target comes from the gift desk (never a number in the
   page); with gifts off, or no target for the game, the button is greyed out
   and says so; a run STOPS the moment the score reaches the target and shows
   the winner screen. Normal play never stops on a number and never offers a
   gift. Then Facy Run steers by touch: slide to run, tap or flick up to jump,
   and there is no button on screen.

   Every call to the booth scripts is answered here. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8284, BASE='http://127.0.0.1:'+PORT;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++; console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x).slice(0,300):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.jpg':'image/jpeg','.glb':'model/gltf-binary'};
const srv=http.createServer((q,r)=>{
  const f=decodeURIComponent(new URL(q.url,BASE).pathname), fp=path.join(ROOT,f);
  if(f==='/sw.js'||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ r.writeHead(404); return r.end(); }
  r.writeHead(200,{'Content-Type':TYPES[path.extname(fp)]||'application/octet-stream','Cache-Control':'no-store'}); r.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});

/* how to get each game to the point where a run is on */
const GAMES=[
  {id:'match-lab',  name:'Match Lab',  level:false},
  {id:'lab-run',    name:'Lab Run',    level:false},
  {id:'pack-match', name:'Pack Match', level:true},
  {id:'shelf-shot', name:'Shelf Shot', level:true},
  {id:'deep-lab',   name:'Deep Lab',   level:true},
  {id:'facy-run',   name:'Facy Run',   level:false},
];
async function open(G,gift,vp={width:1366,height:768},touch=false){
  const c=await b.newContext({viewport:vp,isMobile:touch,hasTouch:touch,deviceScaleFactor:touch?2:1});
  await c.route(u=>!u.href.startsWith(BASE),r=>r.abort());
  await c.route(BASE+'/api',async r=>{
    let q={}; try{ q=JSON.parse(r.request().postData()||'{}'); }catch(e){}
    const out=q.action==='config'?{ok:true,settings:{gift_active:gift.on?'yes':'no'},gift_needs:gift.need?{[G.id]:gift.need}:{}}
      :q.action==='gift.claim'?(q.score>=gift.need?{ok:true,claim:'55555555-5555-4555-8555-555555555555'}:{ok:false,reason:'short'}):{ok:true};
    await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(out)});
  });
  await c.addInitScript((api)=>{ window.__BOOTH_API=api; try{ localStorage.setItem('fx.player','Tester'); }catch(e){} },BASE+'/api');
  const p=await c.newPage(); const errs=[];
  p.on('pageerror',e=>errs.push(e.message.slice(0,120)));
  await p.goto(BASE+'/'+G.id+'.html',{waitUntil:'load'});
  await p.waitForFunction(()=>window.__fxModes&&__fxModes.snapshot().giftState!=='wait',null,{timeout:12000}).catch(()=>{});
  await sleep(600);
  return {c,p,errs};
}
const snap=p=>p.evaluate(()=>window.__fxModes.snapshot());
const shown=(p,sel)=>p.evaluate(s=>{ const e=document.querySelector(s); return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display!=='none'; },sel);
/* start a run in a mode, and get past the level pick where there is one */
async function run(p,G,mode){
  await p.evaluate(m=>__fxModes.start(m),mode);
  if(G.level){
    await p.waitForSelector('#lvGrid .lvb:not([disabled]), #grid .lvb:not([disabled]), .lvb:not([disabled])',{timeout:8000});
    await p.evaluate(()=>document.querySelector('.lvb:not([disabled])').click());
  }
  await sleep(G.level?2500:900);
}

for(const G of GAMES){
  console.log('\n══ '+G.name+' ══');
  console.log('the two buttons');
  {
    const {c,p,errs}=await open(G,{on:true,need:300});
    const v=await p.evaluate(()=>{ const R=e=>{ const b=e.getBoundingClientRect(); return {t:b.top,b:b.bottom,l:b.left,r:b.right,h:b.height}; };
      const g=document.getElementById('goGift'), n=document.getElementById('goPlay'); return {g:R(g),n:R(n),gt:g.innerText,nt:n.innerText,gd:g.disabled,nd:n.disabled,iw:innerWidth,ih:innerHeight}; });
    chk('Redeem gift says what to reach, and is open', /300/.test(v.gt) && !v.gd, v);
    chk('Normal play is open', /Normal play/.test(v.nt) && !v.nd);
    chk('both are tall enough to tap and on screen', v.g.h>=40 && v.n.h>=40 && v.g.l>=0 && v.g.r<=v.iw && v.n.l>=0 && v.n.r<=v.iw, v);
    chk('the old single Start button is no longer showing', await p.evaluate(()=>{ const ids=['playBtn','startBtn','start']; return ids.every(i=>{ const e=document.getElementById(i); return !e || e.tagName!=='BUTTON' || getComputedStyle(e).display==='none'; }); }));
    chk('no page errors', errs.length===0, errs);
    await c.close();
  }
  for(const [label,gift,want,txt] of [['gifts off',{on:false,need:300},'off',/not on/],['no target set',{on:true,need:0},'unset',/No gift target/]]){
    const {c,p}=await open(G,gift);
    const v=await p.evaluate(()=>({d:document.getElementById('goGift').disabled,t:document.getElementById('giftSub').textContent,n:document.getElementById('goPlay').disabled}));
    const s=await snap(p);
    chk(label+': Redeem gift is greyed out and says why'+(want==='unset'?', with no default number':''), s.giftState===want && v.d && txt.test(v.t) && (want!=='unset' || s.giftNeed===null), {s,v});
    chk(label+': Normal play still open', !v.n);
    await c.close();
  }

  console.log('a Redeem gift run');
  {
    const {c,p,errs}=await open(G,{on:true,need:300});
    await run(p,G,'gift');
    const s0=await snap(p);
    chk('it is a gift run aimed at 300', s0.mode==='gift' && s0.need===300, s0);
    chk('the gift panel may speak on this run', await p.evaluate(()=>window.FX_RANK.giftGate()===true));
    if(G.level||G.id==='facy-run') chk('it reports the level the run is on (the tournament adds levels up)', (await snap(p)).level>=1, await snap(p));
    await p.evaluate(()=>__fxModes.addScore(120)); await sleep(500);
    chk('short of the target it keeps going: the result screen is not up', await p.evaluate(()=>document.querySelector(window.FX_RANK.result).classList.contains('hidden')));
    const before=await p.evaluate(()=>__fxModes.snapshot().won);
    chk('...and has not won', before===false, before);
    await p.evaluate(()=>__fxModes.addScore(200));            // 320: over the line
    const t0=Date.now();
    await p.waitForFunction(()=>__fxModes.snapshot().won===true,null,{timeout:3000}).catch(()=>{});
    chk('the run stops the moment the score passes the target (within '+(Date.now()-t0)+' ms)', (await snap(p)).won===true);
    await sleep(1600);
    const r=await p.evaluate(()=>{ const sel=window.FX_RANK.result, e=document.querySelector(sel); return {hidden:e.classList.contains('hidden'), win:e.classList.contains('win'), text:(e.querySelector('.fxm-banner')||{}).innerText||''}; });
    chk('the winner screen shows: Gift unlocked, and the target', !r.hidden && r.win && /Gift unlocked/.test(r.text) && /300/.test(r.text), r);
    chk('no page errors', errs.length===0, errs);
    await c.close();
  }

  console.log('a Normal play run');
  {
    const {c,p,errs}=await open(G,{on:true,need:300});
    await run(p,G,'play');
    const s0=await snap(p);
    chk('it is a normal run, no target', s0.mode==='play' && s0.need===0, s0);
    chk('the gift panel is told to stay quiet', await p.evaluate(()=>window.FX_RANK.giftGate()===false));
    await p.evaluate(()=>__fxModes.addScore(5000)); await sleep(1500);
    const r=await p.evaluate(()=>{ const e=document.querySelector(window.FX_RANK.result); return {hidden:e.classList.contains('hidden'), banner:!!e.querySelector('.fxm-banner')}; });
    chk('well past 300 and still playing: Normal play never stops on a number', r.hidden && r.banner===false, r);
    /* the result screen coming up on a Normal run must not wake the page's own observer into a loop (it once froze the tab) */
    await p.evaluate(()=>{ const e=document.querySelector(window.FX_RANK.result); e.classList.remove('hidden'); });
    const alive=await Promise.race([p.evaluate(()=>{ const e=document.querySelector(window.FX_RANK.result); return !e.querySelector('.fxm-banner') && !e.classList.contains('win'); }), sleep(8000).then(()=>'frozen')]);
    chk('the result screen on Normal play comes up, with no winner line, and the page stays alive', alive===true, alive);
    chk('no page errors', errs.length===0, errs);
    await c.close();
  }
}

/* ───────────────────────── Facy Run steers by touch */
console.log('\n══ Facy Run: the screen is the controller ══');
{
  const G=GAMES[5];
  const {c,p,errs}=await open(G,{on:true,need:300},{width:844,height:390},true);
  chk('no on-screen pad (left, right, jump buttons) on a touch screen', await p.evaluate(()=>getComputedStyle(document.getElementById('ctl')).display==='none'));
  chk('the hint says to slide and tap', await p.evaluate(()=>/Slide/.test(document.getElementById('touchHint').textContent) && !/▲/.test(document.getElementById('touchHint').textContent)));
  await p.evaluate(()=>__fxModes.start('play')); await sleep(500);
  const ev=(type,id,x,y)=>p.evaluate(([t,i,x,y])=>{ const cv=document.getElementById('stage'); cv.dispatchEvent(new PointerEvent(t,{pointerId:i,pointerType:'touch',isPrimary:i===7,clientX:x,clientY:y,bubbles:true,cancelable:true})); },[type,id,x,y]);
  const K=()=>p.evaluate(()=>({l:__facy.keys.left,r:__facy.keys.right,j:__facy.keys.jump,px:Math.round(__facy.S().px),phase:__facy.S().phase,vy:__facy.S().vy}));
  chk('the run is on', (await K()).phase==='play');
  const x0=(await K()).px;
  await ev('pointerdown',7,300,200);
  let k=await K(); chk('a finger put down and still does nothing yet', !k.l && !k.r, k);
  await ev('pointermove',7,380,200);
  k=await K(); chk('slide right: Facy runs right', k.r && !k.l, k);
  await p.evaluate(()=>__facy.step(40));
  chk('...and the world moves', (await K()).px>x0, [x0,(await K()).px]);
  await ev('pointermove',7,250,200);
  k=await K(); chk('slide back left: runs left, right lets go', k.l && !k.r, k);
  await ev('pointermove',7,420,200); await ev('pointermove',7,425,200);
  k=await K(); chk('the spot the finger landed on follows it: one short slide turns round', k.r && !k.l, k);
  await ev('pointerup',7,425,200);
  k=await K(); chk('finger up: stops', !k.l && !k.r, k);
  await p.evaluate(()=>__facy.step(120));
  /* a quick tap jumps */
  const g0=await p.evaluate(()=>({gr:__facy.S().grounded,py:__facy.S().py}));
  await ev('pointerdown',7,300,200); await ev('pointerup',7,300,200);
  await p.evaluate(()=>__facy.step(8));
  const j=await p.evaluate(()=>({py:__facy.S().py,vy:__facy.S().vy}));
  chk('a quick tap jumps', j.vy<0 || j.py<g0.py-2, {g0,j});
  await p.evaluate(()=>__facy.step(200));
  /* a flick up jumps and does not run */
  await ev('pointerdown',7,300,300); await ev('pointermove',7,302,230);
  await p.evaluate(()=>__facy.step(6));
  const f=await p.evaluate(()=>({vy:__facy.S().vy,l:__facy.keys.left,r:__facy.keys.right}));
  chk('a flick up jumps, without running sideways', f.vy<0 && !f.l && !f.r, f);
  await ev('pointerup',7,302,230);
  await p.evaluate(()=>__facy.step(200));
  /* a second finger jumps while the first steers */
  await ev('pointerdown',7,300,200); await ev('pointermove',7,380,200);
  await ev('pointerdown',8,600,200);
  await p.evaluate(()=>__facy.step(6));
  const two=await p.evaluate(()=>({vy:__facy.S().vy,r:__facy.keys.right}));
  chk('a second finger jumps while the first keeps running', two.vy<0 && two.r, two);
  await ev('pointerup',8,600,200); await ev('pointerup',7,380,200);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
{
  const G=GAMES[5];
  const {c,p}=await open(G,{on:true,need:300});
  await p.evaluate(()=>__fxModes.start('play')); await sleep(400);
  await p.evaluate(()=>document.getElementById('stage').dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,pointerType:'mouse',clientX:500,clientY:200,bubbles:true})));
  await p.evaluate(()=>__facy.step(6));
  chk('a mouse click still jumps on a desk', (await p.evaluate(()=>__facy.S().vy))<0);
  await c.close();
}

await b.close(); srv.close();
console.log('\n'+(bad?bad+' FAILED':'all passed')); process.exit(bad?1:0);
