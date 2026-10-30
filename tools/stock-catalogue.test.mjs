/* Every FACERINNA product is on the Gift stock list by itself, with its picture, and every
   product that is not out of stock is on the Lucky Wheel before anybody spins.

   Three things have to hold: the list in booth-admin.gs is the catalogue in index.html and
   each name finds its picture the way the wheel finds it; the script puts each catalogue
   product on the list once, not counted, never brings back one an admin removed, and tells
   the visitor's page what is on the wheel; and the two pages draw it. */
import pkg from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { load, OWNER } from './booth-admin-harness.mjs';
import { ROOT } from './paths.mjs';
const {chromium}=pkg;
const PORT=8201, BASE='http://127.0.0.1:'+PORT, API=BASE+'/api';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, ms=8000, step=80){ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(step);} return fn(); }
const slug = n => String(n).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

console.log('the catalogue, the script and the pictures agree');
const gs = fs.readFileSync(ROOT+'tools/booth-admin.gs','utf8');
const html = fs.readFileSync(ROOT+'index.html','utf8');
const gsNames = ((gs.match(/var CATALOGUE = \[([\s\S]*?)\];/)||[])[1]||'').match(/'([^']+)'/g).map(x=>x.slice(1,-1));
const pageBlock = html.slice(html.indexOf('const PRODUCTS = ['), html.indexOf('];', html.indexOf('const PRODUCTS = [')));
const pageNames = [...pageBlock.matchAll(/\{name:"([^"]+)"/g)].map(m=>m[1]);
chk('the script lists the same products as the page, in the same order', JSON.stringify(gsNames)===JSON.stringify(pageNames), { gs:gsNames.length, page:pageNames.length });
chk('nineteen of them', gsNames.length===19, gsNames.length);
chk('every one has a picture under the name the wheel looks for', gsNames.every(n=>fs.existsSync(ROOT+'products/'+slug(n)+'.webp')),
  gsNames.filter(n=>!fs.existsSync(ROOT+'products/'+slug(n)+'.webp')));
chk('...and the page itself points at that same file', [...pageBlock.matchAll(/\{name:"([^"]+)"[^}]*?img:"products\/([^"]+)\.webp"/g)].every(m=>slug(m[1])===m[2]));

console.log('\nthe stock list fills itself');
const H = load({ catalogue:true }), own = H.signIn(OWNER), A = o => H.call({ token:own.token, ...o });
const stockRows = () => H.tabs['Gift stock'].rows.slice(1).filter(r=>r[0]);
let g = A({ action:'admin.get' });
chk('opening the admin lists every catalogue product, none counted',
  g.stock.length===19 && gsNames.every(n=>g.stock.filter(x=>x.product===n).length===1) && g.stock.every(x=>x.quantity===null && x.on_wheel), g.stock.map(x=>x.product));
chk('the first eight came from the old product list, the rest from the catalogue',
  g.stock.filter(x=>/before stock/.test(x.by)).length===8 && g.stock.filter(x=>x.by==='product catalogue').length===11);
const n0 = stockRows().length; A({ action:'admin.get' });
chk('asking again adds nothing', stockRows().length===n0);

console.log('\nwhat an admin has done is left alone');
A({ action:'admin.stock.set', product:'Ceramide B5 Balancing Moisturizer', quantity:0 });
A({ action:'admin.stock.set', product:'5% B5 Centella Calming Gel Cream', quantity:101 });
A({ action:'admin.stock.set', product:'A product typed by hand', quantity:7 });
A({ action:'admin.stock.remove', product:'Retinol Anti-Aging Serum' });
g = A({ action:'admin.get' });
const by = n => g.stock.find(x=>x.product===n);
chk('a count she set stays', by('5% B5 Centella Calming Gel Cream').quantity===101 && by('Ceramide B5 Balancing Moisturizer').quantity===0);
chk('a product removed is not brought back', !by('Retinol Anti-Aging Serum'));
chk('a product that is not in the catalogue stays', by('A product typed by hand')?.quantity===7);
chk('the list is the 19, less the one removed, plus the one typed', g.stock.length===19);

console.log('\nthe wheel the visitor sees');
const wheelNow = () => H.call({ action:'gift.wheel' });
let w = wheelNow();
chk('anybody can ask what is on the wheel', w.ok===true && Array.isArray(w.products), w);
chk('...it is every product that is not out of stock', JSON.stringify(w.products)===JSON.stringify(g.stock.filter(x=>x.on_wheel).map(x=>x.product)), w.products);
chk('...the one at 0 is not on it, the removed one is not on it', !w.products.includes('Ceramide B5 Balancing Moisturizer') && !w.products.includes('Retinol Anti-Aging Serum'));
chk('...and no count is given away', !JSON.stringify(w).match(/"quantity"|101/));
A({ action:'admin.stock.set', product:'Ceramide B5 Balancing Moisturizer', quantity:3 });
chk('restocking puts it back on at once, not after the cache runs out', wheelNow().products.includes('Ceramide B5 Balancing Moisturizer'));
A({ action:'admin.stock.set', product:'A product typed by hand', quantity:0 });
chk('running out takes it off at once', !wheelNow().products.includes('A product typed by hand'));
A({ action:'admin.settings', settings:{ gift_active:'yes' } });
const sp = H.call({ action:'gift.spin', device:'catalogue01', name:'Aina' });
chk('a spin lands on a slice of that same wheel', sp.ok && JSON.stringify(sp.products)===JSON.stringify(wheelNow().products) && sp.products[sp.index]===sp.product, sp);

console.log('\nthe two pages');
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.webmanifest':'application/manifest+json'};
const srv=http.createServer((req,res)=>{
  const u=new URL(req.url,BASE);
  if(u.pathname==='/api'){
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
      let out; try{ out=H.call(JSON.parse(body||'{}')); }catch(e){ out={ok:false,error:String(e.message)}; }
      res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(out));
    }); return;
  }
  let f=decodeURIComponent(u.pathname); if(f.endsWith('/')) f+='index.html';
  if(f==='/sw.js'){ res.writeHead(404); res.end(); return; }
  const fp=path.join(ROOT,f);
  if(!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});
  res.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch();
{
  const c=await b.newContext({viewport:{width:1280,height:900}});
  await c.addInitScript(([a,t])=>{ window.__BOOTH_API=a; try{ localStorage.setItem('fx.admin.token',t); }catch(e){} }, [API, own.token]);
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/admin.html',{waitUntil:'load'});
  await until(()=>p.evaluate(()=>!document.getElementById('app').hidden));
  await p.click('#tabGifts');
  await until(()=>p.evaluate(()=>document.querySelectorAll('#stockList .stock').length>=19));
  await sleep(600);
  const cards = await p.evaluate(()=>[...document.querySelectorAll('#stockList .stock')].map(c=>({
    name:c.dataset.product, img:!!c.querySelector('img.pic'), loaded:!!(c.querySelector('img.pic')&&c.querySelector('img.pic').naturalWidth>0), ph:!!c.querySelector('.pic.none') })));
  chk('the Gifts tab shows every product, 19 cards', cards.length===19, cards.length);
  chk('every catalogue product shows its own picture, loaded', cards.filter(x=>gsNames.includes(x.name)).every(x=>x.loaded), cards.filter(x=>gsNames.includes(x.name)&&!x.loaded));
  chk('one that has no picture shows a gift mark, not a broken image', cards.filter(x=>!gsNames.includes(x.name)).every(x=>x.ph && !x.img), cards.filter(x=>!gsNames.includes(x.name)));
  chk('the tab says how many are on the wheel', await p.evaluate(()=>/\d+ of 19 on the wheel/.test(document.getElementById('stockList').textContent)));
  chk('no page errors (admin)', errs.length===0, errs);
  await c.close();
}
{
  const c=await b.newContext({viewport:{width:390,height:800}});
  await c.addInitScript(a=>{ window.__BOOTH_API=a; window.__LW_FAST=true; }, API);
  const p=await c.newPage(); const errs=[], pics=[]; p.on('pageerror',e=>errs.push(e.message));
  p.on('requestfinished', r=>{ const m=r.url().match(/products\/([^/]+)\.webp$/); if(m) pics.push(m[1]); });
  await p.goto(BASE+'/lucky-wheel.html',{waitUntil:'load'});
  const want = wheelNow().products;
  await until(()=>p.evaluate(()=>window.__lw.products().length>0));
  chk('before any spin the wheel holds every product that is in stock', JSON.stringify(await p.evaluate(()=>window.__lw.products()))===JSON.stringify(want), want.length);
  await until(()=>Promise.resolve(want.filter(n=>slug(n)).every(n=>pics.includes(slug(n))||!gsNames.includes(n))), 6000);
  chk('...and fetched each one\'s picture', want.filter(n=>gsNames.includes(n)).every(n=>pics.includes(slug(n))), want.filter(n=>gsNames.includes(n)&&!pics.includes(slug(n))));
  chk('...and nothing for the product that is out of stock', !pics.includes(slug('A product typed by hand')));
  chk('no page errors (wheel)', errs.length===0, errs);
  await c.close();
}
await b.close(); srv.close();
console.log(bad ? '\n'+bad+' FAILED' : '\nall passed');
process.exit(bad?1:0);
