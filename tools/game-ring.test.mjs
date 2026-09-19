/* The games wheel.

   Facy Run shipped in the page and not on the wheel: its card was written
   into the quiz shell, which is hidden, so the ring laid out seven cards and
   the eighth was nowhere a visitor could reach. Counting `.cg-item` in the
   file said eight and was no use at all -- the question is what is INSIDE
   #gameRing, and whether turning the wheel brings each one to the front. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
import http from 'http'; import fs from 'fs';
const ROOT='/workspace/facerinna-showcase';
const html=fs.readFileSync(ROOT+'/index.html');
/* The page is not the only file it asks for any more: fx-gift.js is a real
   request, and a server answering every path with the page hands the browser
   HTML where it expects JavaScript. Serve what is asked for. */
const srv=http.createServer((q,r)=>{
  const path=decodeURIComponent(new URL(q.url,'http://x').pathname);
  if(path==='/'||path==='/index.html'){ r.writeHead(200,{'Content-Type':'text/html'}); return r.end(html); }
  const f='/workspace/facerinna-showcase'+path;
  if(/^\/[\w.-]+\.js$/.test(path) && fs.existsSync(f)){
    r.writeHead(200,{'Content-Type':'text/javascript'}); return r.end(fs.readFileSync(f));
  }
  r.writeHead(404); r.end();
});
await new Promise(r=>srv.listen(0,r)); const P=srv.address().port;
let ok=true; const check=(l,c,x)=>{ if(!c) ok=false;
  console.log((c?'  PASS  ':'  FAIL  ')+l+(!c&&x!==undefined?'  -> '+JSON.stringify(x):'')); };

/* every game with a card, and the page it opens */
const WANT=[
  ['Match Lab','match-lab.html'], ['Pack Match','pack-match.html'],
  ['Shelf Shot','shelf-shot.html'], ['Deep Lab','deep-lab.html'],
  ['Lab Run','lab-run.html'], ['UV Card','uv-card.html'],
  ['Skin IQ Challenge','#skinIQ'], ['Facy Run','facy-run.html'],
];

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const c=await b.newContext({viewport:{width:1280,height:900}});
const p=await c.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.route('**/*', r=> r.request().url().startsWith(`http://127.0.0.1:${P}`) ? r.continue() : r.abort());
await p.goto(`http://127.0.0.1:${P}/`,{waitUntil:'domcontentloaded'});
await p.waitForTimeout(1500);

console.log('what is on the wheel');
const ring=await p.evaluate(()=>{
  const r=document.getElementById('gameRing');
  const items=[...r.querySelectorAll('.cg-item')];
  return { n:items.length,
    cards:items.map(el=>({ label:el.getAttribute('aria-label'),
      href:(el.querySelector('a.cg-card')||{}).getAttribute
           ? el.querySelector('a.cg-card').getAttribute('href') : null,
      i:el.style.getPropertyValue('--i').trim(),
      num:(el.querySelector('.cg-num')||{}).textContent })),
    quizInside: !!r.querySelector('.progress, #qText, #opts'),
    step:getComputedStyle(r).getPropertyValue('--cg-step').trim() };
});
check('every game has a card ON THE WHEEL, not merely in the file',
  ring.n===WANT.length, {onWheel:ring.n, want:WANT.length, labels:ring.cards.map(c=>c.label)});
check('...each one the right game, in order',
  ring.cards.map(c=>c.label).join('|')===WANT.map(w=>w[0]).join('|'), ring.cards.map(c=>c.label));
check('...each opening its own page',
  ring.cards.every((c,i)=>c.href===WANT[i][1]), ring.cards.map(c=>c.href));
check('...numbered 01 upwards with none repeated',
  ring.cards.map(c=>c.num).join(',')===WANT.map((_,i)=>String(i+1).padStart(2,'0')).join(','),
  ring.cards.map(c=>c.num));
check('...given a place of its own on the wheel',
  new Set(ring.cards.map(c=>c.i)).size===WANT.length, ring.cards.map(c=>c.i));
check('the wheel is divided by how many cards it holds',
  ring.step===(360/WANT.length)+'deg', ring.step);
check('the quiz did not end up inside the wheel', !ring.quizInside);

console.log('\nturning it');
/* The wheel turns with the page: one full revolution as the gallery crosses
   the viewport. Walk it through and note which card is nearest the viewer. */
/* Which card is at the front is the page's own answer, not a guess from the
   rectangle: a card round the back projects much the same area as the one in
   front of it. The wheel fades each card by its angle from the viewer, so the
   least faded card IS the front one, by the page's own reckoning. */
const front=()=>p.evaluate(()=>{
  const items=[...document.querySelectorAll('#gameRing .cg-item')];
  let best=null, bestO=-1;
  for(const el of items){ const o=parseFloat(el.style.opacity||getComputedStyle(el).opacity)||0;
    if(o>bestO){ bestO=o; best=el.getAttribute('aria-label'); } }
  return best;
});
const seen=new Set();
const geo=await p.evaluate(()=>{ const g=document.getElementById('gameGallery');
  const r=g.getBoundingClientRect();
  return { top: window.scrollY + r.top, h: r.height, vh: innerHeight }; });
/* Instant, not smooth: the page scrolls smoothly for a person, and a test
   that asks for 10,000px and looks 100ms later is still watching it travel. */
const to=y=>p.evaluate(v=>{ document.documentElement.style.scrollBehavior='auto';
  window.scrollTo({top:v, behavior:'instant'}); }, Math.max(0,y));
/* Down the page and back up, which is what somebody looking at the games
   does. One pass turns the wheel about five sixths of the way round -- the
   gallery runs out of page before the turn completes -- and the idle spin
   moves the phase on between passes, so the pair covers the whole wheel. */
const span=geo.h+geo.vh;
for(const dir of [1,-1]){
  for(let k=0;k<=60;k++){
    const f = dir>0 ? k/60 : 1-k/60;
    await to(geo.top - geo.vh + f*span);
    await p.waitForTimeout(60);
    seen.add(await front());
  }
}
const missed=WANT.map(w=>w[0]).filter(n=>!seen.has(n));
check('every card comes round to the front', missed.length===0, {missed, reached:[...seen]});
check('no page errors', errs.length===0, errs[0]);

await b.close(); srv.close();
console.log(ok?'\nevery game is on the wheel and reachable':'\nSOMETHING IS WRONG');
process.exit(ok?0:1);
