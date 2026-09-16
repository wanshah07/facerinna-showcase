/* The booth page and the admin page against a stand-in for the Apps Script,
   served in-process so what each one posts can be checked and what each one
   is told can be chosen. The script itself is tested in booth-admin.test.mjs;
   this is the two pages doing what they are told. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8127, BASE='http://127.0.0.1:'+PORT, API=BASE+'/api';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, ms=4000, step=60){ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(step);} return fn(); }
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};

/* ---- the stand-in script ---- */
const S={
  settings:{page_mode:'open', lock_message:'Ask the team for the passcode', hidden_message:'Back on Monday', welcome:'show'},
  passcode:'booth2026',
  segments:[], sections:[['range','The Range'],['qrcore','QR Code'],['talk',"Dr. Peter's Talk"],['game','Games'],['end','End of page']],
  admins:[{email:'wan@facerinna.test',active:true,name:'Wan'}],
  tokens:{'11111111-1111-4111-8111-111111111111':'wan@facerinna.test'},
  links:{'22222222-2222-4222-8222-222222222222':'wan@facerinna.test'},
  down:false, posted:[], mails:[]
};
const pub=()=>({ok:true, settings:{...S.settings}, segments:S.segments.filter(s=>s.visible), sections:S.sections, at:Date.now()});
function handle(b){
  S.posted.push(b);
  const auth=()=>S.tokens[b.token];
  switch(b.action){
    case 'config': return pub();
    case 'unlock': return b.passcode===S.passcode ? {ok:true} : {ok:false,error:'wrong passcode'};
    case 'login': if(S.admins.some(a=>a.email===String(b.email).toLowerCase())) S.mails.push(b.email); return {ok:true,sent:true};
    case 'exchange': { const e=S.links[b.key]; if(!e) return {ok:false,error:'that link is not valid'}; delete S.links[b.key];
      const t='33333333-3333-4333-8333-333333333333'; S.tokens[t]=e; return {ok:true,token:t,email:e}; }
    case 'whoami': return auth() ? {ok:true,email:auth()} : {ok:false,error:'signed out'};
    case 'logout': delete S.tokens[b.token]; return {ok:true};
    case 'admin.get': return auth() ? {ok:true,email:auth(),settings:{...S.settings,passcode:S.passcode},segments:S.segments,admins:S.admins,sections:S.sections,quota:97} : {ok:false,error:'signed out'};
    case 'admin.settings': if(!auth()) return {ok:false,error:'signed out'};
      for(const k of ['page_mode','lock_message','hidden_message','welcome']) if(k in b.settings) S.settings[k]=b.settings[k];
      if('passcode' in b.settings) S.passcode=b.settings.passcode;
      return {ok:true,settings:{...S.settings,passcode:S.passcode},public:S.settings};
    case 'admin.segment.save': if(!auth()) return {ok:false,error:'signed out'};
      { const seg={...b.segment}; if(!seg.id){ seg.id='seg-'+String(S.segments.length+1).padStart(10,'0'); S.segments.push(seg); }
        else { const i=S.segments.findIndex(s=>s.id===seg.id); S.segments[i]=seg; } return {ok:true,id:seg.id,segments:S.segments}; }
    case 'admin.segment.delete': S.segments=S.segments.filter(s=>s.id!==b.id); return {ok:true,segments:S.segments};
    case 'admin.segment.order': S.segments.sort((x,y)=>b.ids.indexOf(x.id)-b.ids.indexOf(y.id)); return {ok:true,segments:S.segments};
    default: return {ok:false,error:'unknown action'};
  }
}
const srv=http.createServer((req,res)=>{
  const u=new URL(req.url,BASE);
  if(u.pathname==='/api'){
    if(S.down){ res.destroy(); return; }
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{ let b={}; try{ b=JSON.parse(body||'{}'); }catch(e){}
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(handle(b))); });
    return;
  }
  let f=decodeURIComponent(u.pathname); if(f.endsWith('/')) f+='index.html';
  /* no worker here: it would answer later loads itself, and a registration
     that fails is swallowed by the pages */
  if(f==='/sw.js'){ res.writeHead(404); res.end(); return; }
  const fp=path.join(ROOT,f);
  if(!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'}); res.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
async function ctx(){ const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await c.addInitScript(api=>{ window.__BOOTH_API=api; }, API);
  return c; }
const veil = p => p.evaluate(()=>{ const v=document.getElementById('boothVeil'); if(!v) return null; const r=v.getBoundingClientRect();
  return {text:v.innerText, input:!!v.querySelector('#boothPass'), covers:r.width>=innerWidth-1 && r.height>=innerHeight-1, hiddenBody:getComputedStyle(document.querySelector('.hero')).visibility==='hidden'}; });

/* ------------------------------------------------------------- the page, open */
{
  const c=await ctx(); const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  S.segments=[{id:'seg-0000000001',after:'qrcore',eyebrow:'Watch',title:'Skin IQ in 60 seconds',description:'A short clip.',
    thumbnail_url:BASE+'/docs/talk-poster-1.webp',embed_url:BASE+'/uv-card.html',link_url:'https://example.com/more',link_label:'More info',visible:true},
    {id:'seg-0000000002',after:'end',title:'Hidden one',visible:false}];
  await p.goto(BASE+'/index.html',{waitUntil:'load'});
  await until(()=>p.evaluate(()=>!!document.querySelector('.booth-seg')));
  chk('open: no veil', (await veil(p))===null);
  chk('open: the welcome strip shows', await p.evaluate(()=>getComputedStyle(document.querySelector('.hero-marquee')).display!=='none'));
  const seg=await p.evaluate(()=>{ const s=document.querySelector('.booth-seg'); if(!s) return null; const prev=s.previousElementSibling && s.previousElementSibling.previousElementSibling;
    return {id:s.id, after:prev&&prev.id, title:s.querySelector('h2').textContent, eyebrow:(s.querySelector('.eyebrow')||{}).textContent, desc:(s.querySelector('.sec-head p')||{}).textContent,
      img:!!s.querySelector('img.flyer-thumb'), open:!!s.querySelector('.seg-open'), link:(s.querySelector('a.btn')||{}).href, n:document.querySelectorAll('.booth-seg').length}; });
  chk('open: the segment is drawn after the QR section with its title, eyebrow, description, thumbnail, Open and link', seg && seg.after==='qrcore' && seg.title==='Skin IQ in 60 seconds' && seg.eyebrow==='Watch' && seg.desc==='A short clip.' && seg.img && seg.open && /example\.com\/more/.test(seg.link), seg);
  chk('open: the hidden segment is not drawn (the script never sends it)', seg.n===1);
  await p.evaluate(()=>document.querySelector('.booth-seg').scrollIntoView());
  await p.click('.booth-seg .seg-open'); await sleep(500);
  const modal=await p.evaluate(()=>{ const m=document.getElementById('segModal'); return m ? {src:m.querySelector('iframe').getAttribute('src'), title:m.querySelector('b').textContent} : null; });
  chk('open: Open shows the embed in a viewer', modal && /uv-card\.html$/.test(modal.src) && modal.title==='Skin IQ in 60 seconds', modal);
  await p.click('#segModal .sm-x'); await sleep(200);
  chk('open: and it closes', await p.evaluate(()=>!document.getElementById('segModal')));
  chk('open: the config is remembered for offline', await p.evaluate(()=>{ try{ return !!JSON.parse(localStorage.getItem('fx.booth.config')).cfg.settings; }catch(e){ return false; } }));
  chk('open: the footer links to the admin', await p.evaluate(()=>!!document.querySelector('footer a[href="admin.html"]')));
  chk('open: no page errors'+(errs.length?': '+errs[0]:''), errs.length===0);

  /* the same visitor, the page now locked */
  S.settings.page_mode='locked'; S.settings.welcome='hide';
  await p.goto(BASE+'/index.html',{waitUntil:'load'});
  await until(async()=>!!(await veil(p)));
  let v=await veil(p);
  chk('locked: a veil covers the page with the message and a passcode box', v && v.covers && v.input && /Ask the team/.test(v.text), v);
  chk('locked: the page behind it is hidden', v && v.hiddenBody, v);
  chk('locked: the welcome strip is hidden too', await p.evaluate(()=>getComputedStyle(document.querySelector('.hero-marquee')).display==='none'));
  await p.fill('#boothPass','wrong'); await p.click('#boothVeil button'); await sleep(400);
  v=await veil(p);
  chk('locked: a wrong passcode stays locked and says so', v && /wrong passcode/i.test(v.text), v);
  await p.fill('#boothPass','booth2026'); await p.click('#boothVeil button');
  chk('locked: the right passcode opens it', await until(async()=>(await veil(p))===null));
  chk('locked: the passcode never travelled in the config', !S.posted.some(x=>x.action==='config' && JSON.stringify(x).includes('booth2026')) && !(await p.evaluate(()=>JSON.stringify(localStorage.getItem('fx.booth.config')).includes('booth2026'))));
  await p.goto(BASE+'/index.html',{waitUntil:'load'}); await sleep(1200);
  chk('locked: once opened, it stays open for the session', (await veil(p))===null);

  /* a new visitor while the script is unreachable: the veil comes from the cache */
  await p.evaluate(()=>sessionStorage.clear());
  S.down=true;
  await p.goto(BASE+'/index.html',{waitUntil:'load'}); await sleep(1500);
  v=await veil(p);
  chk('offline: with the script unreachable the last config still locks the page', v && v.input, v);
  chk('offline: ...from the first paint, not after a flash', await p.evaluate(()=>document.documentElement.classList.contains('booth-veiled')));
  S.down=false;

  /* hidden */
  S.settings.page_mode='hidden';
  await p.goto(BASE+'/index.html',{waitUntil:'load'});
  await until(async()=>{ const x=await veil(p); return x && /Back on Monday/.test(x.text); });
  v=await veil(p);
  chk('hidden: a notice covers the page, with no passcode box', v && v.covers && !v.input && /Back on Monday/.test(v.text), v);

  /* an admin sees through it */
  await p.evaluate(()=>localStorage.setItem('fx.admin.token','11111111-1111-4111-8111-111111111111'));
  await p.goto(BASE+'/index.html',{waitUntil:'load'}); await sleep(1500);
  chk('hidden: a signed-in admin sees the page with a ribbon instead', (await veil(p))===null && await p.evaluate(()=>/Admin preview/.test((document.getElementById('boothRibbon')||{}).textContent||'')));
  S.settings.page_mode='open'; S.settings.welcome='show';
  await c.close();
}

/* -------------------------------------------------------------- the admin page */
{
  const c=await ctx(); const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/admin.html',{waitUntil:'load'}); await sleep(300);
  chk('admin: connected, so no warning; the sign-in form shows', await p.evaluate(()=>document.getElementById('notConfigured').hidden && !document.getElementById('viewLogin').hidden && document.getElementById('app').hidden));
  await p.fill('#loginEmail','Wan@facerinna.test'); await p.click('#loginBtn');
  chk('admin: asking for a link posts the address and says check your inbox', await until(()=>p.evaluate(()=>!document.getElementById('sentNote').hidden)) && S.posted.some(x=>x.action==='login' && x.email==='Wan@facerinna.test'));
  chk('admin: the stand-in would have mailed it', S.mails.includes('Wan@facerinna.test') || S.mails.includes('wan@facerinna.test'));

  /* the link is opened -- from the mail, so a fresh load, not a hash change
     on the page already open (that would be a same-document navigation and
     nothing would run) */
  await p.goto('about:blank');
  await p.goto(BASE+'/admin.html#k=22222222-2222-4222-8222-222222222222',{waitUntil:'load'});
  chk('admin: the link signs in', await until(()=>p.evaluate(()=>!document.getElementById('app').hidden)));
  chk('admin: the key is taken off the address bar', await p.evaluate(()=>!location.hash));
  chk('admin: it says who is signed in', await p.evaluate(()=>document.getElementById('whoEmail').textContent==='wan@facerinna.test'));
  chk('admin: the session is kept', await p.evaluate(()=>localStorage.getItem('fx.admin.token')==='33333333-3333-4333-8333-333333333333'));
  const st=await p.evaluate(()=>({open:document.getElementById('modeOpen').checked, pass:document.getElementById('passcode').value, lock:document.getElementById('lockMessage').value, welcome:document.getElementById('welcome').checked}));
  chk('admin: the settings tab shows what the sheet holds', st.open && st.pass==='booth2026' && /Ask the team/.test(st.lock) && st.welcome, st);

  await p.check('#modeLocked'); await p.fill('#lockMessage','Members only tonight'); await p.uncheck('#welcome'); await p.click('#saveSettings');
  chk('admin: saving posts the settings', await until(()=>Promise.resolve(S.settings.page_mode==='locked' && S.settings.lock_message==='Members only tonight' && S.settings.welcome==='hide')), S.settings);
  /* The server having the value is not the page having finished: the answer
     comes back and re-fills the form from it. Type into the form before that
     lands and the next thing typed is quietly overwritten -- which is what
     made this flaky once in four. #settingsState is set immediately after the
     re-fill, so it is the honest "done". */
  chk('admin: ...and the form settles before anything else is typed',
      await until(()=>p.evaluate(()=>/Saved/.test(document.getElementById('settingsState').textContent))));
  await p.check('#modeLocked'); await p.fill('#passcode',''); await p.click('#saveSettings'); await sleep(300);
  chk('admin: locking with an empty passcode is refused on the page', await p.evaluate(()=>/passcode/i.test(document.getElementById('toast').textContent)) && S.passcode==='booth2026');

  await p.click('#tabSegments');
  chk('admin: the segments tab lists what the sheet holds, hidden ones included', await p.evaluate(()=>document.querySelectorAll('#segList .item').length===2 && !!document.querySelector('#segList .item.hidden')));
  chk('admin: the place menu comes from the script', await p.evaluate(()=>[...document.querySelectorAll('#segAfter option')].map(o=>o.value).join()==='range,qrcore,talk,game,end'));
  await p.fill('#segTitle','Registration video'); await p.fill('#segEyebrow','Watch'); await p.selectOption('#segAfter','talk');
  await p.fill('#segThumb','https://img.example/reg.jpg'); await p.fill('#segEmbed','https://www.youtube.com/embed/xyz'); await p.click('#segSave');
  chk('admin: adding a segment posts it and it appears in the list', await until(()=>Promise.resolve(S.segments.length===3)) && await until(()=>p.evaluate(()=>document.querySelectorAll('#segList .item').length===3)));
  const saved=S.segments[2];
  chk('admin: with what was typed', saved.title==='Registration video' && saved.after==='talk' && saved.embed_url==='https://www.youtube.com/embed/xyz' && saved.visible===true, saved);
  chk('admin: the form is cleared for the next one', await p.evaluate(()=>document.getElementById('segTitle').value===''));
  await p.click('#segList .item:nth-child(3) button[data-act="up"]');
  chk('admin: the arrows reorder', await until(()=>Promise.resolve(S.posted.some(x=>x.action==='admin.segment.order') && S.segments[1].id===saved.id)));
  await p.click('#segList .item:nth-child(2) button[data-act="edit"]');
  chk('admin: edit loads it into the form', await p.evaluate(()=>document.getElementById('segTitle').value==='Registration video' && document.getElementById('segId').value!==''));
  await p.fill('#segTitle','Registration video (edited)'); await p.click('#segSave');
  chk('admin: saving an edit keeps the id', await until(()=>Promise.resolve(S.segments.length===3 && S.segments.some(s=>s.id===saved.id && s.title==='Registration video (edited)'))));
  p.once('dialog', d=>d.accept());
  await p.click('#segList .item:nth-child(2) button[data-act="del"]');
  chk('admin: delete asks, then posts', await until(()=>Promise.resolve(S.segments.length===2 && !S.segments.some(s=>s.id===saved.id))));

  await p.click('#tabAdmins');
  chk('admin: the admins tab lists the sheet, read-only', await p.evaluate(()=>document.querySelectorAll('#adminList .item').length===1 && /wan@facerinna.test/.test(document.getElementById('adminList').textContent) && !document.querySelector('#viewAdmins input')));
  await p.click('#signOut');
  chk('admin: sign out returns to the form and forgets the session', await until(()=>p.evaluate(()=>!document.getElementById('viewLogin').hidden && !localStorage.getItem('fx.admin.token'))) && S.posted.some(x=>x.action==='logout'));
  chk('admin: no page errors'+(errs.length?': '+errs[0]:''), errs.length===0);
  await c.close();
}

/* ------------------------------------- with the script address blanked out
   Both pages now carry the real deployed address, so "unwired" has to be
   asked for: the guard that keeps the page working with no script behind it
   is still worth holding on to. */
{
  const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await c.addInitScript(()=>{ window.__BOOTH_API=''; });
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  const n0=S.posted.length;
  await p.goto(BASE+'/index.html',{waitUntil:'load'}); await sleep(1200);
  chk('unwired: the page asks the script nothing and is exactly the file', S.posted.length===n0 && (await veil(p))===null && await p.evaluate(()=>!document.querySelector('.booth-seg')));
  await p.goto(BASE+'/admin.html',{waitUntil:'load'}); await sleep(200);
  chk('unwired: the admin page says it is not connected', await p.evaluate(()=>!document.getElementById('notConfigured').hidden));
  chk('unwired: no page errors'+(errs.length?': '+errs[0]:''), errs.length===0);
  await c.close();
}

await b.close(); await new Promise(r=>srv.close(r));
console.log(bad? '\nSOMETHING IS WRONG' : '\nthe sheet runs the page; the admin runs the sheet');
process.exit(bad?1:0);
