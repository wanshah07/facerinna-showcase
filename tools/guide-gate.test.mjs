/* The question mark beside the games.

   What is under test is the gate, not the prose: the guide text is not in
   the page file, a browser with no admin session never receives it, a
   session the script no longer honours gets sent back to sign in, and a
   signed-in browser gets the blocks drawn -- as elements, with a *starred*
   word arriving as <b> and a block that tries to be markup arriving as
   text. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8141, BASE='http://127.0.0.1:'+PORT, API=BASE+'/api';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, ms=8000, step=100){ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(step);} return fn(); }
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript'};

const TOKEN='11111111-1111-4111-8111-111111111111';
const SECRET='the counter routine nobody outside the booth should read';
const BLOCKS=[
  {t:'note', s:'You can read this because this device is signed in as an admin.'},
  {t:'h', s:'At the counter'},
  {t:'p', s:SECRET+' with a *bold* word -- and a dash'},
  {t:'ol', items:['first thing','second thing']},
  {t:'ul', items:['a point','another']},
  {t:'table', head:['Column','What it holds'], rows:[['claim','the code inside the QR'],['by','which admin scanned it']]},
  {t:'p', s:'<img src=x onerror="window.__pwned=1">'}
];
const S={seen:[]};
const srv=http.createServer((req,res)=>{
  const u=new URL(req.url,BASE);
  if(u.pathname==='/api'){
    let raw=''; req.on('data',c=>raw+=c); req.on('end',()=>{
      let b={}; try{ b=JSON.parse(raw||'{}'); }catch(e){}
      S.seen.push(b);
      let out={ok:false,error:'unknown action'};
      if(b.action==='config') out={ok:true, settings:{}, segments:[], sections:[]};
      else if(b.action==='admin.guide'){
        out = b.token===TOKEN
          ? {ok:true, you:'owner@facerinna.test', title:'Running the booth', blocks:BLOCKS}
          : {ok:false, error:'signed out'};
      }
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(out)); });
    return;
  }
  let f=decodeURIComponent(u.pathname); if(f.endsWith('/')) f+='index.html';
  if(f==='/sw.js'){ res.writeHead(404); res.end(); return; }
  const fp=path.join(ROOT,f);
  if(!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'}); res.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));

console.log('the page file itself');
{
  const src=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  chk('carries the question mark', /id="guideBtn"/.test(src));
  chk('...and an empty panel for it', /id="guideBody"><\/div>/.test(src));
  chk('but not a line of the guide: nothing a visitor could read from the source',
      !/At the counter/.test(src) && !/Gift QR code is on/.test(src) && !/one gift per device/i.test(src));
}

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
async function open_(tok, opts){
  const c=await b.newContext(Object.assign({viewport:{width:1280,height:900}}, opts||{}));
  await c.addInitScript(([a,t])=>{ window.__BOOTH_API=a; try{ if(t) localStorage.setItem('fx.admin.token',t); }catch(e){} }, [API, tok||'']);
  const p=await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/index.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(400);
  return {c,p,errs};
}
const openPanel=p=>p.evaluate(()=>{ document.getElementById('guideBtn').click(); });
const panelText=p=>p.evaluate(()=>document.getElementById('guideBody').innerText);
const isOpen=p=>p.evaluate(()=>document.getElementById('guideModal').classList.contains('open'));

console.log('\na visitor');
{
  S.seen=[];
  const {c,p,errs}=await open_('');
  const shown=await p.evaluate(()=>{ const b=document.getElementById('guideBtn');
    const r=b.getBoundingClientRect(); return { w:Math.round(r.width), h:Math.round(r.height), txt:b.textContent.trim() }; });
  chk('sees the question mark, at a size a finger can hit', shown.w>=26 && shown.h>=26 && shown.txt==='?', shown);
  await openPanel(p);
  chk('the panel opens', await until(()=>isOpen(p)));
  chk('...and says the guide is for booth staff', /booth staff/i.test(await panelText(p)));
  chk('...with a way to sign in', await p.$eval('#guideBody a', a=>a.getAttribute('href'))==='admin.html');
  await p.waitForTimeout(400);
  chk('the script was never asked for the guide', S.seen.filter(x=>x.action==='admin.guide').length===0, S.seen.map(x=>x.action));
  chk('and not one word of it is anywhere in the page',
      !(await p.evaluate(s=>document.documentElement.innerHTML.indexOf(s)>=0, SECRET)));
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\na sign-in the script no longer honours');
{
  S.seen=[];
  const {c,p,errs}=await open_('stale-token');
  await openPanel(p);
  chk('is sent back to sign in', await until(async()=>/sign in again|expired/i.test(await panelText(p))));
  chk('...and still gets no guide', !/At the counter/.test(await panelText(p)));
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\na signed-in admin');
{
  S.seen=[];
  const {c,p,errs}=await open_(TOKEN);
  await openPanel(p);
  chk('gets the guide', await until(async()=>/At the counter/.test(await panelText(p))));
  chk('...sent the token, and nothing else', (()=>{ const g=S.seen.filter(x=>x.action==='admin.guide');
    return g.length===1 && g[0].token===TOKEN && Object.keys(g[0]).length===2; })(), S.seen.filter(x=>x.action==='admin.guide'));
  chk('...named for who is reading it', /owner@facerinna\.test/.test(await panelText(p)));
  const shape=await p.evaluate(()=>{ const b=document.getElementById('guideBody');
    return { h4:b.querySelectorAll('h4').length, ol:b.querySelectorAll('ol li').length, ul:b.querySelectorAll('ul li').length,
             th:b.querySelectorAll('th').length, td:b.querySelectorAll('td').length, bold:[].map.call(b.querySelectorAll('b'),n=>n.textContent) }; });
  chk('...drawn as headings, lists and a table, not as a wall of text',
      shape.h4===1 && shape.ol===2 && shape.ul===2 && shape.th===2 && shape.td===4, shape);
  chk('...with the starred word bold and the stars gone',
      shape.bold.indexOf('bold')>=0 && !/\*/.test(await panelText(p)), shape.bold);
  chk('the dash the script spells as two hyphens is drawn as one',
      await p.evaluate(()=>{ const t=document.getElementById('guideBody').innerText;
        return t.indexOf('\u2014')>=0 && !/ -- /.test(t); }));
  chk('a block that tries to be markup lands as text', await p.evaluate(()=>
      !window.__pwned && !document.querySelector('#guideBody img') && /onerror/.test(document.getElementById('guideBody').innerText)));
  chk('asking twice does not ask the script twice', await (async()=>{
      await p.evaluate(()=>window.__guide.close()); await openPanel(p); await sleep(400);
      return S.seen.filter(x=>x.action==='admin.guide').length===1; })(), S.seen.filter(x=>x.action==='admin.guide').length);
  chk('Escape closes it', await (async()=>{ await p.keyboard.press('Escape'); return !(await isOpen(p)); })());
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\non a phone');
{
  const {c,p,errs}=await open_(TOKEN,{viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await openPanel(p);
  await until(async()=>/At the counter/.test(await panelText(p)));
  const fit=await p.evaluate(()=>{ const pn=document.querySelector('#guideModal .cpanel'), r=pn.getBoundingClientRect();
    return { over:Math.max(0, Math.round(r.right - window.innerWidth)), wide:pn.scrollWidth>pn.clientWidth+1,
             doc:document.documentElement.scrollWidth>window.innerWidth+1 }; });
  chk('the panel stays inside the screen, and the table scrolls rather than stretching it',
      fit.over===0 && !fit.wide && !fit.doc, fit);
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

await b.close(); await new Promise(r=>srv.close(r));
console.log(bad? '\nSOMETHING IS WRONG' : '\nthe guide is behind the sign-in, and nowhere in the file');
process.exit(bad?1:0);
