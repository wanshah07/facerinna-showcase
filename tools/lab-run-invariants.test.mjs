/* Lab Run, played hard, with the things that must never happen watched
   continuously rather than sampled at the end.
   Served with one line added that hands back the game's own state; nothing
   else about the page is changed. */
import fs from 'node:fs';
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const {chromium}=pkg;
const FILE='/workspace/facerinna-showcase/lab-run.html';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };

const src=fs.readFileSync(FILE,'utf8');
const M='(function(){\n"use strict";';
const INJ=M+`
window.__watch=function(){
  var act={drop:[],germ:[],shield:[]};
  for (var k in POOL) for (var i=0;i<POOL[k].length;i++){
    var m=POOL[k][i];
    if (m.userData.active) act[k].push({x:+m.position.x.toFixed(3), z:+m.position.z.toFixed(2)});
  }
  return {running:S.running, over:S.over, score:S.score, drops:S.drops, dist:S.dist,
          x:S.x, targetX:S.targetX, vx:S.vx, y:S.y, vy:S.vy, speed:S.speed,
          shield:S.shield, turbo:S.turbo, lane:S.lane, active:act,
          pool:{drop:POOL.drop.length, germ:POOL.germ.length, shield:POOL.shield.length},
          hudScore:document.getElementById('score').textContent,
          hudDrops:document.getElementById('drops').textContent,
          barW:(document.getElementById('shieldBar').firstElementChild||{}).style
                 ? document.getElementById('shieldBar').firstElementChild.style.width : '',
          lanes:LANES.slice(), reach:GERM_REACH};
};
window.__set=function(o){for(var k in o) S[k]=o[k];};
window.__start=function(){ startGame(); };
/* Walk a live germ into him, so the round ends the way a player's round ends
   rather than by calling endGame() and assuming the rest follows. */
/* Put a germ exactly far enough ahead that one frame's travel carries it
   from beyond his front edge to beyond his back edge without ever landing
   inside the old window. This is the phone-at-30fps case. */
window.__germAtGap=function(gap){
  var g=take('germ');
  if(!g) return null;
  g.position.set(S.x, 0.85, -gap);
  g.userData.kind='germ';
  return {gap:gap, step:+(S.speed*(S.turbo?1.55:1)*0.05).toFixed(3)};
};
window.__runIntoGerm=function(){
  for (var i=0;i<POOL.germ.length;i++){
    var g=POOL.germ[i];
    if (g.userData.active){ g.position.z=0; g.position.x=S.x; return true; }
  }
  var g2=take('germ');
  if (g2){ g2.position.set(S.x, 0.85, 0); g2.userData.kind='germ'; return true; }
  return false;
};`;

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const p=await c.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.route('**/*', r=>{const u=r.request().url();
  if(u.endsWith('lab-run.html')) return r.fulfill({contentType:'text/html; charset=utf-8', body:src.replace(M,INJ)});
  return (u.startsWith('file://')||u.startsWith('data:')||u.startsWith('blob:'))?r.continue():r.abort();});
await p.goto('file://'+FILE,{waitUntil:'load'});
await p.waitForTimeout(2000);
await p.fill('#fxrName','Tester'); await p.click('#fxrGo'); await p.waitForTimeout(250);
chk('the state is reachable', await p.evaluate(()=>typeof __watch==='function'));

/* play three rounds, sampling every frame-ish */
const bag=[];
for(let round=1; round<=3; round++){
  await p.evaluate(()=>__start());
  await p.waitForTimeout(300);
  for(let i=0;i<45;i++){
    const x=80+(i*61)%230;
    await p.mouse.move(x,620);
    await p.mouse.down();
    await p.waitForTimeout(40);
    if(i%3) await p.mouse.move(x+(i%2?110:-110),620,{steps:5});
    await p.mouse.up();
    bag.push(await p.evaluate(()=>__watch()));
    await p.waitForTimeout(70);
  }
}
console.log(`  watched ${bag.length} samples across 3 rounds`);

/* ---- invariants ---- */
const running = bag.filter(s=>s.running);
chk('it actually ran', running.length>20, running.length);

const L = bag[0].lanes, REACH = bag[0].reach;
chk('he never leaves the track',
    bag.every(s=>s.x>=L[0]-0.02 && s.x<=L[L.length-1]+0.02 &&
                 s.targetX>=L[0]-1e-6 && s.targetX<=L[L.length-1]+1e-6),
    bag.filter(s=>s.x<L[0]-0.02||s.x>L[L.length-1]+0.02).slice(0,2).map(s=>+s.x.toFixed(2)));

chk('every number stays a number',
    bag.every(s=>[s.x,s.targetX,s.vx,s.y,s.vy,s.score,s.dist,s.speed]
      .every(v=>typeof v==='number'&&isFinite(v))),
    bag.find(s=>[s.x,s.targetX,s.vx,s.y,s.vy,s.score,s.dist,s.speed].some(v=>!isFinite(v))));

chk('the score is always a whole number', bag.every(s=>Number.isInteger(s.score)),
    bag.filter(s=>!Number.isInteger(s.score)).slice(0,2).map(s=>s.score));

chk('the HUD agrees with the score',
    bag.every(s=>!s.running || String(s.score)===s.hudScore),
    bag.filter(s=>s.running&&String(s.score)!==s.hudScore).slice(0,2).map(s=>({s:s.score,hud:s.hudScore})));

/* within one round the score only climbs */
let drops=0;
for(let i=1;i<bag.length;i++){
  const a=bag[i-1], z=bag[i];
  if(a.running && z.running && z.dist>=a.dist && z.score<a.score) drops++;
}
chk('while running the score never goes backwards', drops===0, drops);

chk('he never falls through the floor', bag.every(s=>s.y>=-1e-6),
    bag.filter(s=>s.y<-1e-6).slice(0,2).map(s=>+s.y.toFixed(3)));

chk('the shield timer never goes negative or past its window',
    bag.every(s=>s.shield>=0 && s.shield<=6.001),
    bag.filter(s=>s.shield<0||s.shield>6.001).slice(0,2).map(s=>s.shield));

chk('the shield bar stays between empty and full',
    bag.every(s=>{const m=/^([\d.]+)%$/.exec(s.barW||''); return !m || (+m[1]>=0 && +m[1]<=100);}),
    bag.map(s=>s.barW).filter(w=>{const m=/^([\d.]+)%$/.exec(w||''); return m && (+m[1]<0||+m[1]>100);}).slice(0,2));

/* the row that cannot be survived */
const walled=[];
for(const s of bag){
  const rows={};
  for(const g of s.active.germ){ const key=Math.round(g.z/2); (rows[key]=rows[key]||[]).push(g.x); }
  for(const k in rows){
    const xs=rows[k];
    /* is any point on the track further than REACH from every germ in the row? */
    const safe=L.some(lane=>xs.every(gx=>Math.abs(lane-gx)>=REACH));
    if(!safe && xs.length) walled.push({z:k*2, germs:xs});
  }
}
chk('no row of germs blocks every lane at once', walled.length===0, walled.slice(0,3));

chk('nothing leaks out of the pool',
    bag.every(s=>s.active.drop.length<=s.pool.drop &&
                 s.active.germ.length<=s.pool.germ &&
                 s.active.shield.length<=s.pool.shield));

chk('turbo is off once the finger is up', bag.every(s=>s.turbo===false),
    bag.filter(s=>s.turbo).length);

/* a round that ends must show a result that matches */
await p.evaluate(()=>__set({shield:0, y:0, vy:0, grounded:true}));
await p.waitForTimeout(100);
chk('a germ was put in his way', await p.evaluate(()=>__runIntoGerm()));
await p.waitForTimeout(1400);
const done=await p.evaluate(()=>({...__watch(),
  shown:!document.getElementById('over').classList.contains('hidden'),
  finalScore:document.getElementById('finalScore').textContent}));
chk('running into a germ ends the round', done.running===false&&done.over===true,
    {running:done.running, over:done.over});
chk('the result screen appears', done.shown===true);
chk('the final score is the score it was playing with', done.finalScore===String(done.score),
    {final:done.finalScore, score:done.score});

/* and a restart really starts over */
await p.evaluate(()=>__start());
await p.waitForTimeout(200);
const fresh=await p.evaluate(()=>__watch());
/* Sampled a moment after the restart, so a metre or two of distance has
   already been run and the score is allowed to be 1. What must be back to
   zero is everything that carries over from the last round. */
chk('restarting resets the score and the drops',
    fresh.score<=2&&fresh.drops===0&&fresh.dist<6&&fresh.shield===0,
    {score:fresh.score, drops:fresh.drops, dist:+fresh.dist.toFixed(2), shield:fresh.shield});
chk('restarting puts him back in the middle',
    Math.abs(fresh.targetX)<1e-6&&fresh.lane===1, {targetX:fresh.targetX, lane:fresh.lane});
chk('and clears the field of anything left over',
    fresh.active.germ.length + fresh.active.drop.length + fresh.active.shield.length <= 8,
    {germ:fresh.active.germ.length, drop:fresh.active.drop.length, shield:fresh.active.shield.length});

/* --- the frame a germ could slip through --- */
await p.evaluate(()=>__start());
await p.waitForTimeout(250);
await p.evaluate(()=>__set({speed:30, turbo:true, shield:0, y:0, vy:0, grounded:true,
                            x:0, targetX:0, lane:1}));
const placed=await p.evaluate(()=>__germAtGap(1.2));
chk('a germ is placed a frame ahead of him', !!placed, placed);
console.log(`  one frame at this speed carries it ${placed&&placed.step} -- his window is 1.7 wide`);
await p.waitForTimeout(1500);
const swept=await p.evaluate(()=>__watch());
chk('a germ moving faster than his own width still hits him',
    swept.running===false, {running:swept.running, speed:swept.speed});
await p.evaluate(()=>__set({turbo:false}));

chk('no page errors'+(errs.length?': '+errs[0].slice(0,70):''), errs.length===0);
await b.close();
console.log(bad? '\nSOMETHING IS WRONG' : '\nnothing came loose');
process.exit(bad?1:0);
