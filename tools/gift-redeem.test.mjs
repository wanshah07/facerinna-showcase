/* The page the admin's phone opens by scanning a Facy Run QR code.

   Driven against a stand-in admin script. What is under test is that the
   page never chooses: it hands the claim to the script, the script answers
   with the product and the slice, and the wheel lands on that slice -- and
   that a phone that is not signed in, a code already spent, and a code that
   does not exist each get the right screen rather than a spin. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8139, BASE='http://127.0.0.1:'+PORT, API=BASE+'/api';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, ms=8000, step=100){ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(step);} return fn(); }
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript'};

const PRODUCTS=['Niacinamide Brightening Serum Sunscreen SPF50 PA++++','2% Salicylic Acid Acne Serum',
  'Ceramide B5 Balancing Moisturizer','5% B5 Centella Calming Gel Cream','Low pH B5 Gel Cleanser',
  'Ceramide B5 Balancing Toner','10% Niacinamide 3% TXA Bright Dark Spot Serum','5% B5 Intensive Barrier Cream'];
const TOKEN='11111111-1111-4111-8111-111111111111';
const CLAIM='22222222-2222-4222-8222-222222222222', SPENT='33333333-3333-4333-8333-333333333333';
const S={ pick:5, seen:[], redeemed:{} };
const srv=http.createServer((req,res)=>{
  const u=new URL(req.url,BASE);
  if(u.pathname==='/api'){
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
      let b={}; try{ b=JSON.parse(body||'{}'); }catch(e){}
      S.seen.push(b);
      let out={ok:false,error:'unknown action'};
      if(b.action==='admin.gift.redeem'){
        if(b.token!==TOKEN) out={ok:false,error:'signed out'};
        else if(b.claim===CLAIM){
          if(S.redeemed[CLAIM]) out={ok:true,already:true,product:PRODUCTS[S.pick],index:S.pick,products:PRODUCTS,at:'2026-09-19T10:00:00Z',score:6400,name:'Ahmad'};
          else { S.redeemed[CLAIM]=true; out={ok:true,already:false,product:PRODUCTS[S.pick],index:S.pick,products:PRODUCTS,score:6400,name:'Ahmad'}; }
        } else if(b.claim===SPENT) out={ok:true,already:true,product:PRODUCTS[2],index:2,products:PRODUCTS,at:'2026-09-18T15:30:00Z',score:7100,name:'Lena'};
        else out={ok:false,error:'no such claim'};
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

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
async function open_(query, token){
  const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await c.addInitScript(([a,t])=>{ window.__BOOTH_API=a; try{ if(t) localStorage.setItem('fx.admin.token',t); }catch(e){} }, [API, token||'']);
  const p=await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/redeem.html'+query,{waitUntil:'load'});
  await p.waitForTimeout(300);
  return {c,p,errs};
}
const vis=(p,id)=>p.evaluate(i=>{ const e=document.getElementById(i); return !!e && !e.classList.contains('hidden'); }, id);
const txt=(p,id)=>p.evaluate(i=>document.getElementById(i).textContent.trim(), id);

console.log('a phone that is not signed in');
{
  const {c,p,errs}=await open_('?c='+CLAIM, '');
  chk('is told to sign in, and nothing is spent', await vis(p,'signin') && !(await vis(p,'wheelWrap')) && S.seen.length===0, S.seen);
  chk('...with a way to the admin', await p.$eval('#signin a', a=>a.getAttribute('href'))==='admin.html');
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}
console.log('\na sign-in the script no longer honours');
{
  const {c,p,errs}=await open_('?c='+CLAIM, 'stale-token');
  chk('is sent to sign in again, not to an error', await until(()=>vis(p,'signin')) && !(await vis(p,'oops')));
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}
console.log('\na signed-in phone scanning a fresh claim');
{
  S.seen=[]; S.redeemed={};
  const {c,p,errs}=await open_('?c='+CLAIM, TOKEN);
  chk('the wheel comes up', await until(()=>vis(p,'wheelWrap')));
  chk('...with every product the script listed on it', await p.evaluate(()=>window.__redeem.products().length)===PRODUCTS.length);
  chk('...spinning', await p.evaluate(()=>window.__redeem.spinning()));
  chk('the page sent the claim and the token, and nothing that could steer the pick',
      S.seen.length===1 && S.seen[0].claim===CLAIM && S.seen[0].token===TOKEN && !('product' in S.seen[0]) && !('index' in S.seen[0]), S.seen[0]);
  chk('it lands where the script said', await until(()=>p.evaluate(()=>!window.__redeem.spinning()), 9000) && await p.evaluate(()=>window.__redeem.landed())===S.pick);
  /* the geometry: slice `pick` is under the pin at the top once the wheel stops */
  const geo=await p.evaluate(()=>{ const n=window.__redeem.products().length, a=window.__redeem.angle(), slice=2*Math.PI/n;
    const norm=((a%(2*Math.PI))+2*Math.PI)%(2*Math.PI); const under=Math.round(((2*Math.PI-norm)%(2*Math.PI))/slice)%n; return {under, n}; });
  chk('...and the slice under the pin is that one', geo.under===S.pick, geo);
  chk('the card names the product and says the code is now spent',
      await vis(p,'result') && (await txt(p,'prize'))===PRODUCTS[S.pick] && /spent/i.test(await txt(p,'resText')), await txt(p,'resText'));
  chk('...and who it was', /Ahmad/.test(await txt(p,'resMeta')) && /6400/.test(await txt(p,'resMeta')));
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}
console.log('\nthe same code scanned again');
{
  S.seen=[];
  const {c,p,errs}=await open_('?c='+CLAIM, TOKEN);
  chk('gets no spin', await until(()=>vis(p,'result')) && !(await vis(p,'wheelWrap')));
  chk('...but a receipt: the same product, marked already redeemed',
      (await txt(p,'prize'))===PRODUCTS[S.pick] && /Already redeemed/i.test(await txt(p,'resTitle')) && /second/i.test(await txt(p,'resText')), await txt(p,'resTitle'));
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}
console.log('\na code the sheet has never seen');
{
  const {c,p,errs}=await open_('?c=44444444-4444-4444-8444-444444444444', TOKEN);
  chk('is refused in words, with no wheel', await until(()=>vis(p,'oops')) && /no such claim/i.test(await txt(p,'oopsText')) && !(await vis(p,'wheelWrap')));
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}
console.log('\nno code at all');
{
  const {c,p,errs}=await open_('', TOKEN);
  chk('says to scan one, and asks the script nothing', await until(()=>vis(p,'oops')) && /scan/i.test(await txt(p,'oopsText')));
  chk('no page errors', errs.length===0, errs[0]);
  await c.close();
}

await b.close(); await new Promise(r=>srv.close(r));
console.log(bad? '\nSOMETHING IS WRONG' : '\nthe wheel lands where the script says, once');
process.exit(bad?1:0);
