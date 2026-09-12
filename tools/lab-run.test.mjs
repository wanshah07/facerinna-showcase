/* Lab Run's controls, driven the way a thumb drives them.

   The game lives in an IIFE, so its state is private -- correctly so. The
   page is served here with one line added that hands back a reference to it,
   and nothing else changed: the logic under test is the shipped logic. */
import fs from 'node:fs';
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const {chromium}=pkg;
const FILE=process.env.PAGE||'/workspace/facerinna-showcase/lab-run.html';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };

/* Wait for the condition, not for a number of milliseconds. Height, landing
   and the glide all need frames to have happened, and this machine renders
   at a handful of frames a second -- fewer still when it is busy. A fixed
   sleep here is a frame count in disguise, and it fails about once in ten
   for no reason anybody can find. */
const until = async (fn, label) => {
  try { await p.waitForFunction(fn, null, {timeout:8000}); } catch(e){}
};
const src=fs.readFileSync(FILE,'utf8');
const marker='(function(){\n"use strict";';
if(!src.includes(marker)) { console.error('cannot find the game IIFE'); process.exit(2); }
/* Read-only handles on the game's own state, plus one practice mode.
   A backtick template, not a quoted string: the last version of this was
   joined with \n inside single quotes and grew real newlines when a comment
   was added to it, which broke the literal. The file then could not compile
   at all -- and because my own check looked for the word FAIL in the output
   rather than at the exit code, a test that never ran once reported as
   passing. Exit codes from here on. */
const INJECT = `
window.__peek = function(){ return {
  x:S.x, targetX:S.targetX, lane:S.lane, vx:S.vx, y:S.y, vy:S.vy,
  grounded:S.grounded, running:S.running, LANES:LANES,
  step:laneStep(), reach:GERM_REACH, span:LANE_SPAN, steerMin:STEER_MIN }; };
window.__set = function(o){ for (var k in o) S[k] = o[k]; };
/* A practice run: the track stops spawning, so nothing can end the round
   while the controls are being measured. Three of these checks used to fail
   about one run in three -- he had simply been killed by a germ partway
   through, and what failed was the test's assumption that he was still
   playing, not the steering. */
window.__quiet = function(){ spawnRow = function(){}; clearField(); startGame(); };
`;
const html=src.replace(marker, marker + INJECT);

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const p=await c.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.route('**/*', r=>{
  const u=r.request().url();
  if(u.endsWith('lab-run.html')) return r.fulfill({contentType:'text/html; charset=utf-8', body:html});
  return (u.startsWith('file://')||u.startsWith('data:')||u.startsWith('blob:'))?r.continue():r.abort();
});
await p.goto('file://'+FILE,{waitUntil:'load'});
await p.waitForTimeout(2200);
chk('the game built itself', await p.evaluate(()=>typeof window.__peek==='function'&&!!window.__peek()));

/* the booth asks for a name before it will let anyone play */
await p.fill('#fxrName','Tester');
await p.click('#fxrGo');
await p.waitForTimeout(250);
await p.click('#playBtn');
await p.waitForTimeout(400);
chk('it is running', (await p.evaluate(()=>__peek().running))===true);
await p.evaluate(()=>__quiet());
await p.waitForTimeout(300);
chk('and the track is quiet, so nothing can end the round mid-measure',
    (await p.evaluate(()=>__peek().running))===true);
const LANES=await p.evaluate(()=>__peek().LANES);

/* --- jump must happen on the press, not on the lift --- */
await p.evaluate(()=>__set({y:0,vy:0,grounded:true}));
await p.mouse.move(195,600);
await p.mouse.down();
await p.waitForTimeout(90);
const mid=await p.evaluate(()=>__peek());
/* Height is integrated on the next frame, and this machine renders at a
   handful of frames a second, so y is still 0 here. What proves the jump
   started on the press is the upward velocity, which jump() sets there and
   then. Were it still on the release, both of these would be untouched. */
chk('pressing jumps at once, before the finger lifts', mid.vy>0&&!mid.grounded,
    {vy:+mid.vy.toFixed(2), grounded:mid.grounded});
await p.mouse.up();
await until(()=>__peek().y>0.2);
const air=await p.evaluate(()=>__peek());
chk('and he is off the ground a moment later', air.y>0.2, {y:+air.y.toFixed(2)});
await until(()=>__peek().grounded===true);
chk('then back down', (await p.evaluate(()=>__peek().grounded))===true);

/* --- A TAP MUST BE A JUMP AND NOTHING ELSE ---
   This was the bug: 14px of wander in any direction counted as a slide, and
   a thumb landing on glass wanders further than that. So a tap slid him
   sideways. The jump fired too, which is why it read as "it goes side, not
   jump" rather than as nothing happening. */
/* Each of these is a path a real thumb traces, not a single jump to a point.
   That matters: the old rule rebased its origin the moment it decided a
   gesture was a slide, so a tap that stopped right there moved him nowhere
   and would have passed this. What gave him away was a thumb that kept
   wobbling afterwards -- which every thumb does. */
const TAPS = [
  ['dead still',              [[0,0]]],
  ['a small wobble',          [[4,2],[9,5],[13,8],[17,6],[15,9],[18,11]]],
  ['a wobble, mostly down',   [[2,6],[5,14],[7,22],[9,30],[8,36]]],
  ['a sideways wobble that never commits', [[6,1],[12,3],[17,2],[21,4],[19,3],[22,5]]],
];
for (const [label, path] of TAPS){
  await p.evaluate(()=>__set({x:0,targetX:0,lane:1,y:0,vy:0,grounded:true}));
  await p.mouse.move(195,600);
  await p.mouse.down();
  let mid=null;
  for (const [dx,dy] of path){
    if (dx||dy) await p.mouse.move(195+dx, 600+dy);
    if (!mid) mid = await p.evaluate(()=>__peek());
  }
  await p.mouse.up();
  await p.waitForTimeout(80);
  const after=await p.evaluate(()=>__peek());
  chk(`a tap (${label}) jumps`, mid.vy>0&&!mid.grounded, {vy:+mid.vy.toFixed(2)});
  chk(`a tap (${label}) does not move him sideways`, Math.abs(after.targetX)<1e-9,
      {targetX:+after.targetX.toFixed(3)});
  await until(()=>__peek().grounded===true);   // land before the next tap
}

/* --- steering needs real sideways travel, and has to be sideways --- */
const min = await p.evaluate(()=>__peek().steerMin);
chk('there is a threshold to cross before steering', min>=18&&min<=40, min);

await p.evaluate(()=>__set({x:0,targetX:0,lane:1}));
await p.mouse.move(195,600); await p.mouse.down();
await p.mouse.move(195, 600-170, {steps:8});         // straight up the screen
const vert=await p.evaluate(()=>__peek().targetX);
chk('dragging up and down does not steer', Math.abs(vert)<1e-9, vert);
await p.mouse.up(); await p.waitForTimeout(400);

/* A drag that is mostly vertical but drifts further sideways than the
   threshold. Without the sideways-dominance test this steers, and a swipe up
   to jump takes him out of his lane with it. */
await p.evaluate(()=>__set({x:0,targetX:0,lane:1}));
await p.mouse.move(195,600); await p.mouse.down();
for (let i=1;i<=8;i++) await p.mouse.move(195 + i*5, 600 - i*26);   // 40px across, 208 up
const diag=await p.evaluate(()=>__peek().targetX);
chk('a mostly-vertical drag does not steer either', Math.abs(diag)<1e-9, +diag.toFixed(3));
await p.mouse.up(); await p.waitForTimeout(400);

/* --- and then it follows the finger, continuously --- */
await p.evaluate(()=>__set({x:0,targetX:0,lane:1}));
const step = await p.evaluate(()=>__peek().step);
chk('a lane costs a real swipe, not a flick', step>=90&&step<=190, step);
await p.mouse.move(195,600); await p.mouse.down();
await p.mouse.move(195+min+2,600);                    // cross the threshold
const seen=[];
for(let i=1;i<=12;i++){
  await p.mouse.move(195+min+2+Math.round(i*step/12),600);
  seen.push(await p.evaluate(()=>__peek().targetX));
}
const distinct=new Set(seen.map(v=>v.toFixed(3))).size;
chk('the target moves continuously, not in three steps', distinct>=8,
    {distinct, seen:seen.map(v=>+v.toFixed(2))});
chk('it rests between lanes while the finger is between them',
    seen.filter(v=>LANES.every(L=>Math.abs(L-v)>0.05)).length>=5);
chk('it never leaves the track',
    seen.every(v=>v>=LANES[0]-1e-6&&v<=LANES[LANES.length-1]+1e-6));
chk('and one lane-worth of finger moves him one lane',
    Math.abs(seen[seen.length-1]-(LANES[1]+(LANES[1]-LANES[0])))<0.25,
    +seen[seen.length-1].toFixed(2));
chk('crossing the threshold is not itself credited as travel',
    Math.abs(seen[0])<0.45, +seen[0].toFixed(3));

/* --- LETTING GO LEAVES HIM WHERE HE IS ---
   The release used to put him on a lane, and that is what still felt like
   three lanes however smooth the travel between them was. */
await p.mouse.move(195+min+2+Math.round(step*0.45),600);
const held=await p.evaluate(()=>__peek().targetX);
chk('mid-drag he is between two lanes', LANES.every(L=>Math.abs(L-held)>0.15),
    +held.toFixed(2));
await p.mouse.up();
await p.waitForTimeout(120);
const left=await p.evaluate(()=>__peek());
chk('letting go does not move him', Math.abs(left.targetX-held)<1e-9,
    {was:+held.toFixed(3), now:+left.targetX.toFixed(3)});
chk('but it does remember which lane he is nearest',
    left.lane===LANES.reduce((a,b,i)=>Math.abs(LANES[i]-held)<Math.abs(LANES[a]-held)?i:a,0),
    {lane:left.lane, targetX:+left.targetX.toFixed(2)});
await until(()=>Math.abs(__peek().x-__peek().targetX)<0.2);
const arr=await p.evaluate(()=>__peek());
chk('and he glides to exactly there', Math.abs(arr.x-arr.targetX)<0.2,
    {x:+arr.x.toFixed(2), targetX:+arr.targetX.toFixed(2)});

/* --- nothing is left of the hiding place that the snap existed to prevent --- */
const g=await p.evaluate(()=>__peek());
chk('the gap between two lanes is not safe from either germ', g.reach > g.span/2,
    {reach:g.reach, halfLane:g.span/2});
chk('and a clear lane still is', g.reach < g.span, {reach:g.reach, span:g.span});

/* --- a finger dragged off the end of the track must not take him with it --- */
await p.evaluate(()=>__set({x:0,targetX:0,lane:1}));
await p.mouse.move(195,600); await p.mouse.down();
await p.mouse.move(390,600,{steps:8});
const far=await p.evaluate(()=>__peek().targetX);
chk('dragged past the edge, he stops at the edge', Math.abs(far-LANES[LANES.length-1])<1e-6, far);
await p.mouse.up();

/* --- keyboard still steps exactly one lane --- */
await p.evaluate(()=>__set({lane:1,targetX:0,x:0}));
await p.keyboard.press('ArrowLeft');
const k=await p.evaluate(()=>__peek());
chk('a key press is still exactly one lane', k.lane===0&&Math.abs(k.targetX-LANES[0])<1e-6,
    {lane:k.lane, targetX:k.targetX});

chk('no page errors'+(errs.length?': '+errs[0]:''), errs.length===0);
await b.close();
console.log(bad? '\nSOMETHING IS WRONG' : '\nhe follows the finger, and jumps when you press');
process.exit(bad?1:0);
