/* The counter screen as a home-screen app.

   What it has to do: carry its own manifest, scoped to scan.html, so the
   icon on the counter phone opens the counter (never the public site) full
   screen with the FACERINNA mark; give iOS an opaque touch icon, since it
   paints transparency black; and be something Chrome will install. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8198, BASE='http://127.0.0.1:'+PORT;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png',
  '.webmanifest':'application/manifest+json'};
const srv=http.createServer((req,res)=>{
  let f=decodeURIComponent(new URL(req.url,BASE).pathname); if(f.endsWith('/')) f+='index.html';
  const fp=path.join(ROOT,f);
  if(!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});
  res.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch();
const c=await b.newContext({viewport:{width:390,height:844}});
const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(BASE+'/scan.html',{waitUntil:'load'});
const cdp=await c.newCDPSession(p);

console.log('\n── manifest, as Chromium reads it');
const man=await cdp.send('Page.getAppManifest');
chk('scan.html links scan.webmanifest', /\/scan\.webmanifest$/.test(man.url||''), man.url);
chk('manifest parses with no errors', (man.errors||[]).length===0, man.errors);
const m=JSON.parse(man.data||'{}');
chk('name FACERINNA Booth Counter, short name Counter', m.name==='FACERINNA Booth Counter'&&m.short_name==='Counter', [m.name,m.short_name]);
chk('opens scan.html full screen', m.start_url==='./scan.html'&&m.display==='fullscreen', [m.start_url,m.display]);
chk('scoped to scan.html alone, so it never opens the public site', m.scope==='./scan.html'&&m.id==='./scan.html', [m.scope,m.id]);
const inst=await cdp.send('Page.getInstallabilityErrors').catch(e=>({err:e.message}));
chk('Chrome raises no installability errors', inst.installabilityErrors&&inst.installabilityErrors.length===0, inst);

console.log('\n── icons');
const png=f=>{ const d=fs.readFileSync(path.join(ROOT,f)); return {w:d.readUInt32BE(16),h:d.readUInt32BE(20),ct:d[25]}; };
for(const ic of m.icons){
  const r=await p.request.get(BASE+'/'+ic.src); const i=png(ic.src);
  chk(ic.src+' is served, '+ic.sizes+', maskable', r.ok()&&`${i.w}x${i.h}`===ic.sizes&&/maskable/.test(ic.purpose), [r.status(),i,ic.purpose]);
  chk(ic.src+' is opaque (RGB, no alpha)', i.ct===2, i);
}
const touch=await p.evaluate(()=>document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'));
const ti=touch&&png(touch);
chk('apple-touch-icon is a 180x180 opaque PNG', touch==='counter-icon-180.png'&&ti.w===180&&ti.h===180&&ti.ct===2, [touch,ti]);

console.log('\n── iOS home-screen tags');
const meta=await p.evaluate(()=>Object.fromEntries([...document.querySelectorAll('meta[name]')].map(x=>[x.name,x.content])));
chk('runs as an app, not a Safari tab', meta['apple-mobile-web-app-capable']==='yes'&&meta['mobile-web-app-capable']==='yes', meta);
chk('status bar laid over the page (full screen)', meta['apple-mobile-web-app-status-bar-style']==='black-translucent', meta);
chk('label under the icon reads Counter', meta['apple-mobile-web-app-title']==='Counter', meta);
chk('viewport covers the notch, body pads for it', /viewport-fit=cover/.test(meta.viewport||'')&&
  fs.readFileSync(path.join(ROOT,'scan.html'),'utf8').includes('env(safe-area-inset-top'), meta.viewport);

console.log('\n── the rest of the site is left alone');
const mainMan=JSON.parse(fs.readFileSync(path.join(ROOT,'manifest.webmanifest'),'utf8'));
chk('the public site keeps its own manifest and name', mainMan.name==='FACERINNA Malaysia Official Website'&&mainMan.start_url==='./', mainMan);
const sw=fs.readFileSync(path.join(ROOT,'sw.js'),'utf8');
chk('the service worker pre-caches the manifest and icons', ['scan.webmanifest','counter-icon-180.png','counter-icon-192.png','counter-icon-512.png'].every(f=>sw.includes(`'./${f}'`)));
chk('no page errors', errs.length===0, errs);

await b.close(); srv.close();
console.log(bad?`\n${bad} FAILED`:'\nthe counter installs as its own app');
process.exit(bad?1:0);
