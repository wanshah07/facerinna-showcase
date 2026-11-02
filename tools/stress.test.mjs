/* Stress: the booth pushed harder than a busy day.

   1. The booth scripts, run for real in node (Google services stubbed): three
      thousand config reads, five thousand score posts across every game, a
      rush of three hundred phones claiming twenty-five gifts, and five hundred
      admin saves. Nothing here reaches the live scripts.
   2. Every game soaked in a browser: played round after round with rapid
      input, the window resized again and again, and the page measured for
      errors, memory, DOM growth and the longest frame of script.
   3. Eight games open at once, as on a row of kiosks.

     node tools/stress.test.mjs            everything
     node tools/stress.test.mjs scripts    part 1 only
     SOAK_MS=20000 node tools/stress.test.mjs games
     GAME=match-factory-4k node tools/stress.test.mjs games   one game
*/
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { load, OWNER } from './booth-admin-harness.mjs';
import { ROOT } from './paths.mjs';
const {chromium}=pkg;
const ONLY=process.argv[2]||'all', SOAK=+(process.env.SOAK_MS||45000);
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++; console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x).slice(0,400):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ms=f=>{ const t=process.hrtime.bigint(); f(); return Number(process.hrtime.bigint()-t)/1e6; };

/* ───────────────────────── 1. the booth scripts */
if(ONLY==='all'||ONLY==='scripts'){
  console.log('\n1. the booth scripts under load');
  const H=load();
  const own=H.signIn(OWNER);
  let t=ms(()=>{ for(let i=0;i<3000;i++) H.call({action:'config'}); });
  chk('3,000 config reads: '+(t/3000).toFixed(2)+' ms each in the script itself', t/3000<5, t);
  const cfg=H.call({action:'config'});
  chk('...and the answer is still whole', cfg.ok && cfg.settings && Array.isArray(cfg.games), Object.keys(cfg));

  /* the gift rush: 25 in stock, 300 phones that all earned one. A phone's claim
     mints a code; the product comes off the stock when the counter scans it. */
  /* the sheet starts with the default products in stock: empty them all, then 25 of one */
  H.call({action:'gift.wheel'});
  for(const r of (H.tabs['Gift stock']||{rows:[]}).rows.slice(1)) if(r[0]) H.call({action:'admin.stock.set',token:own.token,product:String(r[0]),quantity:0});
  H.call({action:'admin.stock.set',token:own.token,product:'Ceramide B5 Balancing Moisturizer',quantity:25});
  H.call({action:'admin.settings',token:own.token,settings:{gift_active:'yes',gift_points:'pack-drop = 1500'}});
  const codes=[], other={};
  for(let i=0;i<300;i++){
    const r=H.call({action:'gift.claim',device:'rush'+String(i).padStart(4,'0'),score:2000,game:'pack-drop',name:'P'+i});
    if(r.ok&&r.claim) codes.push(r.claim); else other[r.reason]=(other[r.reason]||0)+1;
  }
  chk('300 phones that earned a gift each get their own code', codes.length===300 && new Set(codes).size===300, {n:codes.length,other});
  const again=H.call({action:'gift.claim',device:'rush0000',score:2000,game:'pack-drop'});
  chk('a phone asking again is handed the same code, not a second', again.claim===codes[0], again);
  const got={given:0,refused:0,products:{}};
  for(const c of codes){
    const r=H.call({action:'admin.gift.redeem',token:own.token,claim:c});
    if(r.ok&&r.product){ got.given++; got.products[r.product]=(got.products[r.product]||0)+1; } else got.refused++;
  }
  chk('the counter scans all 300 against 25 in stock: exactly 25 gifts, 275 told the stock is gone', got.given===25 && got.refused===275, got);
  const st=(H.tabs['Gift stock']||{rows:[]}).rows.find(r=>String(r[0])==='Ceramide B5 Balancing Moisturizer');
  chk('the stock ends at 0, never below', st && +st[1]===0, st);
  const twice=H.call({action:'admin.gift.redeem',token:own.token,claim:codes[0]});
  chk('a code scanned twice is not a second gift', twice.ok===true && twice.already===true, twice);
  chk('no write was left unflushed when a lock was let go', H.SHEETS.unflushedReleases===0, H.SHEETS);

  /* five hundred admin saves back and forth */
  t=ms(()=>{ for(let i=0;i<500;i++) H.call({action:'admin.settings',token:own.token,settings:{games_off:i%2?'uv-card':'',tour_games:i%2?'magic-tiles,facy-run':'pack-drop',tour_active:'yes'}}); });
  H.CACHE.clear();
  const c2=H.call({action:'config'}).settings;
  chk('500 admin saves ('+(t/500).toFixed(2)+' ms each) leave the last one standing', c2.games_off==='uv-card' && c2.tour_games==='magic-tiles,facy-run' && c2.tour_active==='yes', c2);
  const rows=H.tabs['Settings'].rows.filter(r=>r[0]==='tour_games').length;
  chk('...with one row per setting, not five hundred', rows===1, rows);

  /* the scoreboard: 5,000 runs across every game */
  const src=fs.readFileSync(ROOT+'tools/booth-scores.gs','utf8');
  const sheet={rows:[]};
  const api={ getLastRow:()=>sheet.rows.length, getLastColumn:()=>sheet.rows.reduce((m,r)=>Math.max(m,r.length),0), appendRow:r=>sheet.rows.push(r),
    getRange:(r,c,nr,nc)=>({ getValues:()=>sheet.rows.slice(r-1,r-1+nr).map(x=>x.slice(c-1,c-1+nc)), setValue:v=>{ for(let i=r-1;i<r-1+nr;i++) sheet.rows[i][c-1]=v; }, setFontWeight(){ return this; } }),
    setFrozenRows(){}, setColumnWidth(){}, hideColumns(){} };
  const book={getSheetByName:()=>api,insertSheet:()=>api};
  const SpreadsheetApp={getActive:()=>book,openById:()=>book};
  const LockService={getScriptLock:()=>({waitLock(){},tryLock(){return true},releaseLock(){}})};
  const store=new Map();
  const CacheService={getScriptCache:()=>({get:k=>store.get(k)??null,put:(k,v)=>store.set(k,v),remove:k=>store.delete(k)})};
  const ContentService={MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>s})};
  const Logger={log(){}};
  const S=eval(`(() => { ${src}\n return { doPost, doGet, setUp, GAMES }; })()`);
  S.setUp();
  const post=o=>JSON.parse(S.doPost({postData:{contents:JSON.stringify(o),type:'text/plain'}}));
  const get=q=>JSON.parse(S.doGet({parameter:q}));
  const ids=Object.keys(S.GAMES);
  const best={}; let accepted=0;
  t=ms(()=>{ for(let i=0;i<5000;i++){
    const g=ids[i%ids.length], n='Player'+(i%173), max=S.GAMES[g].max;
    const sc=Math.floor((i*7919)%Math.min(max,20000));
    const r=post({game:g,name:n,score:sc,device:'d'+(i%173)});
    if(r.ok){ accepted++; const k=g+'|'+n; if(!(k in best)||sc>best[k]) best[k]=sc; }
  } });
  chk('5,000 runs across all '+ids.length+' boards ('+(t/5000).toFixed(2)+' ms each): every one accepted', accepted===5000, accepted);
  const over=post({game:'tournament',name:'X',score:S.GAMES['tournament'].max+1});
  chk('...a score over the ceiling is still refused at volume', over.ok===false, over);
  store.clear();
  const all=get({all:'1',top:'5'});
  let right=true;
  for(const g of ids){
    const want=Object.entries(best).filter(([k])=>k.startsWith(g+'|')).map(([k,s])=>({n:k.split('|')[1],s})).sort((a,b)=>b.s-a.s).slice(0,5).map(x=>x.s);
    const got=((all.games||{})[g]||[]).map(x=>x.s);
    if(want.join()!==got.join()){ right=false; console.log('    ',g,'want',want.join(),'got',got.join()); }
  }
  chk('the all-games board still shows each game\'s true top five', right);
  t=ms(()=>{ for(let i=0;i<200;i++){ store.clear(); get({all:'1',top:'5'}); } });
  chk('reading the whole board from 5,000 rows, uncached: '+(t/200).toFixed(1)+' ms', t/200<250, t/200);
}

/* ───────────────────────── 2 & 3. the games */
if(ONLY==='all'||ONLY==='games'){
  const PORT=8280, BASE='http://127.0.0.1:'+PORT;
  const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.jpg':'image/jpeg','.glb':'model/gltf-binary'};
  const srv=http.createServer((q,r)=>{
    const f=decodeURIComponent(new URL(q.url,BASE).pathname), fp=path.join(ROOT,f);
    if(f==='/sw.js'||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ r.writeHead(404); return r.end(); }
    r.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'}); r.end(fs.readFileSync(fp));
  });
  await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
  const b=await chromium.launch({args:['--js-flags=--expose-gc','--enable-precise-memory-info','--use-angle=swiftshader','--enable-unsafe-swiftshader']});

  const GAMES=[
    ['magic-tiles-4k','#goPlay'],['pack-slicer-4k','#goPlay'],['match-factory-4k','#goPlay'],['pack-drop-4k','#goPlay'],['pack-crush-4k','#goPlay'],['pack-recall-4k','#goPlay'],
    ['match-lab','#goPlay'],['pack-match','#goPlay'],['shelf-shot','#goPlay'],['deep-lab','#goPlay'],['lab-run','#goPlay'],['facy-run','#goPlay'],
  ];
  const SIZES=[[1920,1080],[390,844],[1366,768],[844,390],[1080,1920],[820,1180],[1280,1024],[360,640],[2560,1440],[1180,820]];

  async function open(g,vp){
    const c=await b.newContext({viewport:vp||{width:1366,height:768}});
    await c.route(u=>!u.href.startsWith(BASE),r=>r.abort());              // never the live scripts
    await c.addInitScript(()=>{ try{ localStorage.setItem('fx.player','Tester'); }catch(e){}
      /* frames within 400 ms of a change of window size are counted apart: a canvas
         has to be reallocated then, which a kiosk screen never does in play */
      window.__sx={max:0,maxResize:0,n:0,resizedAt:-1e9};
      addEventListener('resize',()=>{ window.__sx.resizedAt=performance.now(); });
      const raf=window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame=cb=>raf(t=>{ const a=performance.now(); cb(t); const d=performance.now()-a; const S=window.__sx; S.n++;
        if(a-S.resizedAt<400){ if(d>S.maxResize) S.maxResize=d; } else if(d>S.max) S.max=d; }); });
    const p=await c.newPage(); const errs=[];
    p.on('pageerror',e=>errs.push(e.message.slice(0,120)));
    p.on('console',m=>{ if(m.type()==='error' && !/cloudflare|ERR_FAILED|net::|404|script\.google/i.test(m.text())) errs.push(m.text().slice(0,120)); });
    await p.goto(BASE+'/'+g+'.html',{waitUntil:'load'});
    await sleep(1500);
    return {c,p,errs};
  }
  const mem=p=>p.evaluate(()=>{ try{ gc(); }catch(e){} return { heap:performance.memory?performance.memory.usedJSHeapSize:0, nodes:document.getElementsByTagName('*').length,
    canvases:document.getElementsByTagName('canvas').length }; });
  /* one burst of play: the game's own hook where it has one, else taps, drags and keys on the board */
  const burst=(p)=>p.evaluate(()=>{
    const H=window.__magictiles||window.__packslicer||window.__matchfactory;
    if(window.__magictiles){ const m=window.__magictiles,s=m.snapshot(); if(s.state==='play') m.lanes().forEach(t=>{ if(!t.dead&&Math.abs(t.y+s.cell*.31-s.hitY)<s.cell*.35) m.tapLane(t.lane); }); }
    else if(window.__packslicer){ const m=window.__packslicer; if(m.snapshot().state==='play') m.items().forEach(i=>{ if(!i.bomb) m.sliceAlong(i.x-90,i.y,i.x+90,i.y); }); }
    else if(window.__matchfactory){ const m=window.__matchfactory,s=m.snapshot(); if(s.state==='play'&&!s.busy){ const h=m.hint(); if(h) m.attemptSwap(h.c1,h.r1,h.c2,h.r2); } }
    else {
      const cv=[...document.querySelectorAll('canvas')].sort((a,b)=>b.offsetWidth*b.offsetHeight-a.offsetWidth*a.offsetHeight)[0];
      const keys=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ','a','d'];
      for(let k=0;k<4;k++){ const key=keys[(Math.random()*keys.length)|0];
        document.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true})); document.dispatchEvent(new KeyboardEvent('keyup',{key,bubbles:true})); }
      if(cv){ const r=cv.getBoundingClientRect(); for(let k=0;k<3;k++){ const x=r.left+Math.random()*r.width, y=r.top+Math.random()*r.height;
        const o={clientX:x,clientY:y,bubbles:true,pointerId:1,pointerType:'touch',isPrimary:true};
        cv.dispatchEvent(new PointerEvent('pointerdown',o)); cv.dispatchEvent(new PointerEvent('pointermove',{...o,clientX:x+30,clientY:y+10}));
        cv.dispatchEvent(new PointerEvent('pointerup',o)); cv.dispatchEvent(new MouseEvent('click',o)); } }
    }
    /* a run that has ended starts again: the button on the result screen, or the hook */
    const R=window.FX_RANK, res=R&&document.querySelector(R.result);
    if(res && !res.classList.contains('hidden')){
      if(H){ H.start('play'); return 'restart'; }
      const btn=[...res.querySelectorAll('button')].find(x=>x.offsetWidth&&/again|play|start/i.test(x.textContent));
      if(btn){ btn.click(); return 'restart'; }
    }
    return '';
  });

  console.log('\n2. every game, soaked for '+Math.round(SOAK/1000)+' s: round after round, rapid input, the window resized ten times');
  for(const [g,start] of GAMES.filter(x=>!process.env.GAME||x[0]===process.env.GAME)){
    const {c,p,errs}=await open(g);
    await p.click(start,{timeout:5000}).catch(()=>{});
    if(g==='pack-recall-4k') await p.evaluate(()=>window.__packrecall&&window.__packrecall.skipPreview()).catch(()=>{});
    await sleep(800);
    const m0=await mem(p);
    let restarts=0, resized=0; const t0=Date.now();
    while(Date.now()-t0<SOAK){
      const r=await burst(p).catch(()=>''); if(r==='restart') restarts++;
      const k=Math.floor((Date.now()-t0)/(SOAK/12));
      if(k>resized && k<=SIZES.length){ const [w,h]=SIZES[k-1]; await p.setViewportSize({width:w,height:h}); resized=k; }
      await sleep(60);
    }
    await p.setViewportSize({width:1366,height:768}); await sleep(600);
    const m1=await mem(p);
    const sx=await p.evaluate(()=>window.__sx);
    const grow=Math.round((m1.heap-m0.heap)/1024);
    console.log(`     ${g.padEnd(17)} rounds restarted ${String(restarts).padStart(3)} · heap ${grow>=0?'+':''}${grow} KB · DOM ${m0.nodes}→${m1.nodes} · canvases ${m0.canvases}→${m1.canvases} · longest frame of script ${sx.max.toFixed(1)} ms in play, ${sx.maxResize.toFixed(1)} ms on a resize`);
    chk(g+': no errors', errs.length===0, errs.slice(0,3));
    chk(g+': memory holds (under 8 MB of growth)', grow<8192, grow);
    chk(g+': the page does not pile up elements or canvases', m1.nodes-m0.nodes<150 && m1.canvases<=m0.canvases+1, [m0,m1]);
    chk(g+': no frame of play spent more than 50 ms in script', sx.max<50, sx.max);
    chk(g+': a change of window size costs under 100 ms, once', sx.maxResize<100, sx.maxResize);
    await c.close();
  }

  console.log('\n3. eight games open at once, as on a row of kiosks');
  {
    const opened=[];
    for(const [g,start] of GAMES.slice(0,8)){ const o=await open(g,{width:960,height:540}); await o.p.click(start,{timeout:5000}).catch(()=>{}); opened.push(o); }
    const t0=Date.now();
    while(Date.now()-t0<20000){ await Promise.all(opened.map(o=>burst(o.p).catch(()=>''))); await sleep(80); }
    const errs=opened.flatMap(o=>o.errs);
    const alive=await Promise.all(opened.map(o=>o.p.evaluate(()=>window.__sx.n).catch(()=>-1)));
    chk('all eight kept running and answering', alive.every(n=>n>0), alive);
    chk('no errors on any of them', errs.length===0, errs.slice(0,4));
    for(const o of opened) await o.c.close();
  }
  await b.close(); srv.close();
}

console.log('\n'+(bad?bad+' FAILED':'all passed')); process.exit(bad?1:0);
