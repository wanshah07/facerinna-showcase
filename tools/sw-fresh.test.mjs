/* A page that was just published must be the page the phone shows on the
   very next load -- not the one after. And a connection that is up but
   stalled must not hold the booth hostage: the stored copy takes over
   after the worker's timeout.

   The server is in-process so the test can change what a URL says between
   two loads, and make the server hang, without touching the repository. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const PORT=8124, BASE=`http://127.0.0.1:${PORT}`, ROOT='/workspace/facerinna-showcase';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json',
  '.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};

/* mode 'ok' serves the file; 'hang' accepts the connection and never answers;
   override[path] replaces a file's bytes */
const S={mode:'ok', override:{}, hung:[]};
const srv=http.createServer((req,res)=>{
  const u=new URL(req.url,BASE); let p=decodeURIComponent(u.pathname);
  if(p.endsWith('/')) p+='index.html';
  if(S.mode==='hang'){ S.hung.push(res); return; }          // never answers
  const body=S.override[p]!==undefined ? Buffer.from(S.override[p]) :
    (fs.existsSync(path.join(ROOT,p)) && fs.statSync(path.join(ROOT,p)).isFile() ? fs.readFileSync(path.join(ROOT,p)) : null);
  if(!body){ res.writeHead(404,{'Content-Type':'text/plain'}); res.end('not here'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(p)]||'application/octet-stream','Cache-Control':'no-store'});
  res.end(body);
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const page1=fs.readFileSync(path.join(ROOT,'uv-card.html'),'utf8');
const v2=page1.replace('<title>Facerinna — UV Card</title>','<title>Facerinna — UV Card — SECOND EDITION</title>');
if(v2===page1) throw new Error('could not mark the second edition');

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const p=await c.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
const title=()=>p.evaluate(()=>document.title);
const timed=async fn=>{ const t=Date.now(); const r=await fn(); return {r, ms:Date.now()-t}; };

/* first visit: install the worker, let it take control, let it finish precaching */
await p.goto(BASE+'/uv-card.html',{waitUntil:'load'});
await p.evaluate(()=>navigator.serviceWorker.ready);
await p.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:10000}).catch(()=>{});
chk('the worker takes control', await p.evaluate(()=>!!navigator.serviceWorker.controller));
await p.waitForFunction(async()=>{ const ks=await caches.keys(); if(!ks.length) return false;
  const c=await caches.open(ks[0]); return (await c.keys()).length>=15; },null,{timeout:90000}).catch(()=>{});
chk('first edition on screen', /UV Card$/.test(await title()), await title());

/* the site is updated between two loads */
S.override['/uv-card.html']=v2;
let t=await timed(()=>p.goto(BASE+'/uv-card.html',{waitUntil:'load'}));
chk('the very next load shows the new edition ('+t.ms+'ms)', /SECOND EDITION/.test(await title()), await title());
chk('...and it is served through the worker, not around it', await p.evaluate(()=>!!navigator.serviceWorker.controller));

/* the connection stalls: accepted, never answered */
S.mode='hang';
t=await timed(()=>p.goto(BASE+'/uv-card.html',{waitUntil:'load'}));
chk('a stalled connection falls back to the stored copy', /SECOND EDITION/.test(await title()), await title());
chk('...within the worker\'s timeout, not the browser\'s ('+t.ms+'ms)', t.ms<6000, t.ms);
chk('...and the stored copy is the newest one seen, not the first', /SECOND EDITION/.test(await title()));
for(const r of S.hung.splice(0)) r.destroy();

/* the connection is dead: refused outright */
await new Promise(r=>srv.close(r));
t=await timed(()=>p.goto(BASE+'/uv-card.html',{waitUntil:'load'}).catch(()=>null));
chk('a dead connection falls back to the stored copy at once ('+t.ms+'ms)', /SECOND EDITION/.test(await title()) && t.ms<3000, {title:await title(), ms:t.ms});
await p.goto(BASE+'/never-here.html',{waitUntil:'load'}).catch(()=>{});
chk('an unvisited page on a dead connection says why', /No connection/.test(await p.evaluate(()=>document.body?document.body.innerText:'')));

chk('no page errors'+(errs.length?': '+errs[0]:''), errs.length===0);
await c.close(); await b.close();
console.log(bad? '\nSOMETHING IS WRONG' : '\npages arrive on the next load, and the cache still catches a fall');
process.exit(bad?1:0);
