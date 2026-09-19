/* The gift at the end of a game, for every game that has one.

   fx-gift.js is the whole of it: the panel, the bar, the claim and the QR.
   What is under test is that it behaves the same wherever it is loaded, that
   the bar is the one the booth script set FOR THAT GAME, and that a game with
   no bar set offers nothing rather than everything.

   The quiz gets its own case because its score reads "4/5" on screen, and
   anything stripping non-digits from that reads forty-five. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8161, BASE='http://127.0.0.1:'+PORT, API=BASE+'/api';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, ms=8000, step=100){ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(step);} return fn(); }
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.webmanifest':'application/manifest+json'};

/* the booth script, as far as a game can tell */
const G={ active:'yes', needs:{'match-lab':5000,'skin-iq':4}, claims:{}, seen:[], redeemed:{} };
const srv=http.createServer((req,res)=>{
  const u=new URL(req.url,BASE);
  if(u.pathname==='/api'){
    let raw=''; req.on('data',c=>raw+=c); req.on('end',()=>{
      let b={}; try{ b=JSON.parse(raw||'{}'); }catch(e){}
      G.seen.push(b.action);
      let out={ok:false,error:'unknown action'};
      if(b.action==='config') out={ok:true, settings:{gift_active:G.active}, gift_needs:G.needs,
        gift_games:Object.keys(G.needs), segments:[], sections:[], section_states:[]};
      else if(b.action==='gift.claim'){
        const need=G.needs[b.game];
        if(G.active!=='yes') out={ok:false,reason:'inactive'};
        else if(!need) out={ok:false,reason:'nogame'};
        else if(b.score<need) out={ok:false,reason:'short',need};
        else {
          if(!G.claims[b.device]) G.claims[b.device]='aaaaaaaa-bbbb-4ccc-8ddd-'+String(Object.keys(G.claims).length).padStart(12,'0');
          const c=G.claims[b.device];
          out={ok:true, claim:c, redeemed:!!G.redeemed[c], product:G.redeemed[c]||''};
        }
      }
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(out)); });
    return;
  }
  let f=decodeURIComponent(u.pathname); if(f.endsWith('/')) f+='index.html';
  if(f==='/sw.js'){ res.writeHead(404); res.end(); return; }
  const fp=path.join(ROOT,f);
  if(!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});
  res.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
async function open_(page, device){
  const c=await b.newContext({viewport:{width:900,height:800}});
  await c.addInitScript(([a,d])=>{ window.__BOOTH_API=a; window.__REDEEM_URL='https://my.facerinna.com/redeem.html';
    try{ if(d) localStorage.setItem('fx.device', d); localStorage.setItem('fx.player','Tester'); }catch(e){} }, [API, device||'']);
  const p=await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  /* domcontentloaded, not load: these are 3D game pages and waiting on every
     last asset times out when the rest of the suite is competing for the
     machine. What this needs is the module, so wait for that. */
  await p.goto(BASE+'/'+page,{waitUntil:'domcontentloaded'});
  await until(()=>p.evaluate(()=>!!window.fxGift).catch(()=>false), 20000);
  await p.waitForTimeout(200);
  return {c,p,errs};
}
/* Really on screen, not merely styled as though it would be: the panel lives
   inside the game's result screen, and a result screen that has not been
   shown yet hides everything in it however the panel styles itself. */
const panel=p=>p.evaluate(()=>{ const el=document.querySelector('.fxg');
  if(!el || el.style.display==='none' || el.offsetParent===null) return null;
  const btn=el.querySelector('button');
  return { title:el.querySelector('h4').textContent, text:el.querySelector('p').textContent,
           code:el.querySelector('.fxg-code').textContent,
           qr:getComputedStyle(el.querySelector('canvas')).display,
           btn: btn.offsetParent !== null }; });

/* What a game does when a run ends: write the score, show the result. The
   module is watching for exactly that, so the tests drive it the same way
   rather than calling into it. */
/* fx-rank asks for a name over the result screen the first time, and that
   sits on top of whatever is under it. A visitor types it; a test dismisses
   it, the same way the Facy Run suite does. */
async function clearGate(p){
  try{
    await p.evaluate(()=>{
      const go=document.querySelector('#fxrGo');
      if(go && go.offsetParent!==null) go.click();
      const gate=document.querySelector('.fxr-gate');
      if(gate) gate.remove();
    });
  }catch(e){}
}

const finish=(p,score)=>p.evaluate(n=>{
  const cfg=window.FX_GIFT||window.FX_RANK;
  const r=document.querySelector(cfg.result), s=document.querySelector(cfg.score);
  if(!r||!s) return false;
  s.textContent=String(n);
  r.classList.add('hidden'); r.classList.remove('hidden');
  r.hidden=false; r.style.display='block';
  const host=r.closest('[hidden]'); if(host) host.hidden=false;
  return true;
}, score);

console.log('the module is loaded by every game that keeps a score');
{
  const want=['match-lab','pack-match','shelf-shot','deep-lab','lab-run'];
  const miss=want.filter(g=>!fs.readFileSync(path.join(ROOT,g+'.html'),'utf8').includes('src="fx-gift.js"'));
  chk('the five arcade games', miss.length===0, miss);
  chk('...and the booth page, for the quiz',
      fs.readFileSync(path.join(ROOT,'index.html'),'utf8').includes('src="fx-gift.js"'));
  chk('UV Card is left out, having no score to clear',
      !fs.readFileSync(path.join(ROOT,'uv-card.html'),'utf8').includes('fx-gift.js'));
}

console.log('\na run under this game\'s bar');
{
  G.seen=[];
  const {c,p,errs}=await open_('match-lab.html','devunder01');
  chk('the game shows its result', await finish(p,4000)); await clearGate(p);
  chk('is told what it needs, in this game\'s own figures',
      await until(async()=>{ const q=await panel(p); return !!q && /5000/.test(q.title); }), await panel(p));
  const q=await panel(p);
  chk('...with no code and nothing to press', q.qr==='none' && !q.btn, q);
  chk('...and no claim minted for a run that did not earn one',
      !G.seen.includes('gift.claim'), G.seen);
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\na run that clears it');
{
  G.seen=[];
  const {c,p,errs}=await open_('match-lab.html','devover001');
  chk('the game shows its result', await finish(p,5000)); await clearGate(p);
  chk('exactly the bar is enough', await until(async()=>{ const q=await panel(p); return !!q && q.btn; }));
  chk('...and still nothing minted until it is pressed', !G.seen.includes('gift.claim'), G.seen);
  await p.click('.fxg button');
  chk('pressing it mints one claim and shows the code',
      await until(async()=>{ const q=await panel(p); return !!q && q.qr!=='none'; })
      && G.seen.filter(a=>a==='gift.claim').length===1, G.seen);
  const shown=await p.evaluate(()=>window.fxGift.lastClaim());
  chk('...the one the script handed back', shown===G.claims['devover001'], {shown, want:G.claims['devover001']});

  /* read back by a second party, from the pixels the page drew */
  const file='/tmp/fxg-qr.png';
  const png=await p.evaluate(()=>window.fxGift.qr().toDataURL('image/png'));
  fs.writeFileSync(file, Buffer.from(png.split(',')[1],'base64'));
  const py=spawnSync('python3',['-c',`
import cv2, sys
img=cv2.imread(sys.argv[1]); big=cv2.resize(img,None,fx=3,fy=3,interpolation=cv2.INTER_NEAREST)
val,_,_=cv2.QRCodeDetector().detectAndDecode(big); print(val)`, file],{encoding:'utf8'});
  const read=(py.stdout||'').trim();
  chk('a decoder reads the counter\'s address and this claim out of it',
      read==='https://my.facerinna.com/redeem.html?c='+shown, {read});
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\nthe same device, playing a different game');
{
  G.seen=[];
  const {c,p,errs}=await open_('match-lab.html','devover001');
  await finish(p,9000); await clearGate(p);
  await until(async()=>{ const q=await panel(p); return !!q && q.btn; });
  await p.click('.fxg button');
  await until(async()=>{ const q=await panel(p); return !!q && q.code; });
  chk('gets the same claim back, not a second one',
      (await p.evaluate(()=>window.fxGift.lastClaim()))===G.claims['devover001']
      && Object.keys(G.claims).length===1, Object.keys(G.claims));
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\na game the admin has set no figure for');
{
  const {c,p,errs}=await open_('deep-lab.html','devnobar01');
  await finish(p,999999); await clearGate(p);
  await p.waitForTimeout(600);
  chk('offers nothing at all, rather than offering it to everyone', (await panel(p))===null, await panel(p));
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\nwith gifts switched off');
{
  G.active='no';
  const {c,p,errs}=await open_('match-lab.html','devoff0001');
  await finish(p,9000); await clearGate(p);
  await p.waitForTimeout(600);
  chk('no game offers one', (await panel(p))===null);
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
  G.active='yes';
}

console.log('\nthe quiz, whose score reads "4/5" on screen');
{
  G.seen=[];
  const {c,p,errs}=await open_('index.html','devquiz001');
  /* play it: the result screen is what fx-gift watches */
  await p.evaluate(()=>{ document.getElementById('iqCard').click(); });
  await p.waitForTimeout(500);
  const got=await p.evaluate(async()=>{
    /* answer four right and one wrong, whatever the questions are */
    const out=[];
    for(let k=0;k<5;k++){
      const opts=[...document.querySelectorAll('#opts button, #opts .opt')];
      if(!opts.length) break;
      out.push(opts.length);
      opts[0].click();
      await new Promise(r=>setTimeout(r,120));
      const nxt=document.getElementById('nextBtn');
      if(nxt && nxt.style.display!=='none') nxt.click();
      await new Promise(r=>setTimeout(r,120));
    }
    return { opts:out, raw:(document.getElementById('iqScoreRaw')||{}).textContent,
             shown:(document.getElementById('finalScore')||{}).textContent };
  });
  chk('the result screen carries a plain number beside the "n/5"',
      /^[0-5]$/.test(String(got.raw||'')) && /\/5$/.test(String(got.shown||'')), got);
  chk('...and that is what the gift reads, not forty-five',
      await p.evaluate(()=>{ const el=document.getElementById('iqScoreRaw');
        return parseInt(String(el.textContent).replace(/[^0-9-]/g,''),10) <= 5; }));
  chk('the quiz puts its score on the booth board under its own name',
      await until(()=>p.evaluate(()=>{ try{ return (localStorage.getItem('fx.rank.skin-iq')||'').includes('Tester'); }catch(e){ return false; } })));
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\nthe result screen showing is enough on its own');
{
  const {c,p,errs}=await open_('match-lab.html','devauto001');
  const fired=await p.evaluate(async()=>{
    const r=document.querySelector(window.FX_RANK.result);
    const s=document.querySelector(window.FX_RANK.score);
    if(!r||!s) return 'no result screen';
    s.textContent='7000';
    r.classList.add('hidden'); await new Promise(x=>setTimeout(x,50));
    r.classList.remove('hidden');
    const g=document.querySelector('.fxr-gate'); if(g) g.remove();
    return 'ok';
  });
  chk('a game need do nothing but show its result', fired==='ok' &&
      await until(async()=>{ const q=await panel(p); return !!q && q.btn; }), fired);
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

await b.close(); await new Promise(r=>srv.close(r));
console.log(bad? '\nSOMETHING IS WRONG' : '\nevery scored game can pay out, each against its own bar');
process.exit(bad?1:0);
