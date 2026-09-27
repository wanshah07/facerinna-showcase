/* The Contact us section above the footer.

   What it has to do: draw the globe from the borders carried in the page
   (no request leaves for a map), turn only while it is on screen, hold still
   for reduced motion, turn under a sideways drag, and hand a filled message
   to the visitor's own email app -- refusing an empty one -- without the
   form ever posting anywhere. And fit a phone without sideways scroll. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8193, BASE='http://127.0.0.1:'+PORT;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, ms=6000, step=80){ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(step);} return fn(); }
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.webp':'image/webp','.png':'image/png',
  '.jpg':'image/jpeg','.webmanifest':'application/manifest+json'};
const srv=http.createServer((req,res)=>{
  let f=decodeURIComponent(new URL(req.url,BASE).pathname); if(f.endsWith('/')) f+='index.html';
  if(f==='/sw.js'){ res.writeHead(404); res.end(); return; }
  const fp=path.join(ROOT,f);
  if(!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});
  res.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});

async function open_(w,h,opts={}){
  const c=await b.newContext({viewport:{width:w,height:h},...opts});
  const p=await c.newPage(); const errs=[], reqs=[];
  p.on('pageerror',e=>errs.push(e.message));
  p.on('request',r=>reqs.push(r.url()));
  await p.goto(BASE+'/index.html',{waitUntil:'domcontentloaded'});
  await until(()=>p.evaluate(()=>!!window.__ctGlobe).catch(()=>false), 15000);
  return {c,p,errs,reqs};
}
const toContact=p=>p.evaluate(()=>document.getElementById('ctGlobe').scrollIntoView({block:'center',behavior:'instant'}));
/* how much of the canvas is painted, and whether any of it is the office pin's teal */
const ink=p=>p.evaluate(()=>{const cv=document.getElementById('ctGlobe');
  const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let n=0,teal=0;
  for(let i=3;i<d.length;i+=4){ if(d[i]>20){n++; if(d[i-3]<60&&d[i-2]>120&&d[i-1]>130) teal++;} }
  return {n,teal,area:cv.width*cv.height};});

console.log('\n── desktop 1440×900');
{
  const {c,p,errs,reqs}=await open_(1440,900);
  chk('section #contact sits between #game and the footer', await p.evaluate(()=>{
    const s=document.getElementById('contact'),g=document.getElementById('game'),f=document.querySelector('footer.footer');
    return !!s && !!(g.compareDocumentPosition(s)&4) && !!(s.compareDocumentPosition(f)&4);}));
  /* the header: Contact is a call to action, dressed apart from both the plain
     links and Play & Win, and the talk link is shortened to make room */
  const nav=await p.evaluate(()=>{const c=document.querySelector('#navLinks a.nav-cta-contact'),
    play=document.querySelector('#navLinks a.nav-cta[href="#game"]'),plain=document.querySelector('#navLinks a.nav-lk[href="#range"]');
    const cs=e=>getComputedStyle(e);
    return c&&{href:c.getAttribute('href'),text:c.textContent.trim(),icon:!!c.querySelector('svg'),
      bg:cs(c).backgroundImage,playBg:cs(play).backgroundColor+'|'+cs(play).backgroundImage,plainBg:cs(plain).backgroundColor+'|'+cs(plain).backgroundImage,
      color:cs(c).color,lk:c.classList.contains('nav-lk'),
      last:[...document.querySelectorAll('#navLinks>a')].filter(a=>!a.id).pop()===c,
      talk:document.querySelector('#navLinks a[href="#talk"]').textContent.trim()};});
  chk('header has a Contact CTA pointing at #contact', !!nav&&nav.href==='#contact'&&nav.text==='Contact'&&nav.icon, nav);
  chk('… filled with a gradient, unlike the plain links', !!nav&&/gradient/.test(nav.bg)&&!/gradient/.test(nav.plainBg), nav);
  chk('… and unlike Play & Win', !!nav&&nav.bg!==nav.playBg&&!/gradient/.test(nav.playBg), nav);
  chk('… white text, last of the links before the admin icon, not in the scrollspy', !!nav&&nav.color==='rgb(255, 255, 255)'&&nav.last&&!nav.lk, nav);
  chk('talk link reads "Talk"', !!nav&&nav.talk==='Talk', nav&&nav.talk);
  /* 1440 is under the full bar, so the links live behind the burger here */
  if(await p.evaluate(()=>getComputedStyle(document.getElementById('burger')).display!=='none')){ await p.click('#burger'); await sleep(400); }
  await p.click('#navLinks a.nav-cta-contact');
  /* the page scrolls smoothly: wait for it to come to rest, or a jump back
     to the top would be carried off by the tail of the glide */
  await until(async()=>{const a=await p.evaluate(()=>scrollY);await sleep(150);return a===await p.evaluate(()=>scrollY)&&a>0;},6000);
  /* the page's link handler writes the hash once the glide ends, and writing
     it jumps there again, so leave only after that has happened */
  await until(()=>p.evaluate(()=>location.hash==='#contact'),6000); await sleep(200);
  chk('clicking it brings the Contact section up', await p.evaluate(()=>{const r=document.getElementById('contact').getBoundingClientRect();return r.top<innerHeight*.5&&r.bottom>0;}));
  await p.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
  await until(()=>p.evaluate(()=>scrollY<50)); await sleep(600);  /* let the globe see it left */
  chk('footer Explore has Contact us', await p.evaluate(()=>[...document.querySelectorAll('.footer a')].some(a=>a.getAttribute('href')==='#contact'&&/Contact us/.test(a.textContent))));
  chk('nav links still fit the bar at 1440', await p.evaluate(()=>{const n=document.getElementById('navLinks');
    const r=n.getBoundingClientRect();return n.scrollWidth<=n.clientWidth+1&&r.right<=innerWidth;}),
    await p.evaluate(()=>{const n=document.getElementById('navLinks');return [n.scrollWidth,n.clientWidth,n.getBoundingClientRect().right];}));
  chk('the page holds '+(await p.evaluate(()=>window.__ctGlobe.lines()))+' border lines, '+(await p.evaluate(()=>window.__ctGlobe.points()))+' points',
    await p.evaluate(()=>window.__ctGlobe.lines()===274&&window.__ctGlobe.points()===7862));
  chk('not turning while off screen', !(await p.evaluate(()=>window.__ctGlobe.running())));
  await toContact(p); await sleep(700);
  chk('turning once on screen', await p.evaluate(()=>window.__ctGlobe.running()));
  const g=await ink(p);
  chk('globe canvas is sized and painted ('+g.n+' px of '+g.area+')', g.area>200*200 && g.n>g.area*.01 && g.n<g.area*.6, g);
  chk('canvas has faded in', await p.evaluate(()=>document.getElementById('ctGlobe').classList.contains('on')));
  const r0=await p.evaluate(()=>window.__ctGlobe.rot()); await sleep(1000);
  const r1=await p.evaluate(()=>window.__ctGlobe.rot());
  chk('turns westward about 12 degrees a second ('+(r0-r1).toFixed(1)+')', r0-r1>6 && r0-r1<18, [r0,r1]);
  chk('no request leaves the page for map data', !reqs.some(u=>/jsdelivr|world-atlas|topojson|unpkg|d3/i.test(u)), reqs.filter(u=>!u.startsWith(BASE)));
  /* sideways drag */
  const box=await p.evaluate(()=>{const r=document.getElementById('ctGlobe').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height*.3};});
  await p.mouse.move(box.x,box.y); await p.mouse.down();
  const a=await p.evaluate(()=>window.__ctGlobe.rot());
  await p.mouse.move(box.x+120,box.y,{steps:6});
  const bb=await p.evaluate(()=>window.__ctGlobe.rot()); await p.mouse.up();
  chk('dragging right 120px turns it about 60 degrees ('+(a-bb).toFixed(1)+')', a-bb>50 && a-bb<75, [a,bb]);
  await p.evaluate(()=>scrollTo({top:0,behavior:'instant'})); await sleep(600);
  chk('stops again once scrolled away', !(await p.evaluate(()=>window.__ctGlobe.running())));
  /* the form */
  await p.evaluate(()=>document.getElementById('ctForm').scrollIntoView({block:'center',behavior:'instant'}));
  await p.click('#ctForm button[type=submit]');
  chk('empty submit is refused with a message', /fill in your name/i.test(await p.textContent('#ctStatus')));
  chk('… and focus goes to the name field', await p.evaluate(()=>document.activeElement.id==='ctName'));
  chk('nothing composed yet', await p.evaluate(()=>!window.__ctLast));
  await p.fill('#ctName','Dr Aina'); await p.fill('#ctEmail','not-an-email'); await p.fill('#ctMsg','Hello & salam');
  await p.click('#ctForm button[type=submit]');
  chk('bad email is refused', /check the email/i.test(await p.textContent('#ctStatus')));
  await p.fill('#ctEmail','aina@example.com'); await p.fill('#ctOrg','Klinik Sihat');
  await p.click('#ctForm button[type=submit]'); await sleep(300);
  const m=await p.evaluate(()=>window.__ctLast||'');
  chk('composes a mailto to info@facerinnamalaysia.com', m.startsWith('mailto:info@facerinnamalaysia.com?subject='), m);
  const q=new URLSearchParams(m.split('?')[1]);
  chk('subject names the sender and clinic', q.get('subject')==='Website enquiry from Dr Aina (Klinik Sihat)', q.get('subject'));
  chk('body carries message, name, clinic, email, with & intact', q.get('body')==='Hello & salam\n\nDr Aina\nKlinik Sihat\naina@example.com', q.get('body'));
  chk('still on the page after handing off', await p.evaluate(()=>location.pathname.endsWith('index.html')));
  chk('the form has no action and posts nowhere', await p.evaluate(()=>!document.getElementById('ctForm').getAttribute('action')));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\n── header at the edges of the full bar, and in the menu');
for (const w of [1460,1520,1920]) {
  const {c,p}=await open_(w,900);
  const r=await p.evaluate(()=>{const g=id=>document.getElementById(id).getBoundingClientRect();
    const cta=document.querySelector('#navLinks a.nav-cta-contact').getBoundingClientRect();
    return {gap:Math.round(g('tvBtn').left-g('adminBtn').right),shown:cta.width>0&&cta.right<=innerWidth,burger:getComputedStyle(document.getElementById('burger')).display};});
  chk(w+': full bar, Contact shown, admin clear of the TV button (gap '+r.gap+')', r.shown&&r.gap>=8&&r.burger==='none', r);
  await c.close();
}
{
  const {c,p}=await open_(1280,800);
  await p.click('#burger'); await sleep(400);
  const r=await p.evaluate(()=>{const a=document.querySelector('#navLinks a.nav-cta-contact').getBoundingClientRect();return {w:a.width,h:a.height,in:a.right<=innerWidth};});
  chk('1280: Contact CTA is in the opened menu', r.w>60&&r.h>=28&&r.in, r);
  await p.click('#navLinks a.nav-cta-contact'); await sleep(900);
  chk('… tapping it closes the menu and lands on Contact', await p.evaluate(()=>!document.getElementById('navLinks').classList.contains('open')&&document.getElementById('contact').getBoundingClientRect().top<innerHeight*.5));
  await c.close();
}

console.log('\n── reduced motion');
{
  const {c,p,errs}=await open_(1280,800,{reducedMotion:'reduce'});
  await toContact(p); await sleep(800);
  const g=await ink(p);
  chk('painted once all the same', g.n>g.area*.01, g);
  chk('office pin shown on the first frame', g.teal>10, g);
  const r0=await p.evaluate(()=>window.__ctGlobe.rot()); await sleep(900);
  chk('holds still', r0===await p.evaluate(()=>window.__ctGlobe.rot()));
  chk('no animation loop running', !(await p.evaluate(()=>window.__ctGlobe.running())));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\n── Aurora (dark) backdrop');
{
  const {c,p,errs}=await open_(1440,900);
  await p.evaluate(()=>document.querySelector('#shelfBg [data-bg=aurora]').click());
  await toContact(p); await sleep(500);
  chk('section lets the dark sky through', await p.evaluate(()=>getComputedStyle(document.getElementById('contact')).backgroundImage==='none'),
    await p.evaluate(()=>getComputedStyle(document.getElementById('contact')).backgroundImage));
  chk('heading turns light', await p.evaluate(()=>{const m=getComputedStyle(document.querySelector('#contact h2')).color.match(/\d+/g).map(Number);return m[0]+m[1]+m[2]>600;}));
  chk('globe lines take the light accent', await p.evaluate(()=>getComputedStyle(document.querySelector('.ct-globe')).color==='rgb(127, 196, 242)'));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\n── phone 390×844');
{
  const {c,p,errs}=await open_(390,844,{isMobile:true,hasTouch:true,deviceScaleFactor:3});
  await toContact(p); await sleep(600);
  chk('no sideways scroll', await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  chk('one column: card below the globe', await p.evaluate(()=>{
    const a=document.querySelector('.ct-side').getBoundingClientRect(),f=document.getElementById('ctForm').getBoundingClientRect();
    return f.top>=a.bottom-1 && Math.abs(f.left-a.left)<2;}));
  chk('every field inside the card', await p.evaluate(()=>{const f=document.getElementById('ctForm').getBoundingClientRect();
    return [...document.querySelectorAll('#ctForm input,#ctForm textarea,#ctForm button')].every(e=>{const r=e.getBoundingClientRect();return r.left>=f.left-1&&r.right<=f.right+1;});}));
  chk('email link does not overflow', await p.evaluate(()=>[...document.querySelectorAll('.ct-links li')].every(li=>li.scrollWidth<=li.clientWidth+1)));
  chk('canvas backing store capped at 2x', await p.evaluate(()=>{const cv=document.getElementById('ctGlobe');return cv.width<=Math.round(cv.getBoundingClientRect().width*2)+1;}));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

await b.close(); srv.close();
console.log(bad?`\n${bad} FAILED`:'\nall passed');
process.exit(bad?1:0);
