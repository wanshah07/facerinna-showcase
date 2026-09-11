/* The offline claim is only worth anything if the test can tell the network
   apart from the cache. Playwright's setOffline does not reach a service
   worker's own fetches, so "offline" here means the web server is actually
   dead -- and a control run without the worker proves the difference shows. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
const {chromium}=pkg;
const PORT=8123, BASE=`http://127.0.0.1:${PORT}`, ROOT='/workspace/facerinna-showcase';
let bad=0; const chk=(l,ok)=>{ if(!ok) bad++; console.log((ok?'  PASS  ':'  FAIL  ')+l); };

let srv=null;
const up=()=>new Promise(r=>{const s=net.connect(PORT,'127.0.0.1');
  s.on('connect',()=>{s.end();r(true)}); s.on('error',()=>r(false));});
async function serve(dir){
  srv=spawn('node',['/opt/node22/lib/node_modules/http-server/bin/http-server','-p',String(PORT),
                    '-c-1','-d','false','--silent','.'],
            {cwd:dir||ROOT, stdio:'ignore'});
  for(let i=0;i<60;i++){ if(await up()) return; await new Promise(r=>setTimeout(r,150)); }
  throw new Error('server never came up');
}
async function stop(){
  if(!srv) return; srv.kill('SIGKILL'); srv=null;
  for(let i=0;i<40;i++){ if(!(await up())) return; await new Promise(r=>setTimeout(r,100)); }
  throw new Error('server would not die');
}
const opened = async p => p.evaluate(()=>{
  const t=document.title||''; const h=document.body?document.body.scrollHeight:0;
  return /PDM AGM/.test(t) && h>2000;
});

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});

/* ---- control: no worker, so the dead server must show ---- */
await serve();
{
  const c=await b.newContext(); const p=await c.newPage();
  await p.route('**/sw.js', r=>r.abort());        // the one thing withheld
  await p.goto(BASE+'/',{waitUntil:'load'});
  chk('control: the page loads while the server is up', await opened(p));
  await stop();
  const r=await p.goto(BASE+'/',{waitUntil:'load'}).catch(()=>null);
  chk('control: with no worker and no server, it does NOT load', !(r && await opened(p)));
  await c.close();
}

/* ---- the real thing ---- */
await serve();
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const p=await c.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(BASE+'/',{waitUntil:'load'});
await p.evaluate(()=>navigator.serviceWorker.ready);
chk('the worker activates', true);
/* clients.claim() resolves a tick or two after ready, so wait for it rather
   than read it once and call the race a result. */
await p.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:10000}).catch(()=>{});
chk('it takes control without a reload', await p.evaluate(()=>!!navigator.serviceWorker.controller));
await p.waitForFunction(async()=>{
  const ks=await caches.keys(); if(!ks.length) return false;
  const c=await caches.open(ks[0]); return (await c.keys()).length>=15;
},null,{timeout:90000}).catch(()=>{});
const cache=await p.evaluate(async()=>{const ks=await caches.keys();const c=await caches.open(ks[0]);
  return {name:ks[0], urls:(await c.keys()).map(r=>new URL(r.url).pathname)};});
console.log(`  cache "${cache.name}" holds ${cache.urls.length} entries`);
for(const need of ['/','/index.html','/deep-lab.html','/lab-run.html','/match-lab.html','/pack-match.html',
                   '/shelf-shot.html','/fx-rank.js','/events/index.html',
                   '/facerinna-test-reports-claims/index.html','/icon-512.png'])
  chk('cached '+need, cache.urls.includes(need));

await stop();                                     /* the hall wifi goes down */

await p.goto(BASE+'/',{waitUntil:'load'});
chk('offline: the home page still opens', await opened(p));
const qr=await p.evaluate(()=>({n:document.querySelectorAll('#qrcore .qr-card').length,
  imgs:[...document.querySelectorAll('#qrcore .qr-slot img')].every(i=>i.naturalWidth>0)}));
chk('offline: all three QR cards are there', qr.n===3);
chk('offline: their images render', qr.imgs);
for(const path of ['/deep-lab.html','/pack-match.html','/shelf-shot.html','/events/index.html',
                   '/facerinna-test-reports-claims/']){
  await p.goto(BASE+path,{waitUntil:'load'}).catch(()=>{});
  const ok=await p.evaluate(()=>document.body&&document.body.scrollHeight>200);
  chk('offline: '+path+' opens', !!ok);
}
await p.goto(BASE+'/never-visited-page.html',{waitUntil:'load'}).catch(()=>{});
const miss=await p.evaluate(()=>document.body?document.body.innerText:'');
chk('offline: an unvisited page says why', /No connection/.test(miss));
chk('offline: and is not quietly the home page', !/PDM AGM/.test(miss));
chk('no page errors'+(errs.length?': '+errs[0]:''), errs.length===0);

/* --- a new worker that cannot reach the network must not take the old copy
   with it. This is the dangerous case: the site updates, the phone is on a
   dead hall wifi, every precache fetch fails, and if activate purged anyway
   the visitor would be left with neither the new copy nor the one that was
   working a second ago. sw.js is answered from here with a new cache name;
   everything else stays unreachable, because the server is still dead. --- */
/* A worker's own fetches do not go through Playwright's routing, so this is
   staged for real: a second server on the same origin that hands back a
   bumped sw.js and 404s absolutely everything else. From inside the worker
   that is indistinguishable from an update it cannot download. */
const tmp = fs.mkdtempSync('/tmp/fx-sw-');
fs.writeFileSync(tmp+'/sw.js', fs.readFileSync(ROOT+'/sw.js','utf8')
  .replace(/const VERSION = '[^']+'/, "const VERSION = 'facerinna-test-bump'"));
await serve(tmp);
await p.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  if (r) { try { await r.update(); } catch (e) {} }
});
/* Wait for the new worker to have actually got as far as opening its own
   cache, rather than sleeping a fixed three seconds and hoping. A run that
   sleeps is a run that fails once a week for no reason anybody can find. */
await p.waitForFunction(async () =>
  (await caches.keys()).includes('facerinna-test-bump'), null, {timeout:15000})
  .catch(() => {});
const keys = await p.evaluate(() => caches.keys());
chk('the new worker did try to install', keys.includes('facerinna-test-bump'), keys);
chk('the working copy survives an update that could not download',
    keys.some(k => k !== 'facerinna-test-bump'), keys);
await stop();                       /* the decoy goes away too */
await p.goto(BASE+'/',{waitUntil:'load'}).catch(()=>{});
chk('and the page still opens with the network down', await opened(p));
fs.rmSync(tmp, {recursive:true, force:true});

await b.close(); await stop();
console.log(bad? '\nSOMETHING IS WRONG' : '\nthe booth works with the wifi off');
process.exit(bad?1:0);
