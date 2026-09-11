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

const src=fs.readFileSync(FILE,'utf8');
const marker='(function(){\n"use strict";';
if(!src.includes(marker)) { console.error('cannot find the game IIFE'); process.exit(2); }
const html=src.replace(marker, marker+'\nwindow.__peek=function(){return {x:S.x,targetX:S.targetX,lane:S.lane,vx:S.vx,y:S.y,vy:S.vy,grounded:S.grounded,running:S.running,LANES:LANES,step:laneStep()};};\nwindow.__set=function(o){for(var k in o) S[k]=o[k];};');

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
await p.waitForTimeout(600);
const air=await p.evaluate(()=>__peek());
chk('and he is off the ground a moment later', air.y>0.2, {y:+air.y.toFixed(2)});
await p.waitForTimeout(1200);
chk('then back down', (await p.evaluate(()=>__peek().grounded))===true);

/* --- steering follows the finger instead of hopping a lane at a time --- */
await p.evaluate(()=>__set({x:0,targetX:0,lane:1}));
await p.mouse.move(195,600);
await p.mouse.down();
const seen=[];
for(let i=1;i<=14;i++){
  await p.mouse.move(195+i*5,600);                 // 5px a time, 70px in all
  seen.push(await p.evaluate(()=>__peek().targetX));
}
const offLane=seen.filter(v=>LANES.every(L=>Math.abs(L-v)>0.05));
const distinct=new Set(seen.map(v=>v.toFixed(3))).size;
chk('the target moves continuously, not in three steps', distinct>=8,
    {distinct, seen:seen.map(v=>+v.toFixed(2))});
chk('it rests between lanes while the finger is between them', offLane.length>=5, offLane.length);
chk('it never leaves the track',
    seen.every(v=>v>=LANES[0]-1e-6&&v<=LANES[LANES.length-1]+1e-6));
await p.mouse.up();
await p.waitForTimeout(60);
const after=await p.evaluate(()=>__peek());
chk('releasing settles on a real lane', LANES.some(L=>Math.abs(L-after.targetX)<1e-6),
    {targetX:after.targetX, lane:after.lane});

await p.waitForTimeout(600);
const arr=await p.evaluate(()=>__peek());
chk('and he arrives there', Math.abs(arr.x-arr.targetX)<0.25,
    {x:+arr.x.toFixed(2), targetX:arr.targetX});

/* --- one swipe should be about one lane ---
   This is the whole complaint. The scale used to be a flat 46px a lane, so a
   normal thumb swipe crossed the entire two-lane track before you could see
   him travel -- continuous movement you cannot aim looks exactly like
   jumping between three places. */
const step = await p.evaluate(()=>__peek().step);
chk('a lane costs a real swipe, not a flick', step>=70&&step<=150, step);
await p.evaluate(()=>__set({x:0,targetX:0,lane:1}));
await p.mouse.move(195,600); await p.mouse.down();
await p.mouse.move(195+14,600);                       // past the tap slop
await p.mouse.move(195+14+Math.round(step),600,{steps:10});
const oneLane = await p.evaluate(()=>__peek().targetX);
chk('and moving one lane-worth of finger moves him one lane',
    Math.abs(oneLane-(LANES[1]+ (LANES[1]-LANES[0])))<0.25, +oneLane.toFixed(2));
await p.mouse.up(); await p.waitForTimeout(400);

/* --- the slop must not be credited as travel --- */
await p.evaluate(()=>__set({x:0,targetX:0,lane:1}));
await p.mouse.move(195,600); await p.mouse.down();
await p.mouse.move(195+15,600);       // just enough to count as a slide
const atStart = await p.evaluate(()=>__peek().targetX);
chk('deciding it is a slide does not itself move him', Math.abs(atStart)<0.08, +atStart.toFixed(3));
await p.mouse.up(); await p.waitForTimeout(400);

/* --- a release mid-move carries on, it does not get pulled back --- */
await p.evaluate(()=>__set({x:0,targetX:0,lane:1,vx:0}));
await p.mouse.move(195,600); await p.mouse.down();
await p.mouse.move(195+14,600);
for(let i=1;i<=6;i++) await p.mouse.move(195+14+i*8,600);
const moving=await p.evaluate(()=>__peek());
chk('mid-drag he is between two lanes', LANES.every(L=>Math.abs(L-moving.targetX)>0.15),
    {targetX:+moving.targetX.toFixed(2), vx:+(moving.vx||0).toFixed(2)});
await p.mouse.up();
await p.waitForTimeout(60);
const carried=await p.evaluate(()=>__peek());
chk('letting go while moving carries him on the way he was going',
    carried.targetX > moving.targetX && LANES.some(L=>Math.abs(L-carried.targetX)<1e-6),
    {was:+moving.targetX.toFixed(2), now:carried.targetX});

/* --- a release standing still goes to the nearest, not onward --- */
await p.evaluate(()=>__set({x:0.6,targetX:0.6,lane:1,vx:0}));
await p.mouse.move(195,600); await p.mouse.down();
await p.mouse.move(195+15,600);
await p.waitForTimeout(900);                    // hold still: sideways speed dies
const parked=await p.evaluate(()=>__peek());
chk('holding still, he stops moving sideways', Math.abs(parked.vx||0)<1.2,
    {vx:+(parked.vx||0).toFixed(3)});
await p.mouse.up();
await p.waitForTimeout(60);
const nearest=await p.evaluate(()=>__peek().targetX);
chk('and then the nearest lane wins',
    nearest===LANES.reduce((a,b)=>Math.abs(b-parked.targetX)<Math.abs(a-parked.targetX)?b:a),
    {from:+parked.targetX.toFixed(2), to:nearest});

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
