#!/usr/bin/env node
/* What a mid-range phone has to do for each page and game, measured on a slowed-down CPU.

   This machine has no GPU, so it cannot say how many frames a second a phone will draw, and nothing
   here claims to. What carries over is the work done on the main thread -- the thread a finger's
   touch has to wait for -- so that is what is measured, with the CPU slowed 4x:

     blocked at load    how long the page held the main thread in jobs over 50ms before it settled
     longest job        the one job that held it longest (a touch waits this long)
     busy, idle         the share of a quiet 4 seconds the main thread spent working
     busy, scroll       the same while the page is scrolled top to bottom (home page)
     busy, playing      the same with a game running
     kept alive         DOM nodes, and the memory the page's script holds

   A page that is busy when nothing is happening is a page that drains a battery and drops frames when
   something does.

     node tools/mobile-perf.mjs                      all of them
     node tools/mobile-perf.mjs --only facy          pages whose name contains this
     node tools/mobile-perf.mjs --throttle 6         a slower phone
   Exit code 1 if anything is over its budget (see BUDGET). */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8330+Math.floor(Math.random()*50), BASE='http://127.0.0.1:'+PORT;
const arg=n=>{ const i=process.argv.indexOf('--'+n); return i>0 ? process.argv[i+1] : null; };
const ONLY=arg('only'), RATE=+(arg('throttle')||4);

/* Over these, a mid-range phone will feel it. Generous on purpose: this is a floor, not a target. */
const BUDGET={ blockedMs:600, longestMs:350, idleBusy:0.45, scrollBusy:0.80, playBusy:0.85, nodes:4000, heapMB:140 };

const PAGES=[
  {p:'index.html',      kind:'site'},
  {p:'privacy.html',    kind:'doc'}, {p:'terms.html',kind:'doc'}, {p:'cookies.html',kind:'doc'},
  {p:'uv-card.html',    kind:'game', start:'#startBtn'},
  {p:'facy-run.html',   kind:'game', facy:true},
  {p:'lab-run.html',    kind:'game', start:'#playBtn'},
  {p:'match-lab.html',  kind:'game', start:'#playBtn'},
  {p:'deep-lab.html',   kind:'game', start:'#startBtn'},
  {p:'pack-match.html', kind:'game', start:'#startBtn'},
  {p:'shelf-shot.html', kind:'game', start:'#startBtn'},
];

const T={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{ let f=decodeURIComponent(new URL(q.url,BASE).pathname); if(f.endsWith('/')) f+='index.html'; const fp=path.join(ROOT,f);
  if(f==='/sw.js'||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ r.writeHead(404); r.end(); return; }
  r.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'}); r.end(fs.readFileSync(fp)); });
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const rows=[], bad=[];

const metric=async(cdp)=>{ const {metrics}=await cdp.send('Performance.getMetrics'); const m={}; metrics.forEach(x=>m[x.name]=x.value); return m; };
/* the share of a window the main thread spent on tasks */
async function busyOver(cdp,ms,during){
  const a=await metric(cdp), t0=Date.now();
  if(during) await during(); else await sleep(ms);
  const z=await metric(cdp), wall=(Date.now()-t0)/1000;
  return Math.min(1,(z.TaskDuration-a.TaskDuration)/wall);
}

for(const pg of PAGES){
  if(ONLY && !pg.p.includes(ONLY)) continue;
  const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await c.addInitScript(()=>{ try{ localStorage.setItem('fx.player','Aina'); }catch(e){}
    window.__long=[]; try{ new PerformanceObserver(l=>{ for(const e of l.getEntries()) window.__long.push(e.duration); }).observe({type:'longtask',buffered:true}); }catch(e){} });
  await c.route(u=>!u.href.startsWith(BASE), r=>r.abort());
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  const cdp=await c.newCDPSession(p);
  await cdp.send('Performance.enable'); await cdp.send('Emulation.setCPUThrottlingRate',{rate:RATE});
  const t0=Date.now();
  await p.goto(BASE+'/'+pg.p,{waitUntil:'load',timeout:120000}); const loadMs=Date.now()-t0;
  await sleep(3000);                                         // let it settle, then count what it held up
  const lt=await p.evaluate(()=>window.__long.slice());
  const blocked=lt.reduce((a,d)=>a+Math.max(0,d-50),0), longest=lt.length?Math.max(...lt):0;
  const idle=await busyOver(cdp,4000);
  let scroll=null, play=null;
  if(pg.kind==='site'){
    scroll=await busyOver(cdp,0,async()=>{ const h=await p.evaluate(()=>document.documentElement.scrollHeight-innerHeight);
      for(let i=1;i<=24;i++){ await p.evaluate(y=>scrollTo(0,y),Math.round(h*i/24)); await sleep(220); } });
    await p.evaluate(()=>scrollTo(0,0));
  }
  if(pg.kind==='game'){
    await p.click('#fxrGo').catch(()=>{}); await sleep(400);
    if(pg.facy) await p.evaluate(()=>{ window.__facy.start(); window.__facy.keys.right=true; }).catch(()=>{});
    else if(pg.start){ const el=await p.$(pg.start); if(el) await el.click().catch(()=>{}); }
    await sleep(1500);
    play=await busyOver(cdp,5000,async()=>{ for(let i=0;i<10;i++){ await p.touchscreen.tap(60+((i*97)%270),300+((i*61)%300)).catch(()=>{}); await sleep(500); } });
  }
  const end=await metric(cdp);
  const nodes=await p.evaluate(()=>document.getElementsByTagName('*').length);
  const heap=(end.JSHeapUsedSize||0)/1048576;
  const row={page:pg.p,load:loadMs,blocked:Math.round(blocked),longest:Math.round(longest),idle,scroll,play,nodes,heap:Math.round(heap),errs:errs.length};
  rows.push(row);
  const flag=(ok,msg)=>{ if(!ok) bad.push(pg.p+': '+msg); };
  flag(blocked<=BUDGET.blockedMs, `blocked ${Math.round(blocked)}ms at load (budget ${BUDGET.blockedMs})`);
  flag(longest<=BUDGET.longestMs, `longest job ${Math.round(longest)}ms (budget ${BUDGET.longestMs})`);
  flag(idle<=BUDGET.idleBusy, `${Math.round(idle*100)}% busy when idle (budget ${Math.round(BUDGET.idleBusy*100)}%)`);
  if(scroll!=null) flag(scroll<=BUDGET.scrollBusy, `${Math.round(scroll*100)}% busy while scrolling (budget ${Math.round(BUDGET.scrollBusy*100)}%)`);
  if(play!=null) flag(play<=BUDGET.playBusy, `${Math.round(play*100)}% busy while playing (budget ${Math.round(BUDGET.playBusy*100)}%)`);
  flag(nodes<=BUDGET.nodes, `${nodes} DOM nodes (budget ${BUDGET.nodes})`);
  flag(heap<=BUDGET.heapMB, `${Math.round(heap)}MB of script memory (budget ${BUDGET.heapMB})`);
  flag(errs.length===0, 'page error: '+errs[0]);
  await c.close();
}
await b.close(); srv.close();

const pct=v=>v==null?'    -':String(Math.round(v*100)).padStart(3)+'%';
console.log(`CPU slowed ${RATE}x, 390x844 phone\n`);
console.log('page'.padEnd(18)+'load ms  blocked  longest  idle   scroll  playing  nodes  heap MB');
for(const r of rows) console.log(r.page.padEnd(18)+String(r.load).padStart(7)+String(r.blocked).padStart(9)+String(r.longest).padStart(9)+'  '+pct(r.idle)+'   '+pct(r.scroll)+'    '+pct(r.play)+String(r.nodes).padStart(8)+String(r.heap).padStart(9));
console.log(bad.length ? '\nOVER BUDGET:\n  '+bad.join('\n  ') : '\nEverything is inside its budget.');
process.exit(bad.length?1:0);
