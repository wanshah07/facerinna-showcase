/* Templates in the admin: one kept in templates.gs (the second file of the
   Apps Script project, never on the website) is a document by itself, and a
   new document can start from it, or from any document with Duplicate. The
   real admin and booth pages and booth-admin script through a local server. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { load, OWNER } from './booth-admin-harness.mjs';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8233, BASE='http://127.0.0.1:'+PORT, API=BASE+'/api';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, ms=8000, step=80){ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(step);} return fn(); }

const H = load({ extra: "var DOC_TEMPLATES = [{ id:'t-one', title:'Template one', body:'# ONE\\n\\nMade with {{Clinic name}}.', signer_fields:[{label:'Name Clinic', field:'Clinic name'}], our_name:'P' }];" });
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.css':'text/css','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
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

console.log('\n── the booth page, with nobody having touched admin');
{
  const c=await b.newContext({viewport:{width:390,height:844}});
  await c.addInitScript(a=>{ window.__BOOTH_API=a; }, API);
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/index.html',{waitUntil:'load'});
  await until(()=>p.evaluate(()=>!!document.querySelector('.doc-sign-btn')), 12000);
  chk('the template is already a document: Sign the agreement is in the Clinic section', await p.evaluate(()=>/^sign\.html\?d=doc-/.test(document.querySelector('#clinic .doc-sign-btn').getAttribute('href'))));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\n── admin: from a template, and Duplicate');
{
  const c=await b.newContext({viewport:{width:1280,height:900}});
  await c.addInitScript(([a,t])=>{ window.__BOOTH_API=a; try{ localStorage.setItem('fx.admin.token',t); }catch(e){} }, [API, own.token]);
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog', d=>d.accept());
  await p.goto(BASE+'/admin.html',{waitUntil:'load'});
  await until(()=>p.evaluate(()=>!document.getElementById('app').hidden));
  await p.click('#tabDocs');
  chk('the template\'s document is listed', /Template one/.test(await p.textContent('#docList')));
  chk('"Start from a template" offers it', await p.evaluate(()=>!document.getElementById('docTplRow').hidden && [...document.querySelectorAll('#docTpl option')].map(o=>o.textContent).join('|')==='Blank document|Template one'));
  await p.selectOption('#docTpl','0');
  chk('choosing it fills the form as a new document', await p.evaluate(()=>document.getElementById('docId').value==='' && document.getElementById('docTitle').value==='Template one' && /Made with \{\{Clinic name\}\}/.test(document.getElementById('docBody').value) && /Name Clinic = Clinic name/.test(document.getElementById('docSignFields').value)));
  await p.fill('#docTitle','Second clinic form'); await p.click('#docSave');
  await until(()=>p.evaluate(()=>document.querySelectorAll('#docList .item').length===2));
  chk('saved as a second document; the first is untouched', await p.evaluate(()=>/Second clinic form/.test(document.getElementById('docList').textContent) && /Template one/.test(document.getElementById('docList').textContent)));
  await p.click('#docList .item:first-child button[data-act="copy"]');
  chk('Duplicate fills a new copy, titled (copy)', await p.evaluate(()=>document.getElementById('docId').value==='' && / \(copy\)$/.test(document.getElementById('docTitle').value)));
  await p.click('#docSave');
  await until(()=>p.evaluate(()=>document.querySelectorAll('#docList .item').length===3));
  chk('and saves as a third', await p.evaluate(()=>document.querySelectorAll('#docList .item').length===3));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

await b.close(); srv.close();
console.log(bad ? `\n${bad} FAILED` : '\nall passed');
process.exit(bad ? 1 : 0);
