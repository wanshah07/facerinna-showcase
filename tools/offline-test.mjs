/* The offline claim is only worth anything if the test can tell the network
   apart from the cache. Playwright's setOffline does not reach a service
   worker's own fetches, so "offline" here means the web server is actually
   dead -- and a control run without the worker proves the difference shows. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import {spawn} from 'node:child_process';
import net from 'node:net';
const {chromium}=pkg;
const PORT=8123, BASE=`http://127.0.0.1:${PORT}`, ROOT='/workspace/facerinna-showcase';
let bad=0; const chk=(l,ok)=>{ if(!ok) bad++; console.log((ok?'  PASS  ':'  FAIL  ')+l); };

let srv=null;
const up=()=>new Promise(r=>{const s=net.connect(PORT,'127.0.0.1');
  s.on('connect',()=>{s.end();r(true)}); s.on('error',()=>r(false));});
async function serve(){
  srv=spawn('node',['/opt/node22/lib/node_modules/http-server/bin/http-server','-p',String(PORT),'-c-1','--silent','.'],
            {cwd:ROOT, stdio:'ignore'});
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

await b.close(); await stop();
console.log(bad? '\nSOMETHING IS WRONG' : '\nthe booth works with the wifi off');
process.exit(bad?1:0);
