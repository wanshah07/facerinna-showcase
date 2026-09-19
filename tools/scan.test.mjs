/* The counter screen.

   The thing it exists to fix: redeem.html signs a browser in per scan, and a
   phone's camera does not reliably hand the scan back to the browser that was
   signed in -- so the counter was typing an address per visitor. This page is
   opened once and not left, so what is under test is that one sign-in carries
   across visitor after visitor, that what it reads is checked before anything
   is spent, and that the wheel still lands where the script says.

   Most of it is driven through the page's own reader. The last section does
   not: Chromium is given a video file of a real QR code as its camera, so the
   loop, the decoder and the handoff are all doing the work a counter would
   ask of them. That section exists because the loop was once armed nowhere on
   a first open -- the picture was live, nothing ever looked at it, and every
   check that called handle() by hand passed. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8163, BASE='http://127.0.0.1:'+PORT, API=BASE+'/api';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, ms=9000, step=100){ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(step);} return fn(); }
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.webp':'image/webp'};

const PRODUCTS=['Niacinamide Brightening Serum Sunscreen SPF50 PA++++','2% Salicylic Acid Acne Serum',
  'Ceramide B5 Balancing Moisturizer','5% B5 Centella Calming Gel Cream','Low pH B5 Gel Cleanser',
  'Ceramide B5 Balancing Toner','10% Niacinamide 3% TXA Bright Dark Spot Serum','5% B5 Intensive Barrier Cream'];
const TOKEN='11111111-1111-4111-8111-111111111111', ADMIN='owner@facerinna.test', CODE='123456';
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', SPENT='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const S={ pick:{[A]:3,[B]:6}, seen:[], spent:{} };
const srv=http.createServer((req,res)=>{
  const u=new URL(req.url,BASE);
  if(u.pathname==='/api'){
    let raw=''; req.on('data',c=>raw+=c); req.on('end',()=>{
      let b={}; try{ b=JSON.parse(raw||'{}'); }catch(e){}
      S.seen.push(b);
      let out={ok:false,error:'unknown action'};
      if(b.action==='code') out = {ok:true, sent:true};
      else if(b.action==='redeem') out = (b.email===ADMIN && b.code===CODE)
        ? {ok:true, token:TOKEN, email:ADMIN} : {ok:false, reason:'badcode', left:4};
      else if(b.action==='admin.gift.redeem'){
        if(b.token!==TOKEN) out={ok:false,error:'signed out'};
        else if(b.claim===SPENT) out={ok:true,already:true,product:PRODUCTS[2],index:2,products:PRODUCTS,at:'2026-09-18T15:30:00Z',score:7100,name:'Lena'};
        else if(S.pick[b.claim]!==undefined){
          const i=S.pick[b.claim];
          if(S.spent[b.claim]) out={ok:true,already:true,product:PRODUCTS[i],index:i,products:PRODUCTS,at:'2026-09-19T10:00:00Z',score:6400,name:'Ahmad'};
          else { S.spent[b.claim]=true; out={ok:true,already:false,product:PRODUCTS[i],index:i,products:PRODUCTS,score:6400,name:'Ahmad'}; }
        } else out={ok:false,error:'no such claim'};
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

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader',
  '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
async function open_(tok){
  const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,permissions:['camera']});
  await c.addInitScript(WAKE_STUB);
  await c.addInitScript(([a,t])=>{ window.__BOOTH_API=a; try{ if(t) localStorage.setItem('fx.admin.token',t); }catch(e){} }, [API, tok||'']);
  const p=await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/scan.html',{waitUntil:'domcontentloaded'});
  await until(()=>p.evaluate(()=>!!window.__scan).catch(()=>false));
  await p.waitForTimeout(300);
  return {c,p,errs};
}
const WAKE_STUB=()=>{
  window.__wake={asked:0, freed:0};
  try{
    Object.defineProperty(navigator, 'wakeLock', {configurable:true, value:{
      request:function(){
        window.__wake.asked++;
        return Promise.resolve({ release:function(){ window.__wake.freed++; return Promise.resolve(); },
                                 addEventListener:function(){} });
      }}});
  }catch(e){}
};
const vis=(p,id)=>p.evaluate(i=>{ const e=document.getElementById(i); return !!e && !e.classList.contains('hidden'); }, id);
const txt=(p,id)=>p.evaluate(i=>(document.getElementById(i)||{}).textContent.trim(), id);

console.log('what it will and will not act on');
{
  const {c,p,errs}=await open_(TOKEN);
  const r=await p.evaluate((args)=>{
    const f=window.__scan.claimFrom;
    return args.map(a=>f(a));
  }, ['https://my.facerinna.com/redeem.html?c='+A, A, 'https://my.facerinna.com/redeem.html?c=not-a-claim',
      '9557001234567', 'BOARDING PASS MH0123', '', 'HTTPS://MY.FACERINNA.COM/REDEEM.HTML?C='+A.toUpperCase()]);
  chk('a redeem link gives up its claim', r[0]===A);
  chk('a bare claim is one too', r[1]===A);
  chk('a link with something else in it is not', r[2]==='');
  chk('a product barcode is not a gift code', r[3]==='' && r[4]==='' && r[5]==='', r.slice(3,6));
  chk('a link a capitalising encoder wrote still gives the claim the script knows',
      r[6]===A, r[6]);
  chk('...and nothing was sent anywhere for any of them', S.seen.length===0, S.seen.length);
  chk('the decoder is aboard, so a phone without one still reads codes',
      await p.evaluate(()=>window.__scan.decoder())===true);
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\none sign-in, then visitor after visitor');
{
  S.seen=[]; S.spent={};
  const {c,p,errs}=await open_(TOKEN);
  chk('a signed-in counter goes straight to the camera, with no form',
      !(await vis(p,'gate')) && await until(()=>vis(p,'camWrap')));

  /* first visitor */
  await p.evaluate(a=>window.__scan.handle('https://my.facerinna.com/redeem.html?c='+a), A);
  chk('the wheel comes up for the first', await until(()=>vis(p,'wheelWrap')));
  chk('...and lands where the script said',
      await until(()=>p.evaluate(()=>!window.__scan.spinning()), 9000)
      && await p.evaluate(()=>window.__scan.landed())===3);
  chk('...naming the product and who earned it',
      await until(()=>vis(p,'result')) && (await txt(p,'prize'))===PRODUCTS[3] && /Ahmad/.test(await txt(p,'resMeta')));

  /* the next one, with no sign-in in between -- the whole point */
  await p.click('#next');
  chk('tapping on goes back to the camera, not to a sign-in',
      await until(()=>vis(p,'camWrap')) && !(await vis(p,'gate')));
  await p.evaluate(a=>window.__scan.handle(a), B);
  /* p.evaluate returns a promise: comparing it to a number is comparing a
     promise to a number, which is false forever. Await it inside. */
  const spun = await until(()=>p.evaluate(()=>window.__scan.landed()).then(v=>v===6), 12000);
  const shown = await until(()=>vis(p,'result'), 4000);
  chk('the second visitor is served the same way',
      spun && shown && (await txt(p,'prize'))===PRODUCTS[6],
      {spun, shown, prize: await txt(p,'prize')});
  chk('...and the counter was never asked to sign in again',
      S.seen.filter(x=>x.action==='code'||x.action==='redeem').length===0, S.seen.map(x=>x.action));
  chk('two visitors, two claims spent, no more', S.seen.filter(x=>x.action==='admin.gift.redeem').length===2);
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\na code that was already spent');
{
  const {c,p,errs}=await open_(TOKEN);
  await p.evaluate(a=>window.__scan.handle(a), SPENT);
  chk('gets no spin, just the receipt',
      await until(()=>vis(p,'result')) && !(await vis(p,'wheelWrap'))
      && /Already redeemed/i.test(await txt(p,'resTitle')));
  chk('...naming what it already gave, so nobody hands out a second',
      (await txt(p,'prize'))===PRODUCTS[2] && /do not hand out a second/i.test(await txt(p,'resText')));
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\na counter that has never been signed in');
{
  S.seen=[];
  const {c,p,errs}=await open_('');
  chk('is asked once, and told it is once', await until(()=>vis(p,'gate'))
      && /stays signed in/i.test(await txt(p,'gate')));
  await p.fill('#gateMail', ADMIN);
  await p.click('#gateGo');
  chk('the address gets a code', await until(()=>Promise.resolve(S.seen.some(x=>x.action==='code'))));
  chk('...and somewhere to type it', await until(()=>p.evaluate(()=>{
    const d=document.getElementById('gateCode'); return !!d && !d.classList.contains('hidden'); })));
  await p.fill('#gateCode','000000');
  await p.click('#gateGo');
  chk('a wrong code is refused and keeps nothing',
      await until(async()=>/not right/i.test(await txt(p,'gateSay')))
      && await p.evaluate(()=>{ try{ return !localStorage.getItem('fx.admin.token'); }catch(e){ return true; } }));
  await p.fill('#gateCode',CODE);
  await p.click('#gateGo');
  chk('the right one opens the camera and is kept for the day',
      await until(()=>vis(p,'camWrap'))
      && await p.evaluate(()=>{ try{ return localStorage.getItem('fx.admin.token'); }catch(e){ return null; } })===TOKEN);
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\na sign-in the script has stopped honouring');
{
  const {c,p,errs}=await open_('stale-token');
  await p.evaluate(a=>window.__scan.handle(a), A);
  chk('asks for a new one rather than failing at the visitor',
      await until(()=>vis(p,'gate')) && /expired/i.test(await txt(p,'lead')));
  chk('...and throws the dead one away',
      await p.evaluate(()=>{ try{ return !localStorage.getItem('fx.admin.token'); }catch(e){ return true; } }));
  chk('...and lets the phone sleep again, rather than holding it awake on a form',
      await until(()=>p.evaluate(()=>window.__scan.awake()===false && window.__wake.freed>=1)),
      await p.evaluate(()=>window.__wake));
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\nthe wheel carries the products\' own pictures');
{
  const {c,p,errs}=await open_(TOKEN);
  await p.evaluate(a=>window.__scan.handle(a), B);
  await until(()=>p.evaluate(()=>!window.__scan.spinning()), 9000);
  const got=await p.evaluate(()=>{
    const names=window.__scan.products();
    return Promise.all(names.map(n=>{
      const slug=n.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      return fetch('products/'+slug+'.webp').then(r=>r.ok).catch(()=>false);
    }));
  });
  chk('every product on the wheel has one', got.every(Boolean), got);
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

console.log('\na code held up to the camera, with nobody touching the page');
{
  /* A camera Chromium can be given: one QR, drawn by a second encoder and
     handed over as raw frames, so nothing in this file tells the page what it
     is looking at. */
  const y4m='/tmp/fx-scan-cam.y4m';
  const py=spawnSync('python3',['-c',`
import cv2, numpy as np, sys
q=cv2.QRCodeEncoder_create().encode(sys.argv[1])
q=cv2.copyMakeBorder(q,4,4,4,4,cv2.BORDER_CONSTANT,value=255)
W,H=640,480
k=min((H-80)//q.shape[0],(W-80)//q.shape[1])
big=cv2.resize(q,None,fx=k,fy=k,interpolation=cv2.INTER_NEAREST)
Y=np.full((H,W),255,np.uint8)
y0=(H-big.shape[0])//2; x0=(W-big.shape[1])//2
Y[y0:y0+big.shape[0],x0:x0+big.shape[1]]=big
U=np.full((H//2,W//2),128,np.uint8)
with open(sys.argv[2],'wb') as f:
  f.write(b'YUV4MPEG2 W%d H%d F15:1 Ip A1:1 C420mpeg2\\n'%(W,H))
  for _ in range(60):
    f.write(b'FRAME\\n'); f.write(Y.tobytes()); f.write(U.tobytes()); f.write(U.tobytes())
print('ok')`, 'https://my.facerinna.com/redeem.html?c='+A, y4m],{encoding:'utf8'});
  chk('a QR video stands in for the lens', (py.stdout||'').trim()==='ok' && fs.existsSync(y4m),
      (py.stderr||'').slice(0,200));

  if(fs.existsSync(y4m)){
    S.seen=[]; S.spent={};
    const bc=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader',
      '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
      '--use-file-for-fake-video-capture='+y4m]});
    const c=await bc.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,permissions:['camera']});
    /* the vendored decoder, not the browser's: a counter phone without
       BarcodeDetector is the case this file ships jsQR for */
    await c.addInitScript(WAKE_STUB);
    await c.addInitScript(([a,t])=>{ window.__BOOTH_API=a; try{ delete window.BarcodeDetector; }catch(e){}
      try{ localStorage.setItem('fx.admin.token', t); }catch(e){} }, [API, TOKEN]);
    const p=await c.newPage();
    const errs=[]; p.on('pageerror',e=>errs.push(e.message));
    await p.goto(BASE+'/scan.html',{waitUntil:'domcontentloaded'});
    await until(()=>p.evaluate(()=>!!window.__scan).catch(()=>false));

    chk('the loop is armed the moment the camera opens',
        await until(()=>p.evaluate(()=>window.__scan.looking()===true), 5000));
    /* With the loop unarmed this stays at nought however long the code is
       held up: a live picture nothing ever reads. */
    chk('...and frames go through the decoder, not just onto the screen',
        await until(()=>p.evaluate(()=>window.__scan.looks()>=1), 6000),
        await p.evaluate(()=>window.__scan.looks()));
    /* Headless Chromium refuses a real screen lock, so the lock here is a
       stand-in: what is under test is that the counter asks for one the
       moment the camera opens. A phone that locks itself between visitors is
       a counter typing a passcode instead of scanning. */
    chk('the screen is held awake while the camera is the thing on it',
        await until(()=>p.evaluate(()=>window.__scan.awake()===true && window.__wake.asked===1), 5000),
        await p.evaluate(()=>window.__wake));

    chk('the first visitor of the day is read without a soul touching the page',
        await until(()=>vis(p,'wheelWrap'), 15000), S.seen.map(x=>x.action));
    chk('...and it is the claim that was on the code, spent once',
        S.seen.filter(x=>x.action==='admin.gift.redeem').length===1
        && S.seen.some(x=>x.claim===A), S.seen);
    chk('the wheel lands where the script said',
        await until(()=>p.evaluate(()=>!window.__scan.spinning()), 12000)
        && await p.evaluate(()=>window.__scan.landed())===3);

    /* The same code is still in front of the lens. Pressing on reads it
       again -- that is the counter's own doing -- and what matters is that
       the visitor does not walk away with a second gift. */
    await p.evaluate(()=>window.__scan.next());
    chk('a code already spent comes back as spent, not as another gift',
        await until(async()=>/already redeemed/i.test(await txt(p,'resTitle')), 12000),
        await txt(p,'resTitle'));
    chk('...and the script was never asked to hand out a second one',
        S.seen.filter(x=>x.action==='admin.gift.redeem' && x.claim===A).length>=1
        && Object.keys(S.spent).length===1, S.spent);

    chk('no page errors', errs.length===0, errs[0]);
    await c.close(); await bc.close();
  }
}

await b.close(); await new Promise(r=>srv.close(r));
console.log(bad? '\nSOMETHING IS WRONG' : '\none sign-in, then one visitor after another');
process.exit(bad?1:0);
