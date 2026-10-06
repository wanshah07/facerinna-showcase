/* The Lucky Wheel: the script side and the page.

   Script: anybody may spin, once per device, while the gift is on; the script
   picks from what is in stock and takes the unit off the count at the spin; a
   device that already holds a code from any game gets that code, not a spin;
   the counter's scan hands the won product over without a second pick or a
   second unit; a reset of a spin never collected puts the unit back; gift off,
   game off and empty stock all say so.
   Page: the wheel lands on the slice the script chose, the QR carries the
   code, and every answer that is not a spin says what to do. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { load, OWNER } from './booth-admin-harness.mjs';
const {chromium}=pkg;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++; console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, ms=12000, step=100){ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(step);} return fn(); }

const H = load(), own = H.signIn(OWNER), A = o => H.call({ token:own.token, ...o });
H.tabs['Gift stock'].rows.slice(1).map(r=>r[0]).filter(Boolean).forEach(p=>A({ action:'admin.stock.remove', product:p }));
A({ action:'admin.stock.set', product:'Ceramide Moisturizer', quantity:2 });
A({ action:'admin.stock.set', product:'B5 Toner', quantity:1 });
A({ action:'admin.stock.set', product:'Centella Gel', quantity:50 });
const qty = p => { const r=H.tabs['Gift stock'].rows.find(x=>x[0]===p); return r ? r[1] : undefined; };
const spin = (device, name='Aina') => H.call({ action:'gift.spin', device, name });

console.log('the script');
{
  let r = spin('lwdevice001');
  chk('gift off: no spin, and it says why', r.ok===false && r.reason==='inactive', r);
  A({ action:'admin.settings', settings:{ gift_active:'yes' } });
  chk('a bad device id is refused', spin('x').reason==='device');
  r = spin('lwdevice001');
  chk('a spin: a code, a product from the wheel, and the slice it is on', r.ok && /^[0-9a-f-]{36}$/.test(r.claim) && r.products[r.index]===r.product && r.products.length===3, r);
  const row = H.tabs['Gifts'].rows.find(x=>x[0]===r.claim);
  chk('...written as a Lucky Wheel code with its product, not yet handed over', row && row[2]==='lucky-wheel' && row[7]===r.product && !row[6], row);
  const before = { c:qty('Ceramide Moisturizer'), t:qty('B5 Toner') };
  chk('...and the unit is off the count at the spin', r.product==='Centella Gel' ? qty('Centella Gel')===49 : r.product==='Ceramide Moisturizer' ? before.c===1 : before.t===0, { product:r.product, before, centella:qty('Centella Gel') });
  const again = spin('lwdevice001');
  chk('the same device again: the same code and product, no second spin', again.ok && again.already && again.claim===r.claim && again.product===r.product && again.products[again.index]===r.product, again);
  /* the counter */
  const t0 = { c:qty('Ceramide Moisturizer'), t:qty('B5 Toner') };
  const red = A({ action:'admin.gift.redeem', claim:r.claim, attempt:'attemptAAAA1111' });
  chk('the counter\'s scan hands over the product the visitor won, no second pick', red.ok && !red.already && red.product===r.product && red.products[red.index]===r.product && red.spun===true, red);
  chk('...and takes nothing more off the count', qty('Ceramide Moisturizer')===t0.c && qty('B5 Toner')===t0.t);
  chk('...the row is marked handed over, by whom', (()=>{ const x=H.tabs['Gifts'].rows.find(x=>x[0]===r.claim); return x[6] && x[8]===OWNER && x[7]===r.product; })());
  const twice = A({ action:'admin.gift.redeem', claim:r.claim, attempt:'attemptBBBB2222' });
  chk('a second scan of it is "already redeemed"', twice.ok && twice.already===true && twice.product===r.product, twice);
  const lost = A({ action:'admin.gift.redeem', claim:r.claim, attempt:'attemptAAAA1111' });
  chk('...while the same scan asking again (its answer lost) gets the same hand-over', lost.ok && !lost.already && lost.again===true, lost);
  chk('the spin of a device that has collected says so', spin('lwdevice001').redeemed===true);
}
{
  /* a device that earned a code in a game */
  A({ action:'admin.settings', settings:{ gift_points:'facy-run = 100' } });
  const g = H.call({ action:'gift.claim', device:'lwdevice002', score:500, game:'facy-run', name:'Raj' });
  const r = spin('lwdevice002');
  chk('a device holding a code from a game is handed that code, not a spin', r.ok && r.other==='facy-run' && r.claim===g.claim && !r.product, r);
  /* and the other way: a spin first, then a game */
  const s = spin('lwdevice003');
  const g2 = H.call({ action:'gift.claim', device:'lwdevice003', score:500, game:'facy-run', name:'Mei' });
  chk('a device that spun, then finishes a game, gets its spin\'s code back: one gift per device', g2.ok && g2.claim===s.claim && g2.product===s.product, { s, g2 });
}
{
  /* reset a spin never collected: its unit goes back */
  let r, dev, n=10;
  do { dev='lwreset'+(n++); r=spin(dev); } while(r.ok && r.product==='Centella Gel' && n<60);
  const q0 = qty(r.product);
  const x = A({ action:'admin.claims.reset', device:dev });
  chk('"Let play again" on a spin never collected puts its unit back in stock', x.ok && x.returned===1 && qty(r.product)===q0+1, { x, q0, now:qty(r.product), product:r.product });
  const after = spin(dev);
  chk('...and the device may spin again', after.ok && !after.already && after.claim!==r.claim, after);
}
{
  /* run the small ones dry */
  for(let i=0;i<12;i++) spin('lwdry'+String(i).padStart(3,'0'));
  chk('a counted product never goes below zero', ['Ceramide Moisturizer','B5 Toner','Centella Gel'].every(p=>+qty(p)>=0), [qty('Ceramide Moisturizer'), qty('B5 Toner')]);
  ['Ceramide Moisturizer','B5 Toner','Centella Gel'].forEach(p=>A({ action:'admin.stock.set', product:p, quantity:0 }));
  const r = spin('lwdryzzz1');
  chk('nothing left in stock: no spin, and it says why', r.ok===false && r.reason==='nostock', r);
  A({ action:'admin.stock.set', product:'B5 Toner', quantity:5 });
  A({ action:'admin.settings', settings:{ games_off:'lucky-wheel' } });
  chk('the game switched off: no spin', spin('lwoff00001').reason==='gameoff');
  A({ action:'admin.settings', settings:{ games_off:'' } });
  chk('the admin\'s game list has the Lucky Wheel', A({ action:'admin.get' }).games.some(g=>g[0]==='lucky-wheel'));
  chk('nothing was left unflushed under the lock', H.SHEETS.unflushedReleases===0, H.SHEETS.unflushedReleases);
}

console.log('\nthe page');
const ROOT='/workspace/facerinna-showcase', PORT=8380+Math.floor(Math.random()*40), BASE='http://127.0.0.1:'+PORT, API=BASE+'/api';
let mode='ok';
const srv=http.createServer((req,res)=>{
  const u=new URL(req.url,BASE);
  if(u.pathname==='/api'){ let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
    let out; const b=JSON.parse(body||'{}');
    if(mode==='busy2' && b.action==='gift.spin'){ mode='ok'; out={ok:false,reason:'busy'}; }
    else if(mode==='down'){ res.writeHead(503); res.end('down'); return; }
    else out=H.call(b);
    res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(out)); }); return; }
  let f=decodeURIComponent(u.pathname); const fp=path.join(ROOT,f);
  if(f==='/sw.js'||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':f.endsWith('.html')?'text/html; charset=utf-8':f.endsWith('.js')?'text/javascript':f.endsWith('.webp')?'image/webp':'application/octet-stream'}); res.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch();
const open=async(vp,device)=>{
  const c=await b.newContext({ viewport:vp, isMobile:vp.width<700, hasTouch:true });
  await c.addInitScript(([a,d])=>{ window.__BOOTH_API=a; window.__LW_FAST=1; try{ if(d) localStorage.setItem('fx.device',d); localStorage.setItem('fx.player','Tester'); }catch(e){} }, [API, device]);
  await c.route(u=>!u.href.startsWith(BASE), r=>r.abort());
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/lucky-wheel.html',{waitUntil:'load'}); await sleep(300);
  return {c,p,errs};
};
const look=p=>p.evaluate(()=>({ stage:window.__lw.stage(), product:window.__lw.product(), landed:window.__lw.landed(), products:window.__lw.products(),
  title:document.getElementById('lwTitle').textContent, text:document.getElementById('lwText').textContent,
  qr:getComputedStyle(document.getElementById('lwQR')).display!=='none', code:document.getElementById('lwCode').textContent,
  btn:getComputedStyle(document.getElementById('lwSpin')).display!=='none' && !document.getElementById('lwSpin').disabled }));
for(const [tag,vp] of [['phone',{width:390,height:844}],['tablet',{width:820,height:1180}]]){
  A({ action:'admin.stock.set', product:'B5 Toner', quantity:20 });
  const dev='lwpage'+tag;
  const {c,p,errs}=await open(vp,dev);
  chk(`${tag}: the Spin button is there`, (await look(p)).btn);
  await p.click('#lwSpin');
  await until(()=>p.evaluate(()=>window.__lw.stage()==='won'), 15000);
  let s=await look(p);
  const row=H.tabs['Gifts'].rows.find(x=>x[1]===dev && !x[9]);
  chk(`${tag}: the wheel lands on the product the script chose`, s.stage==='won' && row && s.product===row[7] && s.products[s.landed]===row[7], { s, row });
  chk(`${tag}: ...says what was won and shows the code to scan`, s.title.includes(row[7]) && s.qr && s.code===row[0], s);
  const fit=await p.evaluate(()=>({ sw:document.documentElement.scrollWidth, w:innerWidth }));
  chk(`${tag}: nothing runs off the screen`, fit.sw<=fit.w+1, fit);
  await p.reload({waitUntil:'load'}); await sleep(400);
  await p.click('#lwSpin'); await until(()=>p.evaluate(()=>window.__lw.stage()==='won'), 15000);
  s=await look(p);
  chk(`${tag}: spinning again on the same phone shows the same prize and code`, s.product===row[7] && s.code===row[0] && /already/i.test(s.text), s);
  chk(`${tag}: no page errors`, errs.length===0, errs[0]);
  await c.close();
}
{
  /* busy once: it asks again by itself */
  mode='busy2';
  const {c,p,errs}=await open({width:390,height:844},'lwbusy001');
  await p.click('#lwSpin');
  chk('a busy script: it asks again and still lands', await until(()=>p.evaluate(()=>window.__lw.stage()==='won'), 20000));
  await c.close();
}
{
  /* the script cannot be reached */
  mode='down';
  const {c,p}=await open({width:390,height:844},'lwdown001');
  await p.click('#lwSpin');
  await until(()=>p.evaluate(()=>window.__lw.stage()==='error'), 20000);
  const s=await look(p);
  chk('no connection: says so, and the button is back for another go', s.stage==='error' && /connection|reach/i.test(s.title+s.text) && s.btn, s);
  mode='ok'; await c.close();
}
{
  /* gift off / sold out / a code from another game */
  A({ action:'admin.settings', settings:{ gift_active:'no' } });
  let {c,p}=await open({width:390,height:844},'lwinactive1'); await p.click('#lwSpin');
  await until(()=>p.evaluate(()=>window.__lw.stage()!=='spinning'), 10000);
  chk('gifts off: the wheel says the gifts are not on, no code', /not on/i.test((await look(p)).title) && !(await look(p)).qr);
  await c.close(); A({ action:'admin.settings', settings:{ gift_active:'yes' } });
  const g=H.call({ action:'gift.claim', device:'lwgame0001', score:500, game:'facy-run', name:'Siti' });
  ({c,p}=await open({width:390,height:844},'lwgame0001')); await p.click('#lwSpin');
  await until(()=>p.evaluate(()=>window.__lw.stage()!=='spinning'), 10000);
  const s=await look(p);
  chk('a phone that earned a code in a game: shown that code, told one gift per phone', s.qr && s.code===g.claim && /one gift per phone/i.test(s.text), s);
  await c.close();
}
await b.close(); srv.close();
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad?1:0);
