/* Every catalogue product shows its ingredients on the clinical data sheet:
   the key actives as chips and the full INCI list with its NPRA number. */
import pkg from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PAGE } from './paths.mjs';
const {chromium}=pkg;
const PORT=8244, BASE='http://127.0.0.1:'+PORT;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.webmanifest':'application/manifest+json'};
const srv=http.createServer((req,res)=>{
  let f=decodeURIComponent(new URL(req.url,BASE).pathname); if(f.endsWith('/')) f+='index.html';
  const fp=path.join(ROOT,f);
  if(f==='/sw.js'||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'}); res.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch();
for(const vp of [{width:1366,height:800},{width:360,height:740}]){
  const c=await b.newContext({viewport:vp,isMobile:vp.width<500,hasTouch:vp.width<500});
  await c.addInitScript(()=>{ window.__BOOTH_API=''; });
  const pg=await c.newPage(); await pg.goto(BASE+'/index.html',{waitUntil:'load'});
  const facts=await pg.evaluate(()=>{
    const names=PRODUCTS.map(p=>p.name);
    const missing=names.filter(n=>!INCI[n]);
    const extra=Object.keys(INCI).filter(n=>!names.includes(n));
    const nots=Object.values(INCI).map(x=>x.not);
    const heroes=HEROES.map(h=>h.name).filter(n=>!INCI[n]);
    const badNot=Object.entries(INCI).filter(([n,x])=>!/^NOT\d{9}K$/.test(x.not)||!x.inci.startsWith('AQUA')||!x.actives).map(([n])=>n);
    // a hero's quoted NPRA number must be the one its ingredients come from
    const heroNot=HEROES.filter(h=>{const m=/NOT\d{9}K/.exec(h.tag); return m&&INCI[h.name]&&INCI[h.name].not!==m[0];}).map(h=>h.name);
    return {count:names.length,missing,extra,dupNot:nots.length-new Set(nots).size,heroes,badNot,heroNot};
  });
  const tag=' @'+vp.width;
  chk('every catalogue product has an ingredients entry'+tag, facts.missing.length===0&&facts.count===19, facts);
  chk('no stray entries, no shared notification numbers'+tag, facts.extra.length===0&&facts.dupNot===0, facts);
  chk('entries are well formed (NOT number, water first, actives)'+tag, facts.badNot.length===0, facts.badNot);
  chk('hero cards quote the same NPRA number as their ingredients'+tag, facts.heroNot.length===0&&facts.heroes.length===0, facts);
  let shown=0, fits=0, order=0; const names=await pg.evaluate(()=>PRODUCTS.map(p=>p.name));
  for(const n of names){
    const r=await pg.evaluate(n=>{ openClin(n);
      const ing=document.querySelector('#cpanel .ingr'); const chips=[...document.querySelectorAll('#cpanel .ingr .se')].map(e=>e.textContent);
      const list=document.querySelector('#cpanel .ingr-list'); const lbl=document.querySelector('#cpanel .ingr-lbl');
      const panel=document.getElementById('cpanel');
      const before=ing&&ing.compareDocumentPosition(document.querySelector('#cpanel .study'))&Node.DOCUMENT_POSITION_FOLLOWING;
      const out={ok:!!ing&&chips.length>0&&list.textContent===INCI[n].inci&&lbl.textContent.includes(INCI[n].not),
        fits:list.scrollWidth<=panel.clientWidth, before:!!before,
        chipsIn:chips.filter(c=>!c.startsWith('☀️')).every(c=>INCI[n].inci.toUpperCase().includes(c.replace(/ [\d.]+%.*$/,'').toUpperCase())),
        uvOne:chips.filter(c=>c.startsWith('☀️')).length<=1,
        // levels are round: whole numbers from 10 up, halves from 1 up, one significant figure below
        round:chips.every(c=>{ const m=c.match(/([\d.]+)%/); if(!m) return true; const v=+m[1];
          return v>=10?Number.isInteger(v):v>=1?Number.isInteger(v*2):+v.toPrecision(1)===v; })};
      closeClin(); return out; }, n);
    if(r.ok&&r.chipsIn&&r.uvOne&&r.round) shown++; if(r.fits) fits++; if(r.before) order++;
    if(!(r.ok&&r.chipsIn&&r.uvOne&&r.round&&r.fits&&r.before)) console.log('    ', n, JSON.stringify(r));
  }
  chk('the sheet shows rounded actives (UV filters as one total) and the full INCI for all 19'+tag, shown===19, shown);
  chk('ingredients sit above the clinical studies'+tag, order===19, order);
  chk('the INCI list wraps inside the panel'+tag, fits===19, fits);
  await c.close();
}
await b.close(); srv.close();
console.log(bad?`\n${bad} FAILED`:'\nALL PASS'); process.exit(bad?1:0);
