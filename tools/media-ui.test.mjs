/* QR codes and posters as a person meets them: the admin tab that uploads them
   (against the real booth-admin script, Google stubbed), and the booth page that
   shows what is live.

   Admin: a real QR picture and a real poster go in together; the page works out
   which is which, shrinks them, and the script names them. Choosing the event
   locks the rest. Staff without the area never see the tab.
   Site: live items appear, locked ones are not in the page at all, the built-in
   codes can be hidden, a hostile label is text, and nothing runs off the screen. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load, OWNER } from './booth-admin-harness.mjs';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8240+Math.floor(Math.random()*50), BASE='http://127.0.0.1:'+PORT, API=BASE+'/api';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++; console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, ms=15000, step=100){ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(step);} return fn(); }

const H = load();
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.webmanifest':'application/manifest+json'};
const srv=http.createServer((req,res)=>{
  const u=new URL(req.url,BASE);
  if(u.pathname==='/api'){
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
      let out; try{ out=H.call(JSON.parse(body||'{}')); }catch(e){ out={ok:false,error:String(e.message)}; }
      res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(out));
    }); return;
  }
  let f=decodeURIComponent(u.pathname); if(f.endsWith('/')) f+='index.html';
  const fp=path.join(ROOT,f);
  if(f==='/sw.js'||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'}); res.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch();

/* a real QR picture: the WhatsApp code that is already in the page */
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'media-'));
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const qrs=[...html.slice(html.indexOf('<section id="qrcore">')).matchAll(/data:image\/png;base64,([A-Za-z0-9+\/=]+)/g)];
const QR=path.join(tmp,'IMG_8841.png'); fs.writeFileSync(QR, Buffer.from(qrs[2][1],'base64'));
const POSTER=path.join(ROOT,'docs','talk-poster-1.webp');
const ONE_PX=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64');

async function asPerson(token, w=1280, h=900){
  const c=await b.newContext({viewport:{width:w,height:h}});
  await c.addInitScript(([a,t])=>{ window.__BOOTH_API=a; try{ localStorage.setItem('fx.admin.token',t); }catch(e){} }, [API, token]);
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  p.on('dialog', d=>d.accept('Pharmacy Day'));
  await p.goto(BASE+'/admin.html',{waitUntil:'load'});
  await until(()=>p.evaluate(()=>!document.getElementById('app').hidden));
  await sleep(300);
  return {c,p,errs};
}
const own = H.signIn(OWNER);
const rows = () => H.tabs['Media'].rows.slice(1).filter(r=>r[0] && !String(r[0]).startsWith('builtin-'));

console.log('── the admin tab');
{
  const {c,p,errs}=await asPerson(own.token);
  chk('the owner has the QR & posters tab', await p.evaluate(()=>[...document.querySelectorAll('.tab')].filter(t=>!t.hidden).map(t=>t.dataset.view).includes('media')));
  await p.click('#tabMedia');
  const bi=await p.evaluate(()=>[...document.querySelectorAll('#mediaList .item')].map(x=>({id:x.dataset.id, t:x.textContent, img:(x.querySelector('img')||{}).naturalWidth||0, del:!!x.querySelector('[data-act="del"]')})));
  chk('it opens listing what is built into the page: three codes and the session poster', bi.length===4 && /Registration/.test(bi[0].t) && /More Info/.test(bi[1].t) && /WhatsApp/.test(bi[2].t) && /Session poster/.test(bi[3].t) && bi.every(x=>/built into the page/.test(x.t)), bi.map(x=>x.t));
  chk('...each showing its own picture', await until(()=>p.evaluate(()=>[...document.querySelectorAll('#mediaList .item img')].length===4 && [...document.querySelectorAll('#mediaList .item img')].every(i=>i.complete && i.naturalWidth>100))));
  chk('...with hide and tie-to-event, but no delete', bi.every(x=>!x.del));
  await p.evaluate(()=>document.querySelector('#mediaList .item[data-id="builtin-qr-more-info"] button[data-act="toggle"]').click());
  chk('hiding the More Info code from the list reaches the page config', await until(()=>JSON.stringify(H.call({action:'config'}).builtin_off)==='["builtin-qr-more-info"]'));
  chk('...and the list says Off', await until(()=>p.evaluate(()=>/Off/.test(document.querySelector('#mediaList .item[data-id="builtin-qr-more-info"]').textContent))));
  await p.evaluate(()=>document.querySelector('#mediaList .item[data-id="builtin-qr-more-info"] button[data-act="toggle"]').click());
  chk('...and back on', await until(()=>H.call({action:'config'}).builtin_off.length===0));
  await p.setInputFiles('#mediaFiles',[QR,POSTER]);
  await p.fill('#mediaUpEvent','AGM Penang 2026');
  await p.click('#mediaUp');
  chk('two pictures upload', await until(()=>rows().length===2), rows().length);
  const [r1,r2]=rows();
  chk('the QR picture was told apart from the poster', r1[1]==='qr' && r2[1]==='poster', [r1[1],r2[1]]);
  chk('the QR code was read, and is named for where it leads, not for IMG_8841', r1[2]==='qr-agm-penang-2026-whatsapp-01' && /^https:\/\/wa\.me\//.test(r1[7]), [r1[2],r1[7]]);
  chk('the poster is named from its file', r2[2]==='poster-agm-penang-2026-talk-poster-1-01', r2[2]);
  chk('the poster was shrunk to a JPEG under the limit', r2[8]==='image/jpeg' && r2[9]>1000 && r2[9]<2500000, [r2[8],r2[9]]);
  chk('both are in Drive and public (no event is chosen yet)', Object.values(H.DRIVE.files).length===2 && Object.values(H.DRIVE.files).every(f=>f.access==='ANYONE_WITH_LINK'));
  chk('the list shows them under their event, as Live', await p.evaluate(()=>{ const t=document.getElementById('mediaList').textContent; return /AGM Penang 2026/.test(t) && /qr-agm-penang-2026-whatsapp-01/.test(t) && [...document.querySelectorAll('#mediaList .item')].filter(x=>!/built into the page/.test(x.textContent)).every(x=>/Live/.test(x.textContent)); }));
  chk('...with no field to type a name into', await p.evaluate(()=>!document.querySelector('#viewMedia input[name*="name" i], #viewMedia #mediaName')));

  await p.setInputFiles('#mediaFiles',[QR]);
  await p.selectOption('#mediaKind','qr'); await p.fill('#mediaUpEvent','Pharmacy Day'); await p.click('#mediaUp');
  chk('a third, for another event', await until(()=>rows().length===3));
  await p.fill('#mediaEvent','AGM Penang 2026'); await p.click('#mediaEventSave');
  chk('choosing the event locks the other one in Drive', await until(()=>Object.values(H.DRIVE.files).find(f=>f.name.startsWith('qr-pharmacy-day'))?.access==='PRIVATE'));
  chk('...and the list says locked, not off', await until(()=>p.evaluate(()=>{ const it=[...document.querySelectorAll('#mediaList .item')].find(x=>/pharmacy-day/.test(x.textContent)); return !!it && /Locked/.test(it.textContent) && !it.querySelector('img'); })));
  chk('...the current event is marked "now"', await p.evaluate(()=>/AGM Penang 2026\s*now/.test(document.querySelector('#mediaList .mgroup').textContent) || [...document.querySelectorAll('.mgroup')].some(g=>/AGM Penang 2026/.test(g.textContent)&&/now/.test(g.textContent))));
  chk('the public config now lists two, not three', H.call({action:'config'}).media.length===2);

  await p.click('#mediaList .item button[data-act="toggle"]');
  chk('the pause button turns one off', await until(()=>rows().filter(r=>r[5]==='no').length===1));
  const pharm = await p.evaluate(()=>[...document.querySelectorAll('#mediaList .item')].find(x=>/pharmacy-day/.test(x.textContent)).dataset.id);
  await p.evaluate(id=>document.querySelector('#mediaList .item[data-id="'+id+'"] button[data-act="move"]').click(), pharm);
  chk('move asks for an event (the dialog answered Pharmacy Day) and keeps it', await until(()=>rows().find(r=>r[0]===pharm)?.[4]==='Pharmacy Day'));
  await p.evaluate(id=>document.querySelector('#mediaList .item[data-id="'+id+'"] button[data-act="del"]').click(), pharm);
  chk('delete removes the row and bins the file', await until(()=>rows().length===2 && Object.values(H.DRIVE.files).find(f=>f.name.startsWith('qr-pharmacy-day')).trashed));
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}
console.log('\n── the admin tab on a phone and a tablet');
for(const [tag,w,h] of [['phone',360,740],['tablet',820,1180]]){
  const {c,p,errs}=await asPerson(own.token, w, h);
  await p.click('#tabMedia'); await sleep(300);
  const r=await p.evaluate(()=>{ const vw=innerWidth, out=[];
    for(const e of document.querySelectorAll('#viewMedia *')){ const b=e.getBoundingClientRect(); if(!b.width||!b.height) continue;
      if(b.left<-1||b.right>vw+1) out.push((e.id||e.className||e.tagName)+' '+Math.round(b.left)+'..'+Math.round(b.right)); }
    const small=[...document.querySelectorAll('#viewMedia button, #viewMedia input, #viewMedia select')].filter(e=>{ const b=e.getBoundingClientRect(); return b.width && (b.height<32||b.width<32) && e.type!=='checkbox'; }).map(e=>(e.id||e.dataset.act)+' '+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height));
    return { sw:document.documentElement.scrollWidth, vw, out:out.slice(0,5), small:small.slice(0,5) }; });
  chk(`${tag}: nothing in the tab runs off the screen`, r.sw<=r.vw+1 && !r.out.length, r);
  chk(`${tag}: every control is big enough for a thumb`, !r.small.length, r.small);
  chk(`${tag}: no page errors`, errs.length===0, errs[0]);
  await c.close();
}

console.log('\n── an old script');
{
  /* a script deployed before this feature sends no `media` at all */
  const {c,p}=await asPerson(own.token);
  await p.route('**/api', async r=>{ const j=JSON.parse(r.request().postData()||'{}'); const out=H.call(j); if(j.action==='admin.get'){ delete out.media; delete out.events; } r.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(out)}); });
  await p.reload(); await until(()=>p.evaluate(()=>!document.getElementById('app').hidden)); await sleep(300);
  await p.click('#tabMedia');
  chk('says to paste and re-deploy the script, rather than showing a broken tab', await p.evaluate(()=>/re-deploy/.test(document.getElementById('mediaList').textContent)));
  await c.close();
}
console.log('\n── who sees it');
{
  H.call({ token:own.token, action:'admin.team.save', person:{ email:'ben@clinic.test', name:'Ben', role:'staff', access:['counter'] } });
  const ben=H.signIn('ben@clinic.test');
  const {c,p}=await asPerson(ben.token);
  chk('staff without the area do not get the tab', await p.evaluate(()=>![...document.querySelectorAll('.tab')].filter(t=>!t.hidden).map(t=>t.dataset.view).includes('media')));
  await c.close();
}

console.log('\n── the booth page');
const CFG = (media, st={}, states=[], off=[]) => ({ ok:true, builtin_off:off, settings:{ page_mode:'open', welcome:'show', games_off:'', active_event:'AGM Penang 2026', ...st }, segments:[], section_states:states, media, at:Date.now() });
const LH = n => 'https://lh3.googleusercontent.com/d/drv00000'+n+'=';
const QRS = [{id:'a',kind:'qr',name:'qr-agm-whatsapp-01',label:'whatsapp',url:LH(1)+'s800',link:'https://wa.me/message/X'},
             {id:'b',kind:'qr',name:'qr-agm-code-01',label:'code',url:LH(2)+'s800'}];
const POS = [{id:'c',kind:'poster',name:'poster-agm-talk-01',label:'Dermocosmetic Talk',url:LH(3)+'w1800'}];
for(const [tag,w,h] of [['phone',390,844],['tablet',820,1180],['tablet sideways',1180,820]]){
  const c=await b.newContext({viewport:{width:w,height:h},isMobile:w<700,hasTouch:true});
  await c.addInitScript(()=>{ window.__BOOTH_API='http://127.0.0.1:1/none'; });
  await c.route(u=>u.hostname==='lh3.googleusercontent.com', r=>r.fulfill({contentType:'image/png',body:ONE_PX}));
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/index.html',{waitUntil:'load'}); await sleep(500);
  const cards=()=>p.evaluate(()=>[...document.querySelectorAll('#qrcore .qr-card')].map(c=>({media:c.classList.contains('booth-media'),shown:getComputedStyle(c).display!=='none',h4:c.querySelector('h4').textContent,link:c.querySelector('a.qr-link')?.href||''})));
  await p.evaluate(m=>window.__boothApply(m,false), CFG([...QRS,...POS]));
  let k=await cards();
  chk(`${tag}: the uploaded codes follow the built-in three`, k.length===5 && k.slice(0,3).every(x=>!x.media&&x.shown) && k.slice(3).every(x=>x.media&&x.shown), k);
  chk(`${tag}: a code with a link says where (and is not a made-up address)`, k[3].h4==='Whatsapp' && k[3].link==='https://wa.me/message/X' && k[4].link==='', k.slice(3));
  chk(`${tag}: the poster has its own section, under the talk`, await p.evaluate(()=>{ const s=document.getElementById('eventposters'); const t=document.getElementById('talk'); return !!s && s.querySelectorAll('figure').length===1 && !!(t.compareDocumentPosition(s)&Node.DOCUMENT_POSITION_FOLLOWING) && /Dermocosmetic Talk/.test(s.textContent) && /=w2400$/.test(s.querySelector('a').href); }));
  chk(`${tag}: no sideways scroll`, await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const fit=await p.evaluate(()=>{ const r=document.querySelector('#eventposters img').getBoundingClientRect(); return {l:r.left,r:r.right,w:innerWidth}; });
  chk(`${tag}: the poster is inside the screen`, fit.l>=0 && fit.r<=fit.w+1, fit);

  await p.evaluate(m=>window.__boothApply(m,false), CFG([...QRS,...POS],{},[],['builtin-qr-more-info']));
  k=await cards();
  chk(`${tag}: one built-in code hidden, the other two and the uploaded stay`, k.map(x=>x.shown).join()==='true,false,true,true,true', k.map(x=>x.shown));
  await p.evaluate(m=>window.__boothApply(m,false), CFG([],{},[],['builtin-poster-session-talk']));
  chk(`${tag}: hiding the session poster takes its talk section off the page`, await p.evaluate(()=>getComputedStyle(document.getElementById('talk')).display==='none' && getComputedStyle(document.getElementById('qrcore')).display!=='none'));
  await p.evaluate(m=>window.__boothApply(m,true), CFG([],{},[],['builtin-poster-session-talk','builtin-qr-registration']));
  chk(`${tag}: an admin previewing still sees everything`, await p.evaluate(()=>getComputedStyle(document.getElementById('talk')).display!=='none' && [...document.querySelectorAll('#qrcore .qr-card')].every(c=>getComputedStyle(c).display!=='none')));
  await p.evaluate(m=>window.__boothApply(m,false), CFG([],{},[],['builtin-qr-registration','builtin-qr-more-info','builtin-qr-whatsapp']));
  chk(`${tag}: hide them with nothing uploaded and the whole section goes, not an empty heading`, await p.evaluate(()=>getComputedStyle(document.getElementById('qrcore')).display==='none'));
  chk(`${tag}: ...and its menu link`, await p.evaluate(()=>[...document.querySelectorAll('a[href="#qrcore"]')].every(a=>getComputedStyle(a).display==='none')));
  await p.evaluate(m=>window.__boothApply(m,false), CFG([]));
  chk(`${tag}: no media: back to the page as it was`, await p.evaluate(()=>!document.getElementById('eventposters') && !document.querySelector('.booth-media') && document.querySelectorAll('#qrcore .qr-card').length===3 && getComputedStyle(document.getElementById('qrcore')).display!=='none' && getComputedStyle(document.getElementById('talk')).display!=='none' && [...document.querySelectorAll('#qrcore .qr-card')].every(c=>getComputedStyle(c).display!=='none')));
  chk(`${tag}: no page errors`, errs.length===0, errs[0]);
  await c.close();
}
{
  const c=await b.newContext({viewport:{width:390,height:844}});
  await c.addInitScript(()=>{ window.__BOOTH_API='http://127.0.0.1:1/none'; });
  await c.route(u=>u.hostname==='lh3.googleusercontent.com', r=>r.fulfill({contentType:'image/png',body:ONE_PX}));
  const p=await c.newPage(); await p.goto(BASE+'/index.html',{waitUntil:'load'}); await sleep(400);
  await p.evaluate(m=>window.__boothApply(m,false), CFG([
    {id:'x',kind:'poster',name:'p',label:'<img src=x onerror="window.__owned=1">',url:LH(4)+'w1800'},
    {id:'y',kind:'poster',name:'q',label:'elsewhere',url:'https://evil.example/poster.png'},
    {id:'z',kind:'qr',name:'r',label:'"><script>window.__owned=2</script>',url:LH(5)+'s800',link:'https://wa.me/x" onmouseover="window.__owned=3'}]));
  await sleep(300);
  chk('a hostile label is plain text: nothing ran', await p.evaluate(()=>!window.__owned && !!document.querySelector('#eventposters figcaption')));
  chk('a picture that is not on Drive\'s picture host is not drawn at all', await p.evaluate(()=>![...document.images].some(i=>/evil\.example/.test(i.src))));
  await p.evaluate(m=>window.__boothApply(m,false), CFG([{id:'w',kind:'poster',name:'p',label:'Hidden section',url:LH(6)+'w1800'}],{},[{id:'qrcore',label:'QR Code',mode:'hidden'}]));
  chk('an admin-hidden QR section stays hidden when media are drawn', await p.evaluate(()=>getComputedStyle(document.getElementById('qrcore')).display==='none'));
  await c.close();
}

await b.close(); srv.close(); fs.rmSync(tmp,{recursive:true,force:true});
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad?1:0);
