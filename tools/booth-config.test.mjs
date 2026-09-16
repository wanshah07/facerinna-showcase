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
  sectionRows:[['range','The Range'],['qrcore','QR Code'],['talk',"Dr. Peter's Talk"],['game','Games']]
    .map(([id,label])=>({id,label,mode:'show',passcode:'',message:''})),
  admins:[{email:'wan@facerinna.test',active:true,name:'Wan'}],
  tokens:{'11111111-1111-4111-8111-111111111111':'wan@facerinna.test'},
  links:{'22222222-2222-4222-8222-222222222222':'wan@facerinna.test'},
  down:false, posted:[], mails:[]
};
const segMode = s => s.mode || (s.visible===false ? 'hidden' : 'show');
/* what the real script sends: hidden segments not at all, locked ones without
   the embed and the link */
const pubSegs = () => S.segments.filter(s=>segMode(s)!=='hidden').map(s=>{
  const o={id:s.id, after:s.after, eyebrow:s.eyebrow, title:s.title, description:s.description, thumbnail_url:s.thumbnail_url};
  if(segMode(s)==='locked'){ o.locked=true; return o; }
  return {...o, embed_url:s.embed_url, link_url:s.link_url, link_label:s.link_label};
});
const pub=()=>({ok:true, settings:{...S.settings}, segments:pubSegs(), sections:S.sections,
  section_states:S.sectionRows.filter(x=>x.mode!=='show').map(({id,label,mode,message})=>({id,label,mode,message})),
  at:Date.now()});
function handle(b){
  S.posted.push(b);
  const auth=()=>S.tokens[b.token];
  switch(b.action){
    case 'config': return pub();
    case 'unlock': {
      if(b.section){ const x=S.sectionRows.find(r=>r.id===b.section);
        if(!x) return {ok:false,error:'no such section'};
        if(x.mode!=='locked') return {ok:true,open:true};
        return b.passcode===(x.passcode||S.passcode) ? {ok:true} : {ok:false,error:'wrong passcode'}; }
      if(b.segment){ const x=S.segments.find(r=>r.id===b.segment);
        if(!x) return {ok:false,error:'no such segment'};
        if(segMode(x)!=='locked') return {ok:true,open:true};
        return b.passcode===S.passcode
          ? {ok:true, segment:{embed_url:x.embed_url, link_url:x.link_url, link_label:x.link_label}}
          : {ok:false,error:'wrong passcode'}; }
      return b.passcode===S.passcode ? {ok:true} : {ok:false,error:'wrong passcode'};
    }
    case 'login': if(S.admins.some(a=>a.email===String(b.email).toLowerCase())) S.mails.push(b.email); return {ok:true,sent:true};
    case 'exchange': { const e=S.links[b.key]; if(!e) return {ok:false,error:'that link is not valid'}; delete S.links[b.key];
      const t='33333333-3333-4333-8333-333333333333'; S.tokens[t]=e; return {ok:true,token:t,email:e}; }
    case 'whoami': return auth() ? {ok:true,email:auth()} : {ok:false,error:'signed out'};
    case 'logout': delete S.tokens[b.token]; return {ok:true};
    case 'admin.get': return auth() ? {ok:true,email:auth(),settings:{...S.settings,passcode:S.passcode},segments:S.segments,
      admins:S.admins,sections:S.sections,section_rows:S.sectionRows,quota:97} : {ok:false,error:'signed out'};
    case 'admin.section.set': { if(!auth()) return {ok:false,error:'signed out'};
      const x=S.sectionRows.find(r=>r.id===b.id); if(!x) return {ok:false,error:'no such section'};
      x.mode=b.mode; x.passcode=b.passcode||''; x.message=b.message||'';
      return {ok:true, sections:S.sectionRows}; }
    case 'admin.settings': if(!auth()) return {ok:false,error:'signed out'};
      for(const k of ['page_mode','lock_message','hidden_message','welcome',
                      'privacy_entity','privacy_email','privacy_address','privacy_retention'])
        if(k in b.settings) S.settings[k]=b.settings[k];
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
/* A save is finished when the page says so. Waiting on the server alone lets
   the answer land later and re-render the form underneath whatever is typed
   next -- which is how the settings test went flaky once already. */
async function saved(p, click){
  await p.evaluate(()=>{ document.getElementById('toast').textContent=''; });
  await click();
  return until(()=>p.evaluate(()=>document.getElementById('toast').textContent.trim().length>0));
}
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
  /* the way into the admin moved from the footer to a gear in the header */
  chk('open: the header gear is the way into the admin', await p.evaluate(()=>
    !!document.querySelector('header.nav a#adminBtn[href="admin.html"]') && !document.querySelector('footer a[href="admin.html"]')));
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
  chk('admin: with what was typed', saved.title==='Registration video' && saved.after==='talk' && saved.embed_url==='https://www.youtube.com/embed/xyz' && saved.mode==='show', saved);
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

/* ----------------------------------------------- one section at a time */
{
  const c=await ctx(); const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  S.settings.page_mode='open'; S.settings.welcome='show'; S.segments=[];
  const sec = id => S.sectionRows.find(x=>x.id===id);
  const look = (p,id) => p.evaluate(i=>{
    const el=document.getElementById(i);
    const div=el && el.nextElementSibling;
    return { shown: !!el && getComputedStyle(el).display!=='none',
             divider: !!(div && div.querySelector && div.querySelector('.divider-line')) ? getComputedStyle(div).display!=='none' : null,
             navLinks: [...document.querySelectorAll('a[href="#'+i+'"]')].filter(a=>getComputedStyle(a).display!=='none').length,
             lock: !!(el && el.querySelector('.booth-lock')),
             lockText: el && el.querySelector('.booth-lock') ? el.querySelector('.booth-lock').innerText : '',
             contents: !!(el && [...el.children].some(ch=>!ch.classList.contains('booth-lock') && getComputedStyle(ch).display!=='none')) };
  }, id);

  sec('qrcore').mode='hidden';
  await p.goto(BASE+'/index.html',{waitUntil:'load'});
  await until(async()=>!(await look(p,'qrcore')).shown);
  let v=await look(p,'qrcore');
  chk('section: hiding the QR code takes the section off the page', !v.shown, v);
  chk('section: ...its divider with it', v.divider===false, v);
  chk('section: ...and every link in the menu and the footer that pointed at it', v.navLinks===0, v);
  chk('section: the ones left alone are untouched', (await look(p,'game')).shown && (await look(p,'talk')).shown);

  sec('qrcore').mode='show'; sec('game').mode='locked'; sec('game').message='Ask at the counter';
  await p.goto(BASE+'/index.html',{waitUntil:'load'});
  await until(async()=>(await look(p,'game')).lock);
  v=await look(p,'game');
  chk('section: a locked one shows a card in its place', v.lock && /Ask at the counter/.test(v.lockText), v);
  chk('section: ...with its own name on it', /Games/.test(v.lockText), v);
  chk('section: ...and its contents are not on the page', !v.contents, v);
  chk('section: ...while the QR code came back', (await look(p,'qrcore')).shown);
  await p.evaluate(()=>document.getElementById('game').scrollIntoView());
  await p.fill('#game .booth-lock input','nope'); await p.click('#game .booth-lock button'); await sleep(500);
  v=await look(p,'game');
  chk('section: a wrong passcode says so and stays shut', v.lock && /wrong passcode/i.test(v.lockText), v);
  await p.fill('#game .booth-lock input','booth2026'); await p.click('#game .booth-lock button');
  chk('section: the right one opens it', await until(async()=>{ const x=await look(p,'game'); return !x.lock && x.contents; }));
  await p.goto(BASE+'/index.html',{waitUntil:'load'}); await sleep(1400);
  chk('section: and it stays open for the rest of the visit', (await look(p,'game')).contents);

  /* a section with its own passcode does not open on the site one */
  sec('talk').mode='locked'; sec('talk').passcode='derma';
  await p.evaluate(()=>sessionStorage.clear());
  await p.goto(BASE+'/index.html',{waitUntil:'load'});
  await until(async()=>(await look(p,'talk')).lock);
  await p.evaluate(()=>document.getElementById('talk').scrollIntoView());
  await p.fill('#talk .booth-lock input','booth2026'); await p.click('#talk .booth-lock button'); await sleep(500);
  chk('section: its own passcode is the only one that opens it', (await look(p,'talk')).lock);
  await p.fill('#talk .booth-lock input','derma'); await p.click('#talk .booth-lock button');
  chk('section: ...and it does', await until(async()=>!(await look(p,'talk')).lock));
  chk('section: the other lock is its own affair', (await look(p,'game')).lock===true);

  /* an admin sees the page whole */
  await p.evaluate(()=>localStorage.setItem('fx.admin.token','11111111-1111-4111-8111-111111111111'));
  await p.goto(BASE+'/index.html',{waitUntil:'load'}); await sleep(1600);
  chk('section: a signed-in admin sees them all, with a ribbon naming what a visitor would not see',
      (await look(p,'game')).contents && (await look(p,'qrcore')).shown
      && await p.evaluate(()=>/Games is locked/.test((document.getElementById('boothRibbon')||{}).textContent||'')));
  await p.evaluate(()=>localStorage.removeItem('fx.admin.token'));
  sec('game').mode='show'; sec('talk').mode='show'; sec('talk').passcode='';
  chk('section: no page errors'+(errs.length?': '+errs[0]:''), errs.length===0);
  await c.close();
}

/* ------------------------------------------- a locked segment holds back */
{
  const c=await ctx(); const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  S.segments=[{id:'seg-locked-1',after:'game',title:'Members video',description:'For clinic partners.',
    thumbnail_url:BASE+'/docs/talk-poster-1.webp',embed_url:BASE+'/uv-card.html?members=only',
    link_url:'https://example.com/secret',link_label:'Watch',mode:'locked'}];
  await p.goto(BASE+'/index.html',{waitUntil:'load'});
  await until(()=>p.evaluate(()=>!!document.querySelector('.booth-seg .booth-lock')));
  let seg=await p.evaluate(()=>{ const s=document.querySelector('.booth-seg');
    return { title:s.querySelector('h2').textContent, lock:!!s.querySelector('.booth-lock'),
             openBtn:!!s.querySelector('.seg-open'), links:s.querySelectorAll('a.btn').length,
             html:document.documentElement.innerHTML }; });
  chk('segment: a locked one still shows its title', seg.title==='Members video');
  chk('segment: with a passcode card and no way in', seg.lock && !seg.openBtn && seg.links===0, {lock:seg.lock,openBtn:seg.openBtn,links:seg.links});
  /* the page links to uv-card.html on its own account, so the query string is
     what tells this segment's embed apart from the game in the gallery */
  chk('segment: its embed and its link are nowhere in the page, not merely covered',
      !seg.html.includes('example.com/secret') && !seg.html.includes('members=only'));
  await p.evaluate(()=>document.querySelector('.booth-seg').scrollIntoView());
  await p.fill('.booth-seg .booth-lock input','nope'); await p.click('.booth-seg .booth-lock button'); await sleep(500);
  chk('segment: a wrong passcode brings nothing back',
      await p.evaluate(()=>!!document.querySelector('.booth-seg .booth-lock') && !document.documentElement.innerHTML.includes('example.com/secret')));
  await p.fill('.booth-seg .booth-lock input','booth2026'); await p.click('.booth-seg .booth-lock button');
  chk('segment: the right one fetches the content and draws it',
      await until(()=>p.evaluate(()=>{ const s=document.querySelector('.booth-seg');
        return !!s && !s.querySelector('.booth-lock') && !!s.querySelector('.seg-open') && s.querySelectorAll('a.btn').length===1; })));
  await p.click('.booth-seg .seg-open'); await sleep(600);
  chk('segment: and it opens in the viewer like any other',
      await p.evaluate(()=>{ const m=document.getElementById('segModal'); return !!m && /uv-card\.html\?members=only$/.test(m.querySelector('iframe').getAttribute('src')); }));
  chk('segment: no page errors'+(errs.length?': '+errs[0]:''), errs.length===0);
  S.segments=[];
  await c.close();
}

/* ------------------------------------------- the admin's sections tab */
{
  const c=await ctx(); const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await c.addInitScript(()=>{ localStorage.setItem('fx.admin.token','11111111-1111-4111-8111-111111111111'); });
  await p.goto(BASE+'/admin.html',{waitUntil:'load'});
  await until(()=>p.evaluate(()=>!document.getElementById('app').hidden));
  chk('admin: the View page button stays in this tab', await p.evaluate(()=>{
    const a=document.querySelector('.who a[href="index.html"]'); return !!a && !a.target; }));
  await p.click('#tabSections');
  chk('admin: every section of the page is listed, in the page order', await p.evaluate(()=>
    [...document.querySelectorAll('#secList .item')].map(x=>x.dataset.id).join()==='range,qrcore,talk,game'));
  chk('admin: the passcode and message only show once a section is locked', await p.evaluate(()=>
    getComputedStyle(document.querySelector('#secList .item .secpass')).display==='none'));
  await p.selectOption('#secList .item[data-id="qrcore"] .secmode','locked');
  chk('admin: choosing Locked reveals them', await p.evaluate(()=>
    getComputedStyle(document.querySelector('#secList .item[data-id="qrcore"] .secpass')).display!=='none'));
  await p.fill('#secList .item[data-id="qrcore"] .secmsg','Opens at 2pm');
  await saved(p, ()=>p.click('#secList .item[data-id="qrcore"] .secsave'));
  chk('admin: saving posts it', S.sectionRows.find(x=>x.id==='qrcore').mode==='locked'
    && S.sectionRows.find(x=>x.id==='qrcore').message==='Opens at 2pm', S.sectionRows[1]);
  await p.selectOption('#secList .item[data-id="qrcore"] .secmode','show');
  await saved(p, ()=>p.click('#secList .item[data-id="qrcore"] .secsave'));
  chk('admin: and back to Show', S.sectionRows.find(x=>x.id==='qrcore').mode==='show', S.sectionRows[1]);

  await p.click('#tabSegments');
  chk('admin: a segment has the same three states', await p.evaluate(()=>
    [...document.querySelectorAll('#segMode option')].map(o=>o.value).join()==='show,locked,hidden'));
  await p.click('#tabSettings');
  chk('admin: the privacy fields are on the settings tab', await p.evaluate(()=>
    ['privEntity','privEmail','privAddress','privRetention'].every(i=>!!document.getElementById(i))));
  await p.fill('#privEntity','FACERINNA Sdn. Bhd.'); await p.fill('#privEmail','privacy@facerinna.test');
  await p.fill('#privAddress','12 Jalan Contoh'); await p.fill('#privRetention','24 months');
  await saved(p, ()=>p.click('#saveSettings'));
  chk('admin: saving posts them', S.settings.privacy_entity==='FACERINNA Sdn. Bhd.' && S.settings.privacy_retention==='24 months', S.settings);
  chk('admin: no page errors'+(errs.length?': '+errs[0]:''), errs.length===0);
  await c.close();
}

/* ------------------------------------------------------ the privacy page */
{
  const c=await ctx(); const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/privacy.html',{waitUntil:'load'}); await sleep(1200);
  let t=await p.evaluate(()=>document.body.innerText);
  chk('privacy: it names the entity, the address and the contact from the admin',
      /FACERINNA Sdn\. Bhd\./.test(t) && /12 Jalan Contoh/.test(t) && /privacy@facerinna\.test/.test(t), t.slice(0,200));
  chk('privacy: and the retention period', /24 months/.test(t));
  chk('privacy: it says what each form collects', /phone number/i.test(t) && /organisation/i.test(t) && /user-agent/i.test(t));
  chk('privacy: it names the rights and the Act', /Personal Data Protection Act 2010/.test(t) && /delete it/.test(t));
  chk('privacy: it is reachable while the page itself is locked', await p.evaluate(()=>!document.getElementById('boothVeil')));

  /* nothing filled in yet: it must say so rather than read as though nothing applied */
  S.settings.privacy_entity=''; S.settings.privacy_email=''; S.settings.privacy_address=''; S.settings.privacy_retention='';
  await p.evaluate(()=>localStorage.removeItem('fx.booth.config'));
  await p.goto(BASE+'/privacy.html',{waitUntil:'load'}); await sleep(1200);
  t=await p.evaluate(()=>document.body.innerText);
  chk('privacy: an unfilled detail says so in its own place', (t.match(/Not yet stated/g)||[]).length>=4, (t.match(/Not yet stated/g)||[]).length);
  chk('privacy: no page errors'+(errs.length?': '+errs[0]:''), errs.length===0);
  await c.close();
}

{
  const c=await ctx(); const p=await c.newPage();
  await p.goto(BASE+'/index.html',{waitUntil:'load'}); await sleep(600);
  chk('the footer links to the privacy notice', await p.evaluate(()=>!!document.querySelector('footer a[href="privacy.html"]')));
  await c.close();
}

/* ------------------------------ the way into the admin, and the board */
{
  const c=await ctx(); const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  S.settings.page_mode='open'; S.segments=[]; S.sectionRows.forEach(x=>{ x.mode='show'; x.passcode=''; });
  /* Not "is it left of the full-screen button" -- the first cut passed that
     while sitting on top of the Play & Win badge and, on a phone, the partner
     lockup. Ask the real question: does it overlap ANYTHING else up there. */
  const gear = p => p.evaluate(()=>{
    const a=document.getElementById('adminBtn'); if(!a) return null;
    const r=a.getBoundingClientRect();
    const hits=[];
    document.querySelectorAll('header.nav a, header.nav button, header.nav img').forEach(function(el){
      if(el===a || a.contains(el) || el.contains(a)) return;
      const s=getComputedStyle(el); if(s.display==='none'||s.visibility==='hidden') return;
      const b=el.getBoundingClientRect(); if(!b.width||!b.height) return;
      if(r.left<b.right && b.left<r.right && r.top<b.bottom && b.top<r.bottom)
        hits.push((el.id||el.className||el.tagName)+'');
    });
    return { href:a.getAttribute('href'), inNav:!!a.closest('.nav-links'),
             shown:getComputedStyle(a).display!=='none' && r.width>0,
             onScreen:r.left>=-1 && r.right<=innerWidth+1, hits:hits,
             footer:!!document.querySelector('footer a[href="admin.html"]') };
  });

  /* on a desk the bar shows it; on a phone the bar hands its links to the
     burger, and the gear goes with them */
  let g;
  /* 1460 is the tightest the bar ever is: the width at which the links stop
     handing over to the burger, so every link is in it with nothing to spare */
  for(const w of [1460, 1560, 1800]){
    await p.setViewportSize({width:w,height:844});
    await p.goto(BASE+'/index.html',{waitUntil:'load'}); await sleep(900);
    g=await gear(p);
    chk(`${w}: a gear in the header goes to the admin`, g && g.href==='admin.html' && g.shown && g.inNav, g);
    chk(`${w}: it is on top of nothing else in the header`, g.hits.length===0, g.hits);
    chk(`${w}: and stays on the screen`, g.onScreen, g);
  }
  /* in the bar it is the icon alone; the word only appears in the dropdown */
  await p.setViewportSize({width:1560,height:844});
  await p.goto(BASE+'/index.html',{waitUntil:'load'}); await sleep(900);
  g=await gear(p);
  chk('1560: it is the icon alone, no word', await p.evaluate(()=>
    getComputedStyle(document.querySelector('#adminBtn .nav-admin-t')).display==='none'));
  chk('1560: the footer no longer carries a second one', g.footer===false);

  /* Narrower than that -- a phone, and a 1280 laptop too, now that the
     breakpoint sits where the row actually fits -- the links are behind the
     burger and the gear goes with them. */
  for(const w of [390, 1280]){
    await p.setViewportSize({width:w,height:844});
    await p.goto(BASE+'/index.html',{waitUntil:'load'}); await sleep(900);
    chk(`${w}: the links are behind the burger, the gear with them`, await p.evaluate(()=>
      getComputedStyle(document.querySelector('.nav-links')).display==='none'));
    await p.click('#burger'); await sleep(400);
    g=await gear(p);
    chk(`${w}: opening the menu shows it`, g && g.shown && g.onScreen, g);
    chk(`${w}: it is on top of nothing else`, g.hits.length===0, g.hits);
    chk(`${w}: and it says Admin there, where an icon alone would not do`, await p.evaluate(()=>
      getComputedStyle(document.querySelector('#adminBtn .nav-admin-t')).display!=='none'
      && /Admin/.test(document.getElementById('adminBtn').innerText)));
  }
  /* the row that used to run under the corner button does not any more */
  for(const w of [1061, 1280, 1460, 1560]){
    await p.setViewportSize({width:w,height:844});
    await p.goto(BASE+'/index.html',{waitUntil:'load'}); await sleep(700);
    const clash=await p.evaluate(()=>{
      const bad=[]; const els=[...document.querySelectorAll('header.nav a, header.nav button, header.nav img')]
        .filter(e=>{ const s=getComputedStyle(e); const b=e.getBoundingClientRect();
          return s.display!=='none' && s.visibility!=='hidden' && b.width>0 && b.height>0; });
      for(let i=0;i<els.length;i++) for(let j=i+1;j<els.length;j++){
        const a=els[i], b=els[j]; if(a.contains(b)||b.contains(a)) continue;
        const x=a.getBoundingClientRect(), y=b.getBoundingClientRect();
        if(x.left<y.right && y.left<x.right && x.top<y.bottom && y.top<x.bottom)
          bad.push((a.id||a.className)+' / '+(b.id||b.className));
      }
      const lockup=document.querySelector('.nav-lockup').getBoundingClientRect();
      return { bad, lockupOnScreen: lockup.left>=-1 };
    });
    chk(`${w}: nothing in the header sits on anything else`, clash.bad.length===0, clash.bad);
    chk(`${w}: and the brand is not pushed off the left edge`, clash.lockupOnScreen, clash);
  }
  await p.click('#adminBtn');
  await p.waitForURL(/admin\.html$/,{timeout:10000}).catch(()=>{});
  chk('the gear opens the admin in the same tab', /admin\.html$/.test(p.url()) && c.pages().length===1, p.url());
  chk('...with a way back for anyone who tapped it by mistake',
      await p.evaluate(()=>!!document.querySelector('#viewLogin a[href="index.html"]')));
  chk('no page errors'+(errs.length?': '+errs[0]:''), errs.length===0);
  await c.close();
}

/* --------------------------- the ranking board goes with the games ----
   The board is a sibling of the games section, so nothing that hides the
   section hides it. The control matters as much as the check: if arriving
   at an open games section did not open the board, "it did not open" would
   pass for the wrong reason. */
{
  const c=await ctx(); const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  const board = p => p.evaluate(()=>document.getElementById('rankModal').classList.contains('open'));
  const arrive = async p => { await p.evaluate(()=>{ document.documentElement.style.scrollBehavior='auto';
    document.getElementById('game').scrollIntoView({block:'start'}); }); };

  S.sectionRows.find(x=>x.id==='game').mode='show';
  await p.goto(BASE+'/index.html',{waitUntil:'load'}); await sleep(1200);
  await arrive(p);
  chk('board: arriving at the games opens the ranking by itself', await until(()=>board(p), 6000));

  S.sectionRows.find(x=>x.id==='game').mode='locked';
  await p.goto(BASE+'/index.html',{waitUntil:'load'}); await sleep(1400);
  await arrive(p); await sleep(3000);
  chk('board: with the games locked it stays shut', (await board(p))===false);
  chk('board: and the ranking button went with the section',
      await p.evaluate(()=>{ const b=document.getElementById('rankBtn');
        return !b || !b.getBoundingClientRect().width; }));

  /* it must also close one that was already open when the lock arrives */
  S.sectionRows.find(x=>x.id==='game').mode='show';
  await p.goto(BASE+'/index.html',{waitUntil:'load'}); await sleep(1200);
  await arrive(p);
  await until(()=>board(p), 6000);
  S.sectionRows.find(x=>x.id==='game').mode='locked';
  await p.evaluate(()=>{ window.__boothApply({settings:{page_mode:'open',welcome:'show'}, segments:[],
    section_states:[{id:'game',label:'Games',mode:'locked',message:''}]}, false); });
  chk('board: a lock arriving while it is open shuts it', await until(async()=>(await board(p))===false, 4000));

  S.sectionRows.find(x=>x.id==='game').mode='show';
  chk('board: no page errors'+(errs.length?': '+errs[0]:''), errs.length===0);
  await c.close();
}

await b.close(); await new Promise(r=>srv.close(r));
console.log(bad? '\nSOMETHING IS WRONG' : '\nthe sheet runs the page, section by section');
process.exit(bad?1:0);
