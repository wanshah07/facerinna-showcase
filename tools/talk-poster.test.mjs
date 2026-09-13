/* The session poster under the QR codes: it is where it was asked to be, the
   print is the full-size one, it opens in the reader at print size, and it
   fits a phone as well as a desk. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const {chromium}=pkg;
const PAGE='file:///workspace/facerinna-showcase/index.html';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
for(const [W,H] of [[390,844],[1280,800]]){
  const c=await b.newContext({viewport:{width:W,height:H},isMobile:W<500,hasTouch:W<500});
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.route('**/*', r=>{const u=r.request().url();
    return (u.startsWith('file://')||u.startsWith('data:')||u.startsWith('blob:'))?r.continue():r.abort();});
  await p.goto(PAGE,{waitUntil:'load'}); await sleep(1500);

  const where=await p.evaluate(()=>{
    const ids=[...document.querySelectorAll('main > section, body > section')].map(s=>s.id).filter(Boolean);
    return {ids, qr:ids.indexOf('qrcore'), talk:ids.indexOf('talk'), game:ids.indexOf('game')};});
  chk(`${W}: the poster section sits right under the QR codes, before the games`, where.talk===where.qr+1 && where.game===where.talk+1, where);

  await p.evaluate(()=>document.getElementById('talk').scrollIntoView({block:'start'})); await sleep(900);
  const img=await p.evaluate(()=>{const i=document.getElementById('talkThumb'); const r=i.getBoundingClientRect();
    return {src:i.getAttribute('src'), nw:i.naturalWidth, nh:i.naturalHeight, w:Math.round(r.width), h:Math.round(r.height), x:Math.round(r.left), right:Math.round(r.right)};});
  chk(`${W}: the poster is the full-size print (${img.nw}x${img.nh})`, img.nw===960 && img.nh===1200 && /talk-poster-1\.webp$/.test(img.src), img);
  chk(`${W}: it fits the screen`, img.x>=0 && img.right<=W && img.w>=Math.min(300,W-40), img);
  if(W>900) chk(`${W}: on a desk it is capped, not a 1400px-tall column`, img.w<=620 && img.h<=780, img);
  const txt=await p.evaluate(()=>document.getElementById('talk').innerText);
  chk(`${W}: the head names the talk, the speaker, the time and the place`, /Dermocosmetic Adjuncts/.test(txt) && /Peter Ch/.test(txt) && /13\.15/.test(txt) && /Marjorie/.test(txt));
  chk(`${W}: the PDF is offered`, await p.evaluate(()=>!!document.querySelector('#talk a[href="dermocosmetic-talk-poster.pdf"][download]')));
  chk(`${W}: the nav and the footer know about it`, await p.evaluate(()=>!!document.querySelector('.nav-lk[href="#talk"]') && !!document.querySelector('footer a[href="#talk"]')));

  await p.click('#talkView'); await sleep(700);
  const reader=await p.evaluate(()=>{const m=document.getElementById('bookModal'); const pg=document.getElementById('pagerImg');
    return {open:!m.hidden, title:document.getElementById('bookTitle').textContent, pager:!document.getElementById('pager').hidden,
      modes:document.getElementById('pagerModes').hidden, src:pg.getAttribute('src')||'', pdf:document.getElementById('bookPdf').getAttribute('href')};});
  chk(`${W}: Open the poster opens the reader on the poster`, reader.open && reader.pager && /talk-poster-1\.webp$/.test(reader.src), reader);
  chk(`${W}: no sheet-or-panel choice for a single page`, reader.modes, reader);
  chk(`${W}: the reader names it and links the PDF`, /poster/i.test(reader.title) && reader.pdf==='dermocosmetic-talk-poster.pdf', reader);
  await p.click('#bookX'); await sleep(400);
  chk(`${W}: and closes`, await p.evaluate(()=>document.getElementById('bookModal').hidden));
  chk(`${W}: no page errors`+(errs.length?': '+errs[0]:''), errs.length===0);
  await c.close();
}
await b.close();
console.log(bad? '\nSOMETHING IS WRONG' : '\nthe poster is under the QR codes, at print size');
process.exit(bad?1:0);
