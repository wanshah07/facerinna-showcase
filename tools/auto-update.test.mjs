/* Does a booth screen that is left open pick up a new version by itself?
   That is the whole question behind "must everyone clear their cache", and
   it cannot be answered by reading the code: it needs a real worker, a real
   second publish, and a page that never navigates in between.

   The server here serves the repo but can swap what index.html says, so a
   publish can happen while the page is open -- which is exactly the booth's
   situation and exactly what no other suite covers. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8131, BASE='http://127.0.0.1:'+PORT;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, ms=15000, step=120){ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(step);} return fn(); }
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.webmanifest':'application/manifest+json',
  '.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};

const over={};                       /* path -> what to serve instead */
const srv=http.createServer((req,res)=>{
  let f=decodeURIComponent(new URL(req.url,BASE).pathname);
  if(f.endsWith('/')) f+='index.html';
  const body = over[f] !== undefined ? Buffer.from(over[f])
    : (fs.existsSync(path.join(ROOT,f)) && fs.statSync(path.join(ROOT,f)).isFile()
        ? fs.readFileSync(path.join(ROOT,f)) : null);
  if(!body){ res.writeHead(404); res.end(); return; }
  /* A service worker script is revalidated by the browser anyway; no-store on
     everything keeps the HTTP cache out of what is being measured here. */
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});
  res.end(body);
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));

const page1=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const sw1=fs.readFileSync(path.join(ROOT,'sw.js'),'utf8');
const V1=(sw1.match(/const VERSION = '([^']+)'/)||[])[1];
if(!V1) throw new Error('no VERSION in sw.js');
const mark='FACERINNA SECOND EDITION';
const page2=page1.replace('<title>', '<title>'+mark+' ');
if(page2===page1) throw new Error('could not mark the second edition');
const sw2=sw1.replace(V1, V1+'-next');

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const c=await b.newContext({viewport:{width:1280,height:900}});
/* the booth page is the only one wired to the admin script; nothing here
   should reach out to it */
await c.addInitScript(()=>{ window.__BOOTH_API=''; });
const p=await c.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
/* Both of these are read while the page may be part-way through the reload
   they are waiting for, and a context that is being torn down throws rather
   than answering. An empty answer means "not yet", which is what the polling
   wants anyway. */
const edition = async () => { try { return await p.title(); } catch(e){ return ''; } };
const controlled = async () => { try { return await p.evaluate(()=>!!navigator.serviceWorker.controller); } catch(e){ return false; } };

/* ---- first visit ---- */
await p.goto(BASE+'/index.html',{waitUntil:'load'});
await p.evaluate(()=>navigator.serviceWorker.ready);
chk('the worker takes control of the page', await until(controlled));
chk('the first edition is on screen', !(await edition()).includes(mark), await edition());
chk('the page asks the worker to look again on a timer, so a screen that never navigates still checks',
    await p.evaluate(()=>typeof window.__fxReloadWhenIdle === 'function'));
/* the shipped rule is a full minute untouched; the test shortens it below to
   exercise the same code without waiting one out, so the default is worth
   pinning here where a shortened copy could not hide it */
chk('the shipped idle rule is a full minute, not something a test left behind',
    /var IDLE_MS = 60000;/.test(fs.readFileSync(path.join(ROOT,'index.html'),'utf8')));

/* ---- a new version is published while the page is open ---- */
over['/index.html']=page2; over['/sw.js']=sw2;
await p.evaluate(()=>navigator.serviceWorker.getRegistration().then(r=>r.update()));

/* ---- it must NOT reload while somebody is using the screen ---- */
await until(()=>p.evaluate(()=>!!navigator.serviceWorker.controller), 15000);
await p.mouse.move(400,400); await p.mouse.down(); await p.mouse.up();   /* a hand on it */
await sleep(2500);
chk('a screen being touched is not reloaded under the hand', !(await edition()).includes(mark), await edition());

/* ---- idle, it takes the new one by itself ---- */
/* Nothing here calls the page's reload for it. The worker's own message,
   sent when the new version took over, is what started this; the page put
   the reload off because a hand was on the screen and is checking back on
   its own timer. All the test does is stop the clock being a minute. */
await p.evaluate(()=>{ window.__fxIdleMs = 250; });
chk('...and reloads itself once the screen goes idle, with nothing asking it to',
    await until(async()=>(await edition()).includes(mark), 25000), await edition());
chk('the new edition is what the worker now serves', (await edition()).includes(mark));
chk('and it is still served through a worker, not around one', await until(controlled));

/* ---- offline, the new copy is what it holds ---- */
await new Promise(r=>srv.close(r));
await p.goto(BASE+'/index.html',{waitUntil:'load'}).catch(()=>{});
chk('with the server gone it opens the NEW edition from its own cache, not the old one',
    (await edition()).includes(mark), await edition());

chk('no page errors'+(errs.length?': '+errs[0]:''), errs.length===0);
await c.close(); await b.close();
console.log(bad? '\nSOMETHING IS WRONG' : '\na screen left open takes the update by itself, when no hand is on it');
process.exit(bad?1:0);
