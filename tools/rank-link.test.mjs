/* One ranking, whatever the screen.

   A phone, a tablet and a TV all play the same game at the same booth: what any
   one of them posts is what every one of them reads back. This stands in for the
   booth scoreboard (one shared store, behind the same address the games use),
   runs three devices of different shapes against it for every scored game, and
   checks the name is asked once, the board comes up only when it is tapped, and
   it is one popup however many times it is tapped. Nothing leaves for the real
   booth scripts. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8265, BASE='http://127.0.0.1:'+PORT;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++; console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.jpg':'image/jpeg'};
const srv=http.createServer((q,r)=>{
  let f=decodeURIComponent(new URL(q.url,BASE).pathname); const fp=path.join(ROOT,f);
  if(f==='/sw.js'||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ r.writeHead(404); return r.end(); }
  r.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'}); r.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch();

/* the shared scoreboard: one store, however many devices reach it */
const store={};
const rowsOf=g=>{ const best={}; (store[g]||[]).forEach(x=>{ if(!(x.n in best)||x.s>best[x.n]) best[x.n]=x.s; }); return Object.entries(best).map(([n,s])=>({n,s})).sort((a,c)=>c.s-a.s).slice(0,5); };
const headers={'access-control-allow-origin':'*'};
async function device(vp,touch,dsf,page){
  const c=await b.newContext({viewport:vp,isMobile:touch,hasTouch:touch,deviceScaleFactor:dsf});
  await c.route(u=>!u.href.startsWith(BASE), async route=>{
    const u=route.request().url();
    if(!u.startsWith('https://script.google.com')) return route.abort();
    if(route.request().method()==='POST'){
      let q={}; try{ q=JSON.parse(route.request().postData()||'{}'); }catch(e){}
      (store[q.game]=store[q.game]||[]).push({n:q.name,s:q.score});
      return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({ok:true,rows:rowsOf(q.game)})});
    }
    const g=new URL(u).searchParams.get('game');
    return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({ok:true,rows:rowsOf(g)})});
  });
  await c.addInitScript(()=>{ window.__BOOTH_API=''; });
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/'+page,{waitUntil:'load'}); await sleep(500);
  return {c,p,errs};
}
const gateUp=p=>p.evaluate(()=>{ const g=document.querySelector('.fxr-gate'); return !!g && !g.classList.contains('hidden'); });
const signIn=async(p,name)=>{ await p.fill('#fxrName',name); await p.click('#fxrGo'); await sleep(200); };
/* a run ends the way every game ends one: its result screen is shown with the score on it */
const finish=(p,score)=>p.evaluate(n=>{ const cfg=window.FX_RANK, r=document.querySelector(cfg.result), s=document.querySelector(cfg.score);
  s.textContent=String(n); r.classList.add('hidden'); r.classList.remove('hidden'); return true; }, score);
const popOn=p=>p.evaluate(()=>document.querySelector('.fxr-pop').classList.contains('on'));
const popText=p=>p.evaluate(()=>document.querySelector('.fxr-pop').innerText);

const GAMES=['match-lab.html','pack-match.html','shelf-shot.html','deep-lab.html','lab-run.html','facy-run.html','pack-drop-4k.html','pack-crush-4k.html','pack-recall-4k.html'];
const ID=h=>h.replace('.html','').replace('-4k','');
let score=1000;
/* One page alive at a time: the 3D games keep a software renderer busy, and three of them at once starve the next load. A device keeps its
   name between visits the way a real one does: the visit is a new page in the same browser context. */
const visit=async(d,page)=>{ d.p=await d.c.newPage(); d.p.on('pageerror',e=>d.errs.push(e.message)); await d.p.goto(BASE+'/'+page,{waitUntil:'load'}); await sleep(500); return d.p; };
for (const page of GAMES){
  console.log('\n'+page);
  const errs=[];
  const phone=await device({width:390,height:844},true,2,page);
  chk(page+': a first visit asks the name', await gateUp(phone.p));
  await signIn(phone.p,'Aina');
  score+=111;
  await finish(phone.p,score); await sleep(500);
  chk(page+': a finished run does not pop the board up by itself', !(await popOn(phone.p)));
  await phone.p.click('.fxr-show'); await sleep(450);
  chk(page+': the Ranking button opens it, and there is one popup', (await popOn(phone.p)) && await phone.p.evaluate(()=>document.querySelectorAll('.fxr-pop').length===1));
  await phone.p.click('.fxr-show'); await sleep(350);
  chk(page+': and tapping it again puts it away', !(await popOn(phone.p)));
  errs.push(...phone.errs); await phone.p.close();

  /* the same game on a tablet: its rank shows the phone's score */
  const tablet=await device({width:1180,height:820},true,2,page);
  await signIn(tablet.p,'Budi'); await tablet.p.click('.fxr-show'); await sleep(900);
  let t=await popText(tablet.p);
  chk(page+': the tablet sees the phone\'s score ('+score+') under its name', /Aina/.test(t) && t.includes(String(score)) && /Everyone at the booth/.test(t), t.slice(0,160));
  errs.push(...tablet.errs); await tablet.c.close();

  /* and on a TV, which plays too, and sees both */
  const tv=await device({width:1920,height:1080},false,1,page);
  await signIn(tv.p,'Citra'); score+=57; await finish(tv.p,score); await sleep(700);
  await tv.p.click('.fxr-show'); await sleep(800);
  t=await popText(tv.p);
  chk(page+': the TV sees its own run and the phone\'s, as one board', /Aina/.test(t) && /Citra/.test(t), t.slice(0,200));
  errs.push(...tv.errs); await tv.p.close();
  await visit(tv,page);
  chk(page+': a second visit on the TV does not ask the name again, and the Ranking button is already there', !(await gateUp(tv.p)) && await tv.p.evaluate(()=>getComputedStyle(document.querySelector('.fxr-show')).display!=='none'));
  errs.push(...tv.errs); await tv.c.close();

  /* the phone comes back later: its name is remembered, and the board now holds the TV's score too */
  await visit(phone,page);
  chk(page+': the phone, back for a second visit, is not asked the name again', !(await gateUp(phone.p)));
  await phone.p.click('.fxr-show'); await sleep(1100);
  t=await popText(phone.p);
  chk(page+': and its board now shows the TV\'s score', /Citra/.test(t) && /Aina/.test(t), t.slice(0,200));
  errs.push(...phone.errs); await phone.c.close();
  chk(page+': no page errors on any of the three', errs.length===0, errs.slice(0,2));
}

await b.close(); srv.close();
console.log(bad?`\n${bad} FAILED`:'\nALL PASS'); process.exit(bad?1:0);
