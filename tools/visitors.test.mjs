/* The Visitors tab, end to end against the real booth-admin script (Google
   stubbed, the Worker stubbed): the script only asks the Worker with its key
   and passes on the five filters; a staff member without the area gets no tab
   and no answer; the page draws the tiles, the chart, the state map and the
   tables from one answer; clicking a state asks again with that state; the
   CSV comes down; and with no properties set the tab says how to set it up. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { load, OWNER } from './booth-admin-harness.mjs';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8300+Math.floor(Math.random()*50), BASE='http://127.0.0.1:'+PORT, API=BASE+'/api';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++; console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, ms=15000, step=100){ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(step);} return fn(); }

const H = load();
const now = Date.now(), day = ms => new Date(ms + 8*3600e3).toISOString().slice(0,10);
const STATS = {
  ok:true, at: now, bucketMs: 86400000, first: now - 3*86400e3,
  totals:{views:1234, visitors:567}, live:{views:3, visitors:2},
  series:[{t: now-2*86400e3, views:300, visitors:140},{t: now-86400e3, views:500, visitors:220},{t: now, views:434, visitors:207}],
  byCountry:[{k:'MY',views:1100,visitors:500},{k:'SG',views:100,visitors:50},{k:'US',views:34,visitors:17}],
  byState:[{k:'Selangor',views:400,visitors:180},{k:'Kuala Lumpur',views:300,visitors:140},{k:'Penang',views:200,visitors:90},{k:'Johor',views:150,visitors:70},{k:'Malacca',views:50,visitors:20}],
  byCity:[{k:'Petaling Jaya',state:'Selangor',country:'MY',views:220,visitors:100}],
  byPath:[{k:'/',views:800,visitors:500},{k:'/lucky-wheel.html',views:300,visitors:200},{k:'/privacy.html',views:134,visitors:90}],
  byRef:[{k:'instagram.com',views:400,visitors:200},{k:'tiktok.com',views:100,visitors:60}],
  byDevice:[{k:'phone',views:1000,visitors:480},{k:'desktop',views:234,visitors:87}],
  byBrowser:[{k:'Chrome',views:900,visitors:400},{k:'Safari',views:334,visitors:167}],
  byOs:[{k:'Android',views:700,visitors:300},{k:'iOS',views:534,visitors:267}],
  recent:[{ts:now-60000,path:'/',ref:'instagram.com',country:'MY',state:'Selangor',city:'Shah Alam',device:'phone',browser:'Chrome'}]
};
H.FETCH.answer = (url) => /\/export\.csv/.test(url) ? {code:200, text:'time_myt,day,path\n2026-10-29 12:00:00,2026-10-29,/\n'} : {code:200, text: JSON.stringify(STATS)};

const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp'};
const srv=http.createServer((req,res)=>{
  const u=new URL(req.url,BASE);
  if(u.pathname==='/api'){ let body=''; req.on('data',c=>body+=c); req.on('end',()=>{ let out; try{ out=H.call(JSON.parse(body||'{}')); }catch(e){ out={ok:false,error:String(e.message)}; }
    res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(out)); }); return; }
  let f=decodeURIComponent(u.pathname); if(f.endsWith('/')) f+='index.html';
  const fp=path.join(ROOT,f);
  if(f==='/sw.js'||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'}); res.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch();
async function asPerson(token){
  const c=await b.newContext({viewport:{width:1280,height:900}, acceptDownloads:true});
  await c.addInitScript(([a,t])=>{ window.__BOOTH_API=a; try{ localStorage.setItem('fx.admin.token',t); }catch(e){} }, [API, token]);
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/admin.html',{waitUntil:'load'});
  await until(()=>p.evaluate(()=>!document.getElementById('app').hidden));
  await sleep(300); return {c,p,errs};
}
const own = H.signIn(OWNER);
const visibleTabs = p => p.evaluate(()=>[...document.querySelectorAll('.tab')].filter(t=>!t.hidden).map(t=>t.dataset.view));

console.log('── the script');
{
  const r = H.call({action:'admin.visitors', token: own.token, q:{from:1, to:2, country:'my', state:'Selangor', path:'/', evil:'x'}});
  chk('with no properties the script says the counter is not set up', r.ok===false && r.setup===true && /VISITORS_URL/.test(r.error), r);
  chk('...and did not call out at all', H.FETCH.calls.length===0);
  H.PROPS.VISITORS_URL='https://facerinna-visitors.example.workers.dev/'; H.PROPS.VISITORS_KEY='k-secret';
  const r2 = H.call({action:'admin.visitors', token: own.token, q:{from:1, to:2, country:'my', state:'Selangor', path:'/', evil:'x'}});
  const call = H.FETCH.calls[0];
  chk('set up, it asks the Worker /stats with the key', r2.ok===true && call && /^https:\/\/facerinna-visitors\.example\.workers\.dev\/stats\?/.test(call.url) && call.opts.headers.Authorization==='Bearer k-secret', call && call.url);
  chk('...passing the five filters and nothing else', call && call.url.includes('from=1&to=2&country=my&state=Selangor&path=%2F') && !/evil/.test(call.url), call && call.url);
  chk('...and hands the page the stats', r2.stats && r2.stats.totals.views===1234);
  const before = H.FETCH.calls.length; H.FETCH.answer = {code:401, text:'{"ok":false,"error":"no key"}'};
  const r3 = H.call({action:'admin.visitors', token: own.token, q:{}});
  chk('a 401 from the Worker reads as the key not matching', r3.ok===false && /401/.test(r3.error) && /key/.test(r3.error), r3);
  H.FETCH.answer = (url) => /\/export\.csv/.test(url) ? {code:200, text:'time_myt,day,path\n2026-10-29 12:00:00,2026-10-29,/\n'} : {code:200, text: JSON.stringify(STATS)};
  const csv = H.call({action:'admin.visitors.csv', token: own.token, q:{from:1}});
  chk('the CSV comes back as text', csv.ok===true && /^time_myt/.test(csv.csv) && /\/export\.csv\?from=1$/.test(H.FETCH.calls[H.FETCH.calls.length-1].url), csv);
  chk('the owner is told the counter is configured in admin.get', H.call({action:'admin.get', token: own.token}).visitors.configured===true);
  /* a staff member without the area */
  H.call({action:'admin.team.save', token: own.token, person:{ email:'aina@facerinna.test', name:'Aina', role:'staff', access:['counter'] }});
  const aina = H.signIn('aina@facerinna.test');
  const r4 = H.call({action:'admin.visitors', token: aina.token, q:{}});
  chk('staff without the area are refused', r4.ok===false && /Visitors|visitors|access/.test(r4.error), r4);
  chk('...and admin.get does not mention the counter to them', !('visitors' in H.call({action:'admin.get', token: aina.token})));
  H.call({action:'admin.team.save', token: own.token, person:{ email:'aina@facerinna.test', name:'Aina', role:'staff', access:['counter','visitors'] }});
  chk('ticking Visitors lets them read it', H.call({action:'admin.visitors', token: aina.token, q:{}}).ok===true);
}

console.log('── the page');
{
  const {c,p,errs}=await asPerson(own.token);
  chk('the owner has the Visitors tab', (await visibleTabs(p)).includes('visitors'));
  const callsBefore = H.FETCH.calls.length;
  await p.click('#tabVisitors');
  chk('opening it asks the script once', await until(()=>H.FETCH.calls.length===callsBefore+1), H.FETCH.calls.length-callsBefore);
  chk('...for the last 7 days by default', /from=\d{13}&to=\d{13}$/.test(H.FETCH.calls[H.FETCH.calls.length-1].url), H.FETCH.calls[H.FETCH.calls.length-1].url);
  await until(()=>p.evaluate(()=>document.querySelectorAll('#visTiles .tile').length>0));
  const tiles = await p.evaluate(()=>[...document.querySelectorAll('#visTiles .tile')].map(t=>t.querySelector('.k').textContent.trim()+'='+t.querySelector('.v').textContent.trim()));
  chk('six tiles: visitors 567, views 1,234, live 2, top state Selangor, top country Malaysia, top page /', tiles.length===6 && /567/.test(tiles[0]) && /1,234/.test(tiles[1]) && /=2$/.test(tiles[2].replace(/\s/g,'')) && /Selangor/.test(tiles[3]) && /Malaysia/.test(tiles[4]) && /=\/$/.test(tiles[5]), tiles);
  chk('the chart drew a bar per day of the week and a line', await p.evaluate(()=>document.querySelectorAll('#visChart rect').length===7 && !!document.querySelector('#visChart polyline')), await p.evaluate(()=>document.querySelectorAll('#visChart rect').length));
  chk('the Malaysia map drew 16 states', await until(()=>p.evaluate(()=>document.querySelectorAll('#visMapMy path').length===16)), await p.evaluate(()=>document.querySelectorAll('#visMapMy path').length));
  const fills = await p.evaluate(()=>{ const o={}; document.querySelectorAll('#visMapMy path').forEach(x=>{ o[x.dataset.state]=x.getAttribute('fill'); }); return o; });
  chk('Selangor is darkest, Perlis is empty grey, Penang and Malacca found their shapes under their Malay names', fills['Selangor']!==fills['Perlis'] && fills['Perlis']==='#e9eef5' && fills['Penang'] && fills['Penang']!=='#e9eef5' && fills['Malacca'] && fills['Malacca']!=='#e9eef5', fills);
  chk('the world map drew and coloured Malaysia and the US, and gave Singapore a dot', await until(()=>p.evaluate(()=>document.querySelectorAll('#visMapWorld path').length>150 && ['MY','US'].every(iso=>{ const x=document.querySelector('#visMapWorld path[data-iso="'+iso+'"]'); return x && x.getAttribute('fill')!=='#e9eef5'; }) && !!document.querySelector('#visMapWorld circle[data-iso="SG"]'))), await p.evaluate(()=>[document.querySelectorAll('#visMapWorld path').length, !!document.querySelector('#visMapWorld circle[data-iso="SG"]')]));
  chk('the tables filled: states, countries, pages, came-from, recent', await p.evaluate(()=>['visTState','visTCountry','visTPath','visTRef','visTRecent'].every(id=>document.querySelectorAll('#'+id+' table tr').length>1)));
  /* click a state on the map */
  const n0 = H.FETCH.calls.length;
  await p.evaluate(()=>document.querySelector('#visMapMy path[data-state="Selangor"]').dispatchEvent(new MouseEvent('click',{bubbles:true})));
  chk('clicking Selangor asks again for Malaysia + Selangor', await until(()=>H.FETCH.calls.length>n0 && /country=MY&state=Selangor/.test(H.FETCH.calls[H.FETCH.calls.length-1].url)), H.FETCH.calls[H.FETCH.calls.length-1].url);
  chk('...and the selects show it', await until(()=>p.evaluate(()=>document.getElementById('visCountry').value==='MY' && document.getElementById('visState').value==='Selangor')));
  chk('...and the state is outlined on the map', await until(()=>p.evaluate(()=>document.querySelector('#visMapMy path[data-state="Selangor"]').classList.contains('sel'))));
  await p.selectOption('#visRange','today');
  chk('Today asks from the Malaysian midnight', await until(()=>{ const u=H.FETCH.calls[H.FETCH.calls.length-1].url; const m=u.match(/from=(\d+)/); return m && ((+m[1]+8*3600e3)%86400000===0); }), H.FETCH.calls[H.FETCH.calls.length-1].url);
  await p.click('#visClear');
  chk('Clear filters drops country, state and page', await until(()=>!/country=|state=|path=/.test(H.FETCH.calls[H.FETCH.calls.length-1].url)));
  /* CSV */
  const [dl] = await Promise.all([p.waitForEvent('download',{timeout:10000}), p.click('#visCsv')]);
  chk('CSV rows downloads a .csv named for the period', /^facerinna-visitors-rows-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const [dl2] = await Promise.all([p.waitForEvent('download',{timeout:10000}), p.click('#visCsvSummary')]);
  const txt = fs.readFileSync(await dl2.path(),'utf8');
  chk('the summary CSV carries the totals and the state table', /^FACERINNA website visitors/.test(txt) && /period,567,1234/.test(txt) && /Selangor,180,400/.test(txt), txt.slice(0,200));
  /* print styles: only the visitors view prints */
  await p.emulateMedia({media:'print'});
  const pr = await p.evaluate(()=>({ head: getComputedStyle(document.getElementById('visPrintHead')).display, tools: getComputedStyle(document.querySelector('.vistools')).display, tabs: getComputedStyle(document.querySelector('.tabs')).display, title: document.getElementById('visPrintHead').textContent }));
  chk('in print the report header shows and the tools and tabs do not', pr.head==='block' && pr.tools==='none' && pr.tabs==='none' && /FACERINNA website visitors/.test(pr.title), pr);
  await p.emulateMedia({media:'screen'});
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('── not set up, and no access');
{
  delete H.PROPS.VISITORS_URL;
  const {c,p}=await asPerson(own.token);
  await p.click('#tabVisitors');
  chk('with the properties gone the tab shows the set-up card and not the dashboard', await until(()=>p.evaluate(()=>!document.getElementById('visSetup').hidden && document.getElementById('visBody').hidden)));
  await c.close();
  H.PROPS.VISITORS_URL='https://facerinna-visitors.example.workers.dev';
  H.call({action:'admin.team.save', token: own.token, person:{ email:'aina@facerinna.test', name:'Aina', role:'staff', access:['counter'] }});
  const aina = H.signIn('aina@facerinna.test');
  const {c:c2,p:p2}=await asPerson(aina.token);
  chk('a staff member without the area has no Visitors tab', !(await visibleTabs(p2)).includes('visitors'), await visibleTabs(p2));
  await c2.close();
}
await b.close(); srv.close();
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad?1:0);
