/* Documents as people meet them: the admin writes one, the booth page lists
   it, a phone opens it, fills the yellow boxes, signs with a finger, makes
   the PDF and sends it; the copy is in the admin's list and downloads.
   The real admin page, booth page, sign page and booth-admin script (Google
   services stubbed, see booth-admin-harness.mjs) through a local server. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { load, OWNER } from './booth-admin-harness.mjs';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8231, BASE='http://127.0.0.1:'+PORT, API=BASE+'/api';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, ms=8000, step=80){ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(step);} return fn(); }

const H = load();
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.css':'text/css','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
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
const own = H.signIn(OWNER);
H.call({ token:own.token, action:'admin.settings', settings:{ passcode:'booth42' } });
const BODY = '# TEST COLLABORATION\n\nTHIS COLLABORATION is made on {{Date|today}} between Us ("Facerinna") and {{Clinic name}} ("the Clinic").\n\n1. **Purpose of Collaboration.**\n1.1 The Parties agree to collaborate for a period of twelve (12) months, and {{Clinic name}} agrees to display the tester zone in a visible and appropriate condition at all times.\n  Social Media Exposure\n(a) content creation;\n(b) videos.\n\n[[sign Facerinna, | the Clinic,]]';

console.log('\n── admin writes a document');
let docId;
{
  const c=await b.newContext({viewport:{width:1280,height:900}, acceptDownloads:true});
  await c.addInitScript(([a,t])=>{ window.__BOOTH_API=a; try{ localStorage.setItem('fx.admin.token',t); }catch(e){} }, [API, own.token]);
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog', d=>d.accept());
  await p.goto(BASE+'/admin.html',{waitUntil:'load'});
  await until(()=>p.evaluate(()=>!document.getElementById('app').hidden));
  chk('a Documents tab', await p.evaluate(()=>!document.getElementById('tabDocs').hidden));
  await p.click('#tabDocs');
  chk('the tab opens on an empty list', await p.evaluate(()=>!document.getElementById('viewDocs').hidden && /No documents yet/.test(document.getElementById('docList').textContent)));
  await p.fill('#docTitle','Test collaboration');
  await p.fill('#docDesc','For partner clinics');
  await p.fill('#docBody', BODY);
  await p.fill('#docSignFields','Name Clinic = Clinic name\nClinic Address');
  chk('it names the yellow boxes as they are typed', await p.evaluate(()=>document.getElementById('docFieldsNote').textContent), await p.evaluate(()=>document.getElementById('docFieldsNote').textContent));
  chk('...Date, Clinic name, Clinic Address', /Date, Clinic name, Clinic Address/.test(await p.evaluate(()=>document.getElementById('docFieldsNote').textContent)));
  await p.click('#docPreviewBtn');
  chk('the preview draws the text with yellow boxes', await p.evaluate(()=>{ const b=document.getElementById('docPreview'); return !b.hidden && b.querySelectorAll('mark').length===3 && /TEST COLLABORATION/.test(b.textContent); }));
  await p.fill('#docOurName','A Person'); await p.fill('#docOurTitle','PIC'); await p.fill('#docOurEmail','a@facerinna.test');
  await p.fill('#docWhatsapp','60 12 345 6789');
  chk('a new document starts Locked', await p.evaluate(()=>document.getElementById('docMode').value==='locked'));
  await p.click('#docSave');
  await until(()=>Promise.resolve(H.tabs['Documents'].rows.length>1));
  const row=H.tabs['Documents'].rows[1]; docId=row[0];
  chk('saved to the sheet, locked, number in digits', /^doc-/.test(docId) && row[11]==='locked' && row[10]==='60123456789', row.slice(0,4).concat(row.slice(10,13)));
  await until(()=>p.evaluate(()=>!!document.querySelector('#docList .item')));
  chk('listed, locked, 0 signed', /Locked/.test(await p.textContent('#docList')) && /0 signed/.test(await p.textContent('#docList')));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\n── the booth page lists it');
{
  const c=await b.newContext({viewport:{width:390,height:844}});
  await c.addInitScript(a=>{ window.__BOOTH_API=a; }, API);
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/index.html',{waitUntil:'load'});
  await until(()=>p.evaluate(()=>!!document.querySelector('#docs .doc-card')), 12000);
  const card=await p.evaluate(()=>{ const a=document.querySelector('#docs .doc-card'); return a && { href:a.getAttribute('href'), text:a.textContent }; });
  chk('a Documents section with the card', card && /Test collaboration/.test(card.text) && /Passcode/.test(card.text), card);
  chk('the card leads to sign.html for that document', card && card.href==='sign.html?d='+encodeURIComponent(docId), card);
  chk('right after the clinic section', await p.evaluate(()=>{ const d=document.getElementById('docs'); let e=document.getElementById('clinic').nextElementSibling; return e && e.classList.contains('booth-docs-divider') && e.nextElementSibling===d; }));
  chk('none of the text is on the booth page', !(await p.content()).includes('tester zone'));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\n── a phone signs it');
let pdfPath;
{
  const c=await b.newContext({viewport:{width:360,height:780}, deviceScaleFactor:2, hasTouch:true, acceptDownloads:true});
  await c.addInitScript(a=>{ window.__BOOTH_API=a;
    /* a phone that can hand a file to another app, as Android and iOS can */
    navigator.canShare = d => !!(d && d.files && d.files.length);
    navigator.share = d => { window.__shared = { n:d.files.length, name:d.files[0].name, type:d.files[0].type, size:d.files[0].size, text:d.text }; return Promise.resolve(); };
  }, API);
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/sign.html?d='+encodeURIComponent(docId),{waitUntil:'load'});
  await until(()=>p.evaluate(()=>!document.getElementById('gate').classList.contains('hidden')));
  chk('locked: the passcode first, no text', await p.evaluate(()=>document.getElementById('paper').classList.contains('hidden') && !document.body.textContent.includes('tester zone')));
  await p.fill('#gatePass','wrong'); await p.click('#gateBtn');
  await until(()=>p.evaluate(()=>/not right/.test(document.getElementById('gateErr').textContent)));
  chk('a wrong passcode says so', /not right/.test(await p.textContent('#gateErr')));
  await p.fill('#gatePass','booth42'); await p.click('#gateBtn');
  await until(()=>p.evaluate(()=>!document.getElementById('paper').classList.contains('hidden')));
  chk('the right one opens the document', /tester zone/.test(await p.textContent('#paper')));
  chk('the title and the date box filled with today', await p.evaluate(()=>document.getElementById('docTitle').textContent==='Test collaboration' &&
    /^\d{1,2}(st|nd|rd|th) [A-Z][a-z]+ 20\d\d$/.test(document.querySelector('.fx-in[data-f="Date"]').value)));
  chk('two Clinic name boxes in the text, one under the signature', await p.evaluate(()=>document.querySelectorAll('.fx-in[data-f="Clinic name"]').length===3));
  chk('no page wider than the phone', await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1), await p.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]));
  await p.click('#signBtn');
  const err1=await p.textContent('#err');
  chk('signing with nothing filled in lists what is missing', /Clinic name/.test(err1) && /Clinic Address/.test(err1) && /your name/.test(err1) && /your signature/.test(err1), err1);
  await p.fill('.fx-p .fx-in[data-f="Clinic name"] >> nth=0', 'Klinik Ujian Sdn Bhd');
  chk('typing one Clinic name box fills them all', await p.evaluate(()=>[...document.querySelectorAll('.fx-in[data-f="Clinic name"]')].every(i=>i.value==='Klinik Ujian Sdn Bhd')));
  await p.fill('.fx-in[data-f="Clinic Address"]', 'No. 1, Jalan Ujian, 50000 Kuala Lumpur');
  await p.fill('#signer', 'Dr Test');
  await p.locator('#pad').scrollIntoViewIfNeeded();
  const box=await p.locator('#pad').boundingBox();
  await p.mouse.move(box.x+20, box.y+100); await p.mouse.down();
  for(let i=0;i<=30;i++) await p.mouse.move(box.x+20+i*8, box.y+100-Math.sin(i/3)*40);
  await p.mouse.up();
  chk('the pad takes ink', await p.evaluate(()=>document.getElementById('padWrap').classList.contains('inked')));
  await p.click('#signBtn');
  await until(()=>p.evaluate(()=>!document.getElementById('done').classList.contains('hidden')));
  chk('signed: the done card', await p.evaluate(()=>!document.getElementById('done').classList.contains('hidden')), await p.textContent('#err'));
  await until(()=>p.evaluate(()=>/has a copy/.test(document.getElementById('saveState').textContent)), 10000);
  chk('the copy reached the script', /has a copy/.test(await p.textContent('#saveState')), await p.textContent('#saveState'));
  const srow=H.tabs['Signed documents'].rows[1];
  chk('a Signed documents row with what was filled in', srow && srow[1]===docId && JSON.parse(srow[3])['Clinic name']==='Klinik Ujian Sdn Bhd' && srow[4]==='Dr Test', srow && srow.slice(0,5));
  const file=srow && H.DRIVE.files[srow[5]];
  chk('...and its PDF private in Drive', file && file.access==='PRIVATE' && file.mime==='application/pdf');
  chk('the WhatsApp chat link carries the number', await p.evaluate(()=>/^https:\/\/wa\.me\/60123456789\?text=/.test(document.getElementById('waChat').getAttribute('href')||'')));
  await p.click('#shareBtn');
  const shared=await p.evaluate(()=>window.__shared);
  chk('Send on WhatsApp hands the PDF itself to the share sheet', shared && shared.n===1 && shared.type==='application/pdf' && /\.pdf$/.test(shared.name) && shared.size>2000 && /Signed: Test collaboration/.test(shared.text), shared);
  chk('...and the chat link is there too, for a message', await p.evaluate(()=>!document.getElementById('waChat').classList.contains('hidden')));
  const [dl]=await Promise.all([p.waitForEvent('download'), p.click('#dlBtn')]);
  pdfPath=path.join(os.tmpdir(),'fx-signed-'+Date.now()+'.pdf'); await dl.saveAs(pdfPath);
  chk('Download hands over a .pdf named for the document and the clinic', /^Test collaboration - Klinik Ujian Sdn Bhd - signed\.pdf$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\n── the PDF');
{
  const head=fs.readFileSync(pdfPath).subarray(0,5).toString();
  chk('a PDF', head==='%PDF-', head);
  let text='';
  try{ text=execFileSync('pdftotext',['-layout',pdfPath,'-'],{encoding:'utf8'}); }catch(e){ text='(pdftotext failed: '+e.message+')'; }
  const flat=text.replace(/\s+/g,' ');
  chk('it reads back: title, clinic, the clause', /TEST COLLABORATION/.test(flat) && /Klinik Ujian Sdn Bhd/.test(flat) && /tester zone in a visible/.test(flat), flat.slice(0,300));
  chk('the curly quotes survive', /“?Facerinna”?|"Facerinna"/.test(flat));
  chk('the signature block: both captions, the fields, who signed', /Facerinna,/.test(flat) && /the Clinic,/.test(flat) && /Name Clinic: Klinik Ujian Sdn Bhd/.test(flat) && /Clinic Address: No\. 1, Jalan Ujian/.test(flat) && /Signed by: Dr Test/.test(flat) && /Name: A Person/.test(flat), flat.slice(-400));
  let imgs='';
  try{ imgs=execFileSync('pdfimages',['-list',pdfPath],{encoding:'utf8'}); }catch(e){}
  chk('the signature is in it as a picture', /jpeg/.test(imgs), imgs);
  let info=''; try{ info=execFileSync('pdfinfo',[pdfPath],{encoding:'utf8'}); }catch(e){}
  chk('A4, titled', /595\.28 x 841\.89/.test(info) && /Title:\s+Test collaboration/.test(info), info);
}

console.log('\n── the admin reads the signed copy');
{
  const c=await b.newContext({viewport:{width:1280,height:900}, acceptDownloads:true});
  await c.addInitScript(([a,t])=>{ window.__BOOTH_API=a; try{ localStorage.setItem('fx.admin.token',t); }catch(e){} }, [API, own.token]);
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog', d=>d.accept());
  await p.goto(BASE+'/admin.html',{waitUntil:'load'});
  await until(()=>p.evaluate(()=>!document.getElementById('app').hidden));
  await p.click('#tabDocs');
  await until(()=>p.evaluate(()=>!!document.querySelector('#signedList .item')));
  chk('the signed copy is listed by clinic, document and signer', /Klinik Ujian Sdn Bhd/.test(await p.textContent('#signedList')) && /Dr Test/.test(await p.textContent('#signedList')));
  chk('the document shows 1 signed', /1 signed/.test(await p.textContent('#docList')));
  const [dl]=await Promise.all([p.waitForEvent('download'), p.click('#signedList .item button[data-act="get"]')]);
  const back=path.join(os.tmpdir(),'fx-back-'+Date.now()+'.pdf'); await dl.saveAs(back);
  chk('Download gives back the same PDF', fs.readFileSync(back).equals(fs.readFileSync(pdfPath)));
  await p.click('#docList .item button[data-act="edit"]');
  chk('Edit fills the form back in', await p.evaluate(()=>document.getElementById('docTitle').value==='Test collaboration' && /Name Clinic = Clinic name/.test(document.getElementById('docSignFields').value)));
  await p.selectOption('#docMode','show'); await p.click('#docSave');
  await until(()=>Promise.resolve(H.tabs['Documents'].rows[1][11]==='yes'));
  chk('switched to Show', H.tabs['Documents'].rows[1][11]==='yes');
  await p.click('#docList .item button[data-act="del"]');
  await until(()=>p.evaluate(()=>/No documents yet/.test(document.getElementById('docList').textContent)));
  chk('deleted: gone from the list, the signed copy stays', /No documents yet/.test(await p.textContent('#docList')) && /Klinik Ujian/.test(await p.textContent('#signedList')));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\n── no number on the document: the Contact chat');
{
  const r=H.call({ token:own.token, action:'admin.doc.save', doc:{ title:'Open form', body:'I, {{Name}}, agree.', mode:'show' } });
  const c=await b.newContext({viewport:{width:390,height:844}});
  await c.addInitScript(a=>{ window.__BOOTH_API=a; }, API);
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await c.route(/wa\.me|whatsapp\.com/, rt=>rt.fulfill({ status:200, contentType:'text/html', body:'whatsapp' }));   /* stays here */
  const popups=[]; c.on('page', pg=>popups.push(pg));
  await p.goto(BASE+'/sign.html?d='+r.id,{waitUntil:'load'});
  await until(()=>p.evaluate(()=>!document.getElementById('paper').classList.contains('hidden')));
  await p.fill('.fx-in[data-f="Name"]','Ali'); await p.fill('#signer','Ali');
  await p.locator('#pad').scrollIntoViewIfNeeded(); const bx=await p.locator('#pad').boundingBox();
  await p.mouse.move(bx.x+20,bx.y+60); await p.mouse.down(); await p.mouse.move(bx.x+200,bx.y+90); await p.mouse.up();
  await p.click('#signBtn');
  await until(()=>p.evaluate(()=>!document.getElementById('done').classList.contains('hidden')));
  chk('the chat link is the booth\'s Contact WhatsApp', await p.evaluate(()=>document.getElementById('waChat').getAttribute('href'))==='https://wa.me/message/YKYI736CG4FZH1');
  await Promise.all([p.waitForEvent('download'), p.click('#shareBtn')]);
  await until(()=>Promise.resolve(popups.length>0), 4000);
  chk('no file sharing here: the PDF downloads and the Contact chat opens', popups.length===1 && /wa\.me\/message\/YKYI736CG4FZH1/.test(popups[0].url()), popups.map(x=>x.url()));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

await b.close(); srv.close();
console.log(bad ? `\n${bad} FAILED` : '\nall passed');
process.exit(bad ? 1 : 0);
