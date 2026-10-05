/* Roles, stock and resets as a person meets them: the real admin page and
   counter screen, talking to the real booth-admin script (Google services
   stubbed, see booth-admin-harness.mjs) through a local server.

   What it has to do: show each person the tabs and cards of the areas they
   hold and nothing else, let an admin add people and tick or untick their
   areas in place, manage the stock on the wheel and let a device play again,
   and tell counter staff without Counter why the camera will not open. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { load, OWNER } from './booth-admin-harness.mjs';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8199, BASE='http://127.0.0.1:'+PORT, API=BASE+'/api';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, ms=6000, step=80){ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(step);} return fn(); }

const H = load();
const posted=[];
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
const srv=http.createServer((req,res)=>{
  const u=new URL(req.url,BASE);
  if(u.pathname==='/api'){
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
      let out; try{ const b=JSON.parse(body||'{}'); posted.push(b); out=H.call(b); }catch(e){ out={ok:false,error:String(e.message)}; }
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
const rowOf = e => H.tabs['Admins'].rows.find(r => String(r[0]).toLowerCase() === e);

async function asPerson(token, w=1280, h=900){
  const c=await b.newContext({viewport:{width:w,height:h}});
  await c.addInitScript(([a,t])=>{ window.__BOOTH_API=a; try{ localStorage.setItem('fx.admin.token',t); }catch(e){} }, [API, token]);
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  p.on('dialog', d=>d.accept());
  await p.goto(BASE+'/admin.html',{waitUntil:'load'});
  await until(()=>p.evaluate(()=>!document.getElementById('app').hidden));
  await sleep(300);
  return {c,p,errs};
}
const tabsShown = p => p.evaluate(()=>[...document.querySelectorAll('.tab')].filter(t=>!t.hidden).map(t=>t.dataset.view).join());
const hidden = (p,sel) => p.evaluate(s=>{ const e=document.querySelector(s); return !e || !!e.closest('[hidden]'); }, sel);

const own = H.signIn(OWNER);

console.log('\n── the owner');
{
  const {c,p,errs}=await asPerson(own.token);
  chk('every tab: settings, sections, segments, QR & posters, gifts, people', await tabsShown(p)==='settings,sections,segments,media,gifts,admins', await tabsShown(p));
  await p.click('#tabAdmins');
  chk('the owner card: owner and you, every area, no controls', await p.evaluate(o=>{
    const card=document.querySelector(`#adminList .person[data-email="${o}"]`);
    return !!card && /owner/.test(card.textContent) && /you/.test(card.textContent) && /Every area/.test(card.textContent)
      && !card.querySelector('select,.teamremove,.teamactive'); }, OWNER));
  chk('the Add form ticks Counter and Staff guide to begin with', await p.evaluate(()=>
    [...document.querySelectorAll('#teamAccess input:checked')].map(i=>i.value).join()==='counter,guide'));
  await p.fill('#teamEmail','Aina@Clinic.test'); await p.fill('#teamName','Aina, counter');
  await p.click('#teamAdd');
  await until(()=>p.evaluate(()=>!!document.querySelector('#adminList .person[data-email="aina@clinic.test"]')));
  chk('adding her writes a staff row with counter and guide', rowOf('aina@clinic.test')?.[4]==='staff' && rowOf('aina@clinic.test')?.[5]==='counter, guide', rowOf('aina@clinic.test'));
  const chip = area => `#adminList .person[data-email="aina@clinic.test"] .chip[data-area="${area}"]`;
  chk('her card shows Counter and Staff guide pressed, the rest not', await p.evaluate(()=>
    [...document.querySelectorAll('#adminList .person[data-email="aina@clinic.test"] .chip[aria-pressed="true"]')].map(c=>c.dataset.area).join()==='counter,guide'));
  await p.click(chip('stock'));
  await until(()=>Promise.resolve(rowOf('aina@clinic.test')[5]==='counter, guide, stock'));
  chk('tap Gift stock: ticked on the sheet', rowOf('aina@clinic.test')[5]==='counter, guide, stock', rowOf('aina@clinic.test')[5]);
  await until(()=>p.evaluate(s=>document.querySelector(s)?.getAttribute('aria-pressed')==='true', chip('stock')));
  await p.click(chip('stock'));
  await until(()=>Promise.resolve(rowOf('aina@clinic.test')[5]==='counter, guide'));
  chk('tap it again: unticked', rowOf('aina@clinic.test')[5]==='counter, guide', rowOf('aina@clinic.test')[5]);
  await sleep(200);
  await p.selectOption('#adminList .person[data-email="aina@clinic.test"] .teamrole','admin');
  await until(()=>Promise.resolve(rowOf('aina@clinic.test')[4]==='admin'));
  chk('make admin (confirmed): the sheet says admin', rowOf('aina@clinic.test')[4]==='admin');
  await until(()=>p.evaluate(()=>/Every area/.test(document.querySelector('#adminList .person[data-email="aina@clinic.test"]')?.textContent||'')));
  await p.selectOption('#adminList .person[data-email="aina@clinic.test"] .teamrole','staff');
  await until(()=>Promise.resolve(rowOf('aina@clinic.test')[4]==='staff'));
  chk('back to staff: the counter pair again', rowOf('aina@clinic.test')[5]==='counter, guide', rowOf('aina@clinic.test'));
  await sleep(200);
  await p.click('#adminList .person[data-email="aina@clinic.test"] .teamactive');
  await until(()=>Promise.resolve(rowOf('aina@clinic.test')[1]==='no'));
  chk('Turn off: active no, and the card says so', rowOf('aina@clinic.test')[1]==='no'
    && await until(()=>p.evaluate(()=>/turned off/.test(document.querySelector('#adminList .person[data-email="aina@clinic.test"]')?.textContent||''))));
  await p.click('#adminList .person[data-email="aina@clinic.test"] .teamactive');
  await until(()=>Promise.resolve(rowOf('aina@clinic.test')[1]==='yes'));
  chk('Turn back on', rowOf('aina@clinic.test')[1]==='yes');
  await p.fill('#teamEmail','temp@clinic.test'); await p.click('#teamAdd');
  await until(()=>p.evaluate(()=>!!document.querySelector('#adminList .person[data-email="temp@clinic.test"]')));
  await p.click('#adminList .person[data-email="temp@clinic.test"] .teamremove');
  await until(()=>Promise.resolve(!rowOf('temp@clinic.test')));
  chk('Remove (confirmed): the row is gone', !rowOf('temp@clinic.test'));

  console.log('\n── gifts: stock and claims, as the owner');
  await p.click('#tabGifts');
  chk('the stock starts as the old products, not counted', await p.evaluate(()=>
    document.querySelectorAll('#stockList .stock').length===8 && /Not counted/.test(document.querySelector('#stockList').textContent)));
  const first = await p.evaluate(()=>document.querySelector('#stockList .stock').dataset.product);
  const S = `#stockList .stock[data-product="${first.replace(/"/g,'\\"')}"]`;
  await p.fill(S+' .stockn','3'); await p.click(S+' .stockset');
  await until(()=>p.evaluate(s=>/3 left/.test(document.querySelector(s)?.textContent||''), S));
  chk('Set count 3: "3 left", and the sheet has 3', await p.evaluate(s=>/3 left/.test(document.querySelector(s).textContent), S)
    && H.tabs['Gift stock'].rows.find(r=>r[0]===first)[1]===3);
  await p.fill(S+' .stockn','2'); await p.click(S+' .stockadd');
  await until(()=>p.evaluate(s=>/5 left/.test(document.querySelector(s)?.textContent||''), S));
  chk('Add 2: 5 left', H.tabs['Gift stock'].rows.find(r=>r[0]===first)[1]===5);
  await p.fill(S+' .stockn','0'); await p.click(S+' .stockset');
  await until(()=>p.evaluate(s=>/Out of stock/.test(document.querySelector(s)?.textContent||''), S));
  chk('Set 0: out of stock, off the wheel', await p.evaluate(s=>document.querySelector(s).classList.contains('out'), S));
  await p.fill('#stockName','Travel kit'); await p.fill('#stockQty','4'); await p.click('#stockAdd');
  await until(()=>p.evaluate(()=>!!document.querySelector('#stockList .stock[data-product="Travel kit"]')));
  chk('Add a product: on the list with 4', H.tabs['Gift stock'].rows.some(r=>r[0]==='Travel kit' && r[1]===4));
  await p.click('#stockList .stock[data-product="Travel kit"] .stockrm');
  await until(()=>p.evaluate(()=>!document.querySelector('#stockList .stock[data-product="Travel kit"]')));
  chk('Remove it: gone from the sheet', !H.tabs['Gift stock'].rows.some(r=>r[0]==='Travel kit'));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\n── claims: letting a device play again');
{
  H.call({ action:'admin.settings', token:own.token, settings:{ gift_active:'yes' } });
  const k1 = H.call({ action:'gift.claim', device:'phoneAAA1', score:9000, game:'facy-run', name:'Siti' });
  H.call({ action:'admin.gift.redeem', token:own.token, claim:k1.claim });
  H.call({ action:'gift.claim', device:'phoneBBB1', score:7000, game:'facy-run', name:'Raj' });
  const {c,p,errs}=await asPerson(own.token);
  await p.click('#tabGifts');
  chk('claims list: Raj waiting, Siti given a product', await p.evaluate(()=>{
    const t=document.getElementById('claimList').textContent; return /Raj/.test(t) && /Waiting at the counter/.test(t) && /Siti/.test(t) && /Gave /.test(t); }));
  await p.fill('#claimSearch','siti');
  chk('search narrows it to Siti', await p.evaluate(()=>document.querySelectorAll('#claimList .claim').length===1 && /Siti/.test(document.getElementById('claimList').textContent)));
  await p.click('#claimList .claim[data-device="phoneAAA1"] .claimreset');
  await until(()=>Promise.resolve(!!H.tabs['Gifts'].rows.find(r=>r[1]==='phoneAAA1')[9]));
  chk('Let play again: the row is stamped reset by the owner', H.tabs['Gifts'].rows.find(r=>r[1]==='phoneAAA1')[10]===OWNER);
  chk('...the card says Reset and the button is gone', await until(()=>p.evaluate(()=>{
    const c=document.querySelector('#claimList .claim[data-device="phoneAAA1"]'); return !!c && /Reset/.test(c.textContent) && !c.querySelector('.claimreset'); })));
  const k2 = H.call({ action:'gift.claim', device:'phoneAAA1', score:9000, game:'facy-run', name:'Siti' });
  chk('...and Siti’s phone earns a new code', k2.ok && k2.claim!==k1.claim && !k2.redeemed, k2);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\n── staff see only their areas');
const staff = async (email, access) => {
  H.call({ action:'admin.team.save', token:own.token, person:{ email, role:'staff', access } });
  return H.signIn(email).token;
};
{
  const ctok = await staff('counter@clinic.test',['counter','guide']);
  const {c,p,errs}=await asPerson(ctok);
  chk('Counter only: one tab, Settings', await tabsShown(p)==='settings', await tabsShown(p));
  chk('...showing the counter card and nothing else', !(await hidden(p,'#cardCounter')) && await hidden(p,'#cardPage')
    && await hidden(p,'#cardGift') && await hidden(p,'#cardPrivacy') && await hidden(p,'#saveRow'));
  H.call({ action:'admin.settings', token:own.token, settings:{ passcode:'booth2026' } });
  const seen = H.call({ action:'admin.get', token:ctok });
  chk('...and the script does not send this person the passcode', await p.evaluate(()=>document.getElementById('passcode').value==='')
    && !('passcode' in seen.settings) && !JSON.stringify(seen).includes('booth2026'), Object.keys(seen.settings));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
{
  const tok = await staff('privacy@clinic.test',['privacy']);
  const {c,p,errs}=await asPerson(tok);
  chk('Privacy only: the privacy card and a Save button', !(await hidden(p,'#cardPrivacy')) && !(await hidden(p,'#saveRow')) && await hidden(p,'#cardPage'));
  await p.fill('#privEntity','FACERINNA Sdn. Bhd.');
  const n = posted.length;
  await p.click('#saveSettings');
  await until(()=>p.evaluate(()=>/Saved/.test(document.getElementById('settingsState').textContent)));
  const sent = posted.slice(n).find(x=>x.action==='admin.settings');
  chk('saving sends the four privacy keys and nothing else', sent && Object.keys(sent.settings).sort().join()==='privacy_address,privacy_email,privacy_entity,privacy_retention', sent && Object.keys(sent.settings));
  chk('...and it is saved', H.call({ action:'admin.get', token:own.token }).settings.privacy_entity==='FACERINNA Sdn. Bhd.');
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
{
  const {c,p,errs}=await asPerson(await staff('store@clinic.test',['stock']));
  chk('Stock only: one tab, Gifts, with stock and without claims', await tabsShown(p)==='gifts'
    && !(await hidden(p,'#stockList')) && await hidden(p,'#claimList'));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
{
  const {c,p,errs}=await asPerson(await staff('nobody@clinic.test',[]));
  chk('Nothing ticked: no tabs, and a note saying to ask an admin', await tabsShown(p)==='' && !(await hidden(p,'#noAccess')));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\n── the counter screen, for staff without Counter');
{
  H.call({ action:'admin.team.save', token:own.token, person:{ email:'late@clinic.test', role:'staff', access:['guide'] } });
  const c=await b.newContext({viewport:{width:390,height:844}});
  await c.addInitScript(a=>{ window.__BOOTH_API=a; }, API);
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/scan.html',{waitUntil:'load'});
  await p.fill('#gateMail','late@clinic.test'); await p.click('#gateGo');
  await until(()=>p.evaluate(()=>!document.getElementById('gateCode').classList.contains('hidden')));
  const mail = H.mails.filter(m=>m.to==='late@clinic.test').pop();
  await p.fill('#gateCode', mail.subject.match(/(\d{6})$/)[1]); await p.click('#gateGo');
  await until(()=>p.evaluate(()=>/Counter is not ticked/.test(document.getElementById('gateSay').textContent)));
  chk('signed in, and told plainly that Counter is not ticked', await p.evaluate(()=>/Counter is not ticked/.test(document.getElementById('gateSay').textContent)
    && !document.getElementById('gate').classList.contains('hidden') && document.getElementById('camWrap').classList.contains('hidden')));
  chk('...keeping the sign-in, so a tick is enough', await p.evaluate(()=>!!localStorage.getItem('fx.admin.token')));
  await p.click('#gateGo'); await sleep(400);
  chk('tapping again before the tick: still refused', await p.evaluate(()=>/Counter is not ticked/.test(document.getElementById('gateSay').textContent)));
  H.call({ action:'admin.team.save', token:own.token, person:{ email:'late@clinic.test', role:'staff', access:['guide','counter'] } });
  await p.click('#gateGo');
  chk('after the tick: the gate opens without signing in again', await until(()=>p.evaluate(()=>document.getElementById('gate').classList.contains('hidden'))));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\n── on a phone');
{
  const {c,p,errs}=await asPerson(own.token, 390, 844);
  for(const t of ['tabAdmins','tabGifts','tabSettings']){
    await p.click('#'+t); await sleep(200);
    chk(t+': no sideways scroll at 390px', await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), await p.evaluate(()=>document.documentElement.scrollWidth));
  }
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

await b.close(); srv.close();
console.log(bad?`\n${bad} FAILED`:'\nthe admin page shows each person their areas, and the counter says why it will not open');
process.exit(bad?1:0);
