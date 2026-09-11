/* The markup test proves the link exists. This proves a thumb can land on it:
   the anchor actually covers the code, nothing sits on top of it, and pressing
   it asks for the address the code encodes.
   Routing is on the context, not the page, so the new tab a target="_blank"
   opens is intercepted too and nothing leaves this machine. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const {chromium}=pkg;
const PAGE=process.env.PAGE||'file:///workspace/facerinna-showcase/index.html';
const WANT={'Clinic registration QR code':'docs.google.com/forms',
            'WhatsApp QR code':'wa.me/message/YKYI736CG4FZH1'};
let bad=0; const chk=(l,ok,extra)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&extra?'  -> '+extra:'')); };
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
for(const w of [390,1280]){
  const c=await b.newContext({viewport:{width:w,height:844},isMobile:w<500,hasTouch:w<500});
  const asked=[];
  c.on('request', r=>asked.push(r.url()));
  await c.route('**/*', r=>{const u=r.request().url();
    return (u.startsWith('file://')||u.startsWith('data:'))?r.continue():r.abort();});
  const p=await c.newPage();
  await p.goto(PAGE,{waitUntil:'load'});
  for(const [alt,want] of Object.entries(WANT)){
    const img=await p.$(`#qrcore img[alt="${alt}"]`);
    await img.scrollIntoViewIfNeeded();
    await p.waitForTimeout(350);
    const box=await img.boundingBox();
    chk(`${w}: "${alt}" is a real target (${Math.round(box.width)}x${Math.round(box.height)})`,
        box.width>=120&&box.height>=120);
    const top=await p.evaluate(([x,y])=>{
      const el=document.elementFromPoint(x,y);
      if(!el) return 'off screen at '+Math.round(x)+','+Math.round(y);
      const a=el.closest('a.qr-tap');
      return a? a.getAttribute('href') : 'covered by '+el.tagName.toLowerCase()+'.'+String(el.className||'').split(' ')[0];
    },[box.x+box.width/2, box.y+box.height/2]);
    chk(`${w}: pressing its centre hits the link`, String(top).includes(want), top);
    const n=asked.length;
    await img.click();
    await p.waitForTimeout(700);
    const got=asked.slice(n).filter(u=>u.includes(want.split('/')[0]));
    chk(`${w}: the press asks for ${want}`, got.some(u=>u.includes(want)), asked.slice(n).join(' ')||'nothing requested');
    for(const pg of c.pages()) if(pg!==p) await pg.close();
  }
  const mid=await p.$('#qrcore img[alt="More info QR code"]');
  chk(`${w}: the "More info" code is not a link`, !(await mid.evaluate(e=>!!e.closest('a'))));
  await c.close();
}
await b.close();
console.log(bad? '\nSOMETHING IS WRONG' : '\nthe codes can be pressed, not only scanned');
process.exit(bad?1:0);
