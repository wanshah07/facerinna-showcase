/* Do the new rules actually take? Read the computed values back rather than
   trusting that the CSS parsed. On a phone the hero is sized by its 5:4
   aspect ratio (a narrow-screen rule that already existed), so the svh rule
   is exercised on a wider viewport where the vh rule was the one in force. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const {chromium}=pkg;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++; console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const read = async (vp, mobile) => {
  const c=await b.newContext({viewport:vp,isMobile:mobile,hasTouch:mobile});
  const p=await c.newPage();
  await p.route('**/*', r=>{const u=r.request().url();
    return (u.startsWith('file://')||u.startsWith('data:')||u.startsWith('blob:'))?r.continue():r.abort();});
  await p.goto('file:///workspace/facerinna-showcase/index.html',{waitUntil:'load'});
  await p.waitForTimeout(1200);
  const r=await p.evaluate(()=>{
    const cs=el=>getComputedStyle(el), h=el=>Math.round(el.getBoundingClientRect().height);
    const q=s=>document.querySelector(s);
    return {W:innerWidth,H:innerHeight, htmlX:cs(document.documentElement).overflowX, bodyX:cs(document.body).overflowX,
            hero:h(q('.hero')), stage:h(q('.hero-stage')), shelf:h(q('.shelf-stage')),
            sw:document.documentElement.scrollWidth};
  });
  await c.close(); return r;
};
const ph=await read({width:390,height:844},true);
const wd=await read({width:1024,height:700},false);
chk('phone: html clips sideways overflow', ph.htmlX==='clip'||ph.htmlX==='hidden', ph.htmlX);
chk('phone: body too', ph.bodyX==='clip'||ph.bodyX==='hidden', ph.bodyX);
chk('phone: no sideways scroll', ph.sw<=ph.W, ph.sw);
chk('phone: the hero keeps its 5:4 ratio (narrow-screen rule, untouched)', ph.stage===Math.round(ph.W*4/5), {stage:ph.stage, want:Math.round(ph.W*4/5)});
chk('phone: the shelf is 70svh, floored at 420', ph.shelf===Math.max(420,Math.round(ph.H*0.7)), {shelf:ph.shelf});
chk('wide: the hero is the small viewport minus the nav (svh rule in force)', wd.hero===wd.H-64, {hero:wd.hero, want:wd.H-64});
/* .hero-stage carries its own height rule, but inside the hero's flex column
   it is flex:1 1 auto and takes whatever is left after the brand strip and
   the marquee -- the explicit height was already decorative under vh and
   stays so under svh. The rule that actually sizes the hero is .hero's, and
   that is the one asserted above. */
chk('wide: the stage is what the flex column leaves it, and sits inside the hero', wd.stage>0 && wd.stage<wd.hero, {stage:wd.stage, hero:wd.hero});
chk('wide: the shelf is 100svh, capped at 900', wd.shelf===Math.min(900,Math.max(520,wd.H)), {shelf:wd.shelf});
chk('wide: html clips too', wd.htmlX==='clip'||wd.htmlX==='hidden', wd.htmlX);
await b.close();
console.log(bad? '\nSOMETHING DID NOT APPLY' : '\nthe rules apply'); process.exit(bad?1:0);
