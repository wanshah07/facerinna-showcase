/* A hundred counter phones scanning a hundred gift codes in the same instant.

   The real scan page, the real booth-admin script (Google stubbed), and between
   them a stand-in for Google's servers that behaves the way Apps Script does
   under a crowd:

     - about thirty copies of the script run at once; a request past that gets an
       error page, not an answer
     - every gift is spent under the one script lock, one at a time; a request
       that waited ten seconds for its turn is told "busy, try again" (the
       script's own answer)
     - reading a tab and writing to it take time -- 120ms a read, 60ms a write,
       150ms to flush -- so the lock is held for as long as the script's own
       sheet work would hold it
     - some answers are lost on the way back (LOSE), as a phone on hall wifi loses
       them: the script has spent the code, the phone never hears

   What has to hold: every phone ends on the wheel's answer (none on an error,
   none told "already redeemed" for a code it spent itself), each code is spent
   exactly once, the stock goes down by exactly a hundred, every phone's wheel
   lands on the product the script wrote, and nothing is written under the lock
   without being flushed before the lock is let go.

     node tools/counter-load.test.mjs              100 phones
     node tools/counter-load.test.mjs 30           fewer, for a quick look  */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { load, OWNER } from './booth-admin-harness.mjs';
const {chromium}=pkg;
const N = +(process.argv.slice(2).find(a=>/^\d+$/.test(a)) || 100);
const ROOT='/workspace/facerinna-showcase', PORT=8350+Math.floor(Math.random()*40), BASE='http://127.0.0.1:'+PORT, API=BASE+'/api';
const MAX_EXEC=30, LOCK_WAIT=10000, READ=120, WRITE=60, FLUSH=150, AUTH=350, LOSE=0.05;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++; console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* ---- the booth: gifts on, a wheel with stock for everyone, N claims ---- */
const H = load();
const own = H.signIn(OWNER);
const A = o => H.call({ token:own.token, ...o });
const PRODUCTS = ['Niacinamide Serum','Salicylic Serum','Ceramide Moisturizer','Centella Gel','B5 Cleanser','B5 Toner','TXA Spot Serum','Barrier Cream'];
/* setUp seeds the wheel with the product list, "not counted"; this booth counts every box */
H.tabs['Gift stock'].rows.slice(1).map(r=>r[0]).filter(Boolean).forEach(p=>A({ action:'admin.stock.remove', product:p }));
PRODUCTS.forEach(p=>A({ action:'admin.stock.set', product:p, quantity:40 }));
A({ action:'admin.settings', settings:{ gift_active:'yes', gift_points:'facy-run = 100' } });
const claims=[];
for(let i=0;i<N;i++){ const r=H.call({ action:'gift.claim', device:'counterload'+String(i).padStart(4,'0'), score:5000+i, game:'facy-run', name:'V'+i }); claims.push(r.claim); }
chk(`${N} gift codes issued, each one distinct`, new Set(claims).size===N && claims.every(Boolean), claims.filter(c=>!c).length);
const stockBefore = H.tabs['Gift stock'].rows.slice(1).reduce((a,r)=>a+(+r[1]||0),0);

/* ---- a stand-in for Google's servers ---------------------------------- */
let running=0, lockBusy=false, spends=0; const lockQ=[];
const stats={ requests:0, tooMany:0, busy:0, lost:0, ok:0, maxQueue:0 };
const takeLock=()=>new Promise(res=>{
  if(!lockBusy){ lockBusy=true; return res(true); }
  const w={ res, t:setTimeout(()=>{ const i=lockQ.indexOf(w); if(i>=0) lockQ.splice(i,1); res(false); }, LOCK_WAIT) };
  lockQ.push(w); stats.maxQueue=Math.max(stats.maxQueue, lockQ.length);
});
const giveLock=()=>{ const w=lockQ.shift(); if(w){ clearTimeout(w.t); w.res(true); } else lockBusy=false; };
/* what the script's own sheet work would cost, counted while it runs */
/* (the gift and stock tabs are read once each per spend) */
const cost=fn=>{ const w0=H.SHEETS.writes, f0=H.SHEETS.flushes;
  const out=fn(); return { out, ms: 2*READ + (H.SHEETS.writes-w0)*WRITE + (H.SHEETS.flushes-f0)*FLUSH }; };

const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.webmanifest':'application/manifest+json'};
const srv=http.createServer((req,res)=>{
  const u=new URL(req.url,BASE);
  if(u.pathname==='/api'){
    let body=''; req.on('data',c=>body+=c); req.on('end', async()=>{
      stats.requests++;
      const send=(code,txt,type)=>{ res.writeHead(code,{'Content-Type':type||'application/json','Access-Control-Allow-Origin':'*'}); res.end(txt); };
      if(running>=MAX_EXEC){ stats.tooMany++; return send(429,'<html><body>Service invoked too many times for one user per second.</body></html>','text/html'); }
      running++;
      try{
        const b=JSON.parse(body||'{}');
        await sleep(AUTH);                                    /* reading the Admins and sessions tabs */
        if(b.action!=='admin.gift.redeem'){ const r=H.call(b); return send(200, JSON.stringify(r)); }
        if(!await takeLock()){ stats.busy++; return send(200, JSON.stringify({ ok:false, error:'busy, try again' })); }
        let r, ms;
        try{ ({ out:r, ms }=cost(()=>H.call(b))); await sleep(ms); }
        finally{ giveLock(); }
        /* the 3rd and 7th spends always lose their answer, and 5% of the rest by chance */
        if(r && r.ok && !r.already && !r.again && (++spends===3 || spends===7 || Math.random()<LOSE)){ stats.lost++; req.socket.destroy(); return; }
        if(r && r.ok) stats.ok++;
        send(200, JSON.stringify(r));
      } finally { running--; }
    }); return;
  }
  let f=decodeURIComponent(u.pathname); if(f.endsWith('/')) f+='index.html';
  const fp=path.join(ROOT,f);
  if(f==='/sw.js'||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));

/* ---- N counter phones ---------------------------------------------------- */
console.log(`\n${N} counter phones scan ${N} codes at the same instant`);
const b=await chromium.launch({ args:['--disable-gpu','--renderer-process-limit=40'] });
const pages=[], errs=[];
for(let i=0;i<N;i++){
  const c=await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:1 });
  await c.addInitScript(a=>{ window.__BOOTH_API=a; }, API);
  await c.route(u=>!u.href.startsWith(BASE), r=>r.abort());
  const p=await c.newPage(); p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/scan.html',{waitUntil:'load'});
  /* signed in after load, so the camera never starts: this is about the script */
  await p.evaluate(t=>localStorage.setItem('fx.admin.token',t), own.token);
  pages.push(p);
}
const t0=Date.now();
await Promise.all(pages.map((p,i)=>p.evaluate(u=>window.__scan.handle(u), 'https://my.facerinna.com/redeem.html?c='+claims[i])));
const ends=await Promise.all(pages.map(async(p,i)=>{
  const deadline=Date.now()+240000; let sawWheel=false, sawWaiting=false;
  while(Date.now()<deadline){
    const s=await p.evaluate(()=>({ stage:window.__scan.state().stage, tries:window.__scan.state().tries, landed:window.__scan.landed(),
      wheel:!document.getElementById('wheelWrap').classList.contains('hidden'), lead:document.getElementById('lead').textContent,
      prize:document.getElementById('prize').textContent, title:document.getElementById('resTitle').textContent,
      oops:document.getElementById('oopsText').textContent, products:window.__scan.products() })).catch(()=>null);
    if(s){ if(s.wheel) sawWheel=true; if(/your turn is coming/.test(s.lead)) sawWaiting=true;
      if(s.stage==='done'||s.stage==='fail') return { i, ...s, sawWheel, sawWaiting, ms:Date.now()-t0 }; }
    await sleep(400);
  }
  return { i, stage:'stuck', ms:Date.now()-t0 };
}));
const secs=Math.round((Date.now()-t0)/1000);

const done=ends.filter(e=>e.stage==='done'), failed=ends.filter(e=>e.stage!=='done');
const already=done.filter(e=>/Already/.test(e.title));
console.log(`   ${secs}s for all ${N}; slowest phone ${Math.round(Math.max(...ends.map(e=>e.ms))/1000)}s; most tries on one phone ${Math.max(...done.map(e=>e.tries||0))}`);
console.log(`   server: ${stats.requests} requests, ${stats.tooMany} turned away (too many at once), ${stats.busy} "busy", ${stats.lost} answers lost on the way back, longest queue for the lock ${stats.maxQueue}`);
chk(`every one of the ${N} phones ends on the wheel's answer`, failed.length===0, failed.slice(0,3));
chk('...none told "already redeemed" for a code it spent itself (lost answers included)', already.length===0, already.slice(0,3).map(e=>({i:e.i,tries:e.tries})));
chk('the crowd really was too big for one go: phones were turned away and asked again', stats.tooMany+stats.busy>0 && stats.lost>0, stats);
const rows=H.tabs['Gifts'].rows.slice(1).filter(r=>claims.includes(r[0]));
chk(`each code spent exactly once: ${N} rows, each with a product and a time`, rows.length===N && rows.every(r=>r[6] && r[7]), rows.filter(r=>!r[7]).length);
const stockAfter=H.tabs['Gift stock'].rows.slice(1).reduce((a,r)=>a+(+r[1]||0),0);
chk(`the stock went down by exactly ${N}`, stockBefore-stockAfter===N, { before:stockBefore, after:stockAfter });
const wrong=done.filter(e=>{ const row=rows.find(r=>r[0]===claims[e.i]); return !row || e.prize!==row[7] || e.products[e.landed]!==row[7]; });
chk('every phone shows the product the script wrote, and its wheel stopped on it', wrong.length===0, wrong.slice(0,3).map(e=>({i:e.i,prize:e.prize,landed:e.products&&e.products[e.landed]})));
chk('every phone showed the wheel', done.every(e=>e.sawWheel), done.filter(e=>!e.sawWheel).length);
chk('phones that had to wait said so ("your turn is coming")', done.filter(e=>e.tries>1).every(e=>e.sawWaiting), done.filter(e=>e.tries>1&&!e.sawWaiting).length);
chk('nothing was written under the lock and left unflushed when the lock was let go', H.SHEETS.unflushedReleases===0, H.SHEETS.unflushedReleases);
chk('no page errors', errs.length===0, errs[0]);

/* a second scan of a spent code, by a new scan (not a lost answer), is still "already" */
{
  const p=pages[0];
  /* (not via Scan next: that starts the camera, and this browser has none) */
  await p.evaluate(()=>{ window.__scan.state().stage='again'; });
  await p.evaluate(u=>window.__scan.handle(u), 'https://my.facerinna.com/redeem.html?c='+claims[0]);
  let s=null; for(let k=0;k<60;k++){ s=await p.evaluate(()=>({stage:window.__scan.state().stage, title:document.getElementById('resTitle').textContent, oops:document.getElementById('oopsText').textContent})); if(s.stage==='done'||s.stage==='fail') break; await sleep(300); }
  chk('scanning a spent code again is still "Already redeemed" -- the check against a second gift stands', s && s.stage==='done' && /Already/.test(s.title), s);
}

await b.close(); srv.close();
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad?1:0);
