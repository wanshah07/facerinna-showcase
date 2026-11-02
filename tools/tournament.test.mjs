/* The tournament, played through as a visitor plays it.

   The lobby lists the ticked games easy to hard whatever order the setting
   names them in, a run goes game page to game page with the banner and no
   Redeem gift, each round books once and shows the card with the way on, the
   last round lands on the total, the total is booked on the Tournament board
   once, and the lobby is closed while the admin has it off (open to an admin).
   Every call to the booth scripts is answered here: nothing reaches the live
   ranking. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8275, BASE='http://127.0.0.1:'+PORT;
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++; console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.jpg':'image/jpeg','.json':'application/json'};
const srv=http.createServer((q,r)=>{
  const f=decodeURIComponent(new URL(q.url,BASE).pathname), fp=path.join(ROOT,f==='/'?'/index.html':f);
  if(f==='/sw.js'||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ r.writeHead(404); return r.end(); }
  r.writeHead(200,{'Content-Type':TYPES[path.extname(fp)]||'application/octet-stream','Cache-Control':'no-store'}); r.end(fs.readFileSync(fp));
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch();

async function ctx(settings, opts={}){
  const c=await b.newContext({viewport:opts.vp||{width:1366,height:768},isMobile:!!opts.mob,hasTouch:!!opts.mob,deviceScaleFactor:opts.dsf||1});
  const posts=[], cfgCalls=[];
  await c.route(u=>!u.href.startsWith(BASE),r=>r.abort());                  // never the live scripts
  await c.route('https://script.google.com/**',async r=>{                     // the scores script, answered here
    let q={}; try{ q=JSON.parse(r.request().postData()||'{}'); }catch(e){}
    if(r.request().method()==='POST') posts.push(q);
    await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,rows:[],games:{}})});
  });
  await c.route(BASE+'/api',async r=>{
    let q={}; try{ q=JSON.parse(r.request().postData()||'{}'); }catch(e){}
    cfgCalls.push(q);
    const out=q.action==='config'?{ok:true,settings:Object.assign({gift_active:'no',games_off:''},settings),gift_needs:opts.needs||{},tour_max:opts.max||{},tour_default:1500}:{ok:true};
    await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(out)});
  });
  await c.addInitScript(([api,admin])=>{ window.__BOOTH_API=api; try{ localStorage.setItem('fx.player','Tester'); if(admin) localStorage.setItem('fx.admin.token','tok'); }catch(e){} },[BASE+'/api',!!opts.admin]);
  const p=await c.newPage(); const errs=[];
  p.on('pageerror',e=>errs.push(e.message));
  return {c,p,errs,posts,cfgCalls};
}
const until=async(p,fn,arg,ms=9000)=>{ const t=Date.now(); while(Date.now()-t<ms){ try{ if(await p.evaluate(fn,arg)) return true; }catch(e){} await sleep(40);} return false; };

console.log('\nthe lobby');
{
  const {c,p,errs}=await ctx({tour_active:'yes',tour_games:'pack-recall,magic-tiles,match-factory'});
  await p.goto(BASE+'/tournament.html'); await until(p,()=>!document.getElementById('tLobby').hidden);
  const L=await p.evaluate(()=>({names:[...document.querySelectorAll('#tStages .stage .nm')].map(e=>e.firstChild.textContent),
    lv:[...document.querySelectorAll('#tStages .stage em')].map(e=>e.textContent),title:document.getElementById('tTitle').textContent,
    go:document.getElementById('tGo').textContent,admin:document.getElementById('tAdmin').hidden}));
  chk('the ticked games, easy to hard, whatever order the setting names them', L.names.join()==='Magic Tiles,Match Factory,Pack Recall', L.names);
  chk('each with its level', L.lv.join()==='Easy,Easy,Hard', L.lv);
  chk('the heading counts them', L.title==='Three games, easy to hard', L.title);
  chk('one button to start, no admin note for a visitor', /Start the tournament/.test(L.go) && L.admin, L);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
{
  const {c,p}=await ctx({tour_active:'yes',tour_games:'magic-tiles,deep-lab',games_off:'deep-lab'});
  await p.goto(BASE+'/tournament.html'); await until(p,()=>!document.getElementById('tLobby').hidden);
  chk('a game switched off is skipped', (await p.evaluate(()=>document.querySelectorAll('#tStages .stage').length))===1);
  await c.close();
}
{
  const {c,p}=await ctx({tour_active:'no',tour_games:'magic-tiles'});
  await p.goto(BASE+'/tournament.html'); await until(p,()=>!document.getElementById('tClosed').hidden);
  chk('switched off: a visitor sees it resting', await p.evaluate(()=>!document.getElementById('tClosed').hidden && /resting/.test(document.getElementById('tClosedH').textContent)));
  await c.close();
}
{
  const {c,p}=await ctx({tour_active:'no',tour_games:'magic-tiles'},{admin:true});
  await p.goto(BASE+'/tournament.html'); await until(p,()=>!document.getElementById('tLobby').hidden);
  chk('switched off: an admin can still try it, and is told it is off', await p.evaluate(()=>!document.getElementById('tLobby').hidden && !document.getElementById('tAdmin').hidden));
  await c.close();
}
{
  const {c,p}=await ctx({tour_active:'yes',tour_games:''});
  await p.goto(BASE+'/tournament.html'); await until(p,()=>!document.getElementById('tClosed').hidden);
  chk('on but with no games: says none are picked', /No games/.test(await p.textContent('#tClosedH')));
  await c.close();
}

console.log('\na whole run: Magic Tiles, Match Factory, Pack Recall');
{
  const {c,p,errs,posts}=await ctx({tour_active:'yes',tour_games:'magic-tiles,match-factory,pack-recall'},{needs:{'magic-tiles':300,'match-factory':700}});
  await p.goto(BASE+'/tournament.html'); await until(p,()=>!document.getElementById('tLobby').hidden);
  await Promise.all([p.waitForURL(/magic-tiles-4k\.html\?tour=/), p.click('#tGo')]);
  await until(p,()=>!!window.__magictiles && !!document.getElementById('fxTourBar'));
  const r1=await p.evaluate(()=>({bar:document.getElementById('fxTourBar').textContent,gift:getComputedStyle(document.getElementById('goGift')).display,
    round:window.__fxTourRound}));
  chk('round 1 opens Magic Tiles with the banner', /Game 1 of 3/.test(r1.bar), r1);
  chk('...and no Redeem gift on a round', r1.gift==='none', r1.gift);
  // play a little, then let the tiles through
  await p.click('#goPlay'); const t0=Date.now();
  while(Date.now()-t0<6000){ await p.evaluate(()=>{ const m=window.__magictiles,s=m.snapshot(); if(s.state!=='play') return; m.lanes().forEach(t=>{ if(!t.dead&&Math.abs(t.y+s.cell*.31-s.hitY)<s.cell*.35) m.tapLane(t.lane); }); }); await sleep(35); }
  await until(p,()=>window.__magictiles.snapshot().state==='over',null,40000);
  const raw1=await p.evaluate(()=>window.__magictiles.snapshot().score);
  await until(p,()=>!!document.getElementById('fxTour'),null,5000);
  const d1=await p.evaluate(()=>({done:window.__fxTourDone,text:document.getElementById('fxTour').innerText}));
  const want1=Math.round(1000*Math.min(1.5,raw1/300));
  chk('the round is booked from the result screen: '+raw1+' points makes '+want1+' tournament points (target 300)', d1.done && d1.done.raw===raw1 && d1.done.pts===want1, d1.done);
  chk('the card names the next game and its level', /Next: Match Factory/.test(d1.text) && /Easy/.test(d1.text), d1.text);
  // a second showing of the result must not book again
  await p.evaluate(()=>{ const r=document.getElementById('result'); r.classList.add('hidden'); setTimeout(()=>r.classList.remove('hidden'),50); }); await sleep(500);
  const s1=await p.evaluate(()=>JSON.parse(localStorage.getItem('fx.tour')));
  chk('the result coming up again does not book the round twice', s1.i===1 && s1.pts.length===1, s1);

  await Promise.all([p.waitForURL(/match-factory-4k\.html\?tour=/), p.click('#fxTour .ft-go')]);
  await until(p,()=>!!window.__matchfactory && !!document.getElementById('fxTourBar'));
  chk('round 2 is Match Factory, Game 2 of 3', /Game 2 of 3/.test(await p.textContent('#fxTourBar')));
  await p.click('#goPlay'); await sleep(1500);
  const t1=Date.now();
  while(Date.now()-t1<90000){ const st=await p.evaluate(()=>{ const m=window.__matchfactory,s=m.snapshot(); if(s.state==='play'&&!s.busy){ const h=m.hint(); if(h) m.attemptSwap(h.c1,h.r1,h.c2,h.r2);} return s.state; }); if(st==='over') break; await sleep(40); }
  await until(p,()=>!!document.getElementById('fxTour'),null,6000);
  const d2=await p.evaluate(()=>window.__fxTourDone);
  chk('round 2 booked, '+(d2&&d2.pts)+' points', d2 && d2.pts===Math.round(1000*Math.min(1.5,d2.raw/700)), d2);

  await Promise.all([p.waitForURL(/pack-recall-4k\.html\?tour=/), p.click('#fxTour .ft-go')]);
  await until(p,()=>!!window.__packrecall && !!document.getElementById('fxTourBar'));
  chk('round 3 is Pack Recall, Game 3 of 3', /Game 3 of 3/.test(await p.textContent('#fxTourBar')));
  await p.click('#goPlay');
  await until(p,()=>window.__packrecall.state()==='preview'||window.__packrecall.state()==='play');
  await p.evaluate(()=>window.__packrecall.skipPreview()); await until(p,()=>window.__packrecall.state()==='play');
  for(let k=0;k<12;k++){ const st=await p.evaluate(()=>window.__packrecall.state()); if(st!=='play'){ if(st==='over') break; await sleep(200); continue; }
    const pr=await p.evaluate(()=>{ const cs=window.__packrecall.cards().filter(c=>!c.matched); const a=cs[0]; const o=cs.find(c=>c.pair!==a.pair); return [a.i,o.i]; });
    await p.evaluate(i=>window.__packrecall.tap(i),pr[0]); await p.evaluate(i=>window.__packrecall.tap(i),pr[1]); await sleep(900); }
  await until(p,()=>window.__packrecall.state()==='over',null,15000);
  await until(p,()=>!!document.getElementById('fxTour'),null,6000);
  const d3=await p.evaluate(()=>({done:window.__fxTourDone,text:document.getElementById('fxTour').innerText}));
  chk('the last round says so: see my tournament result', /See my tournament result/.test(d3.text) && /tournament\.html\?tour=/.test(d3.done.next), d3);

  const before=posts.filter(q=>q.game==='tournament').length;
  await Promise.all([p.waitForURL(/tournament\.html\?tour=/), p.click('#fxTour .ft-go')]);
  await until(p,()=>!!window.__tourFinished,null,8000);
  const fin=await p.evaluate(()=>({t:window.__tourFinished,shown:!document.getElementById('tResult').classList.contains('hidden'),
    total:document.getElementById('tTotal').textContent,rows:document.querySelectorAll('#tBreak .stage').length,state:localStorage.getItem('fx.tour')}));
  const sum=want1+d2.pts+d3.done.pts;
  chk('the total is the sum of the three rounds ('+sum+')', fin.t.total===sum && fin.total===String(sum) && fin.rows===3, fin);
  chk('the run is cleared from the device', fin.state===null);
  await sleep(1500);
  const booked=posts.filter(q=>q.game==='tournament');
  chk('the total is booked once on the Tournament board', booked.length===before+1 && booked[booked.length-1].score===sum, booked);
  await p.reload(); await until(p,()=>!document.getElementById('tLast').hidden,null,6000); await sleep(1200);
  chk('opening the result again shows it, without booking it again', posts.filter(q=>q.game==='tournament').length===before+1 && (await p.textContent('#tLastTotal'))===sum.toLocaleString('en-US'));
  chk('no page errors through the whole run', errs.length===0, errs);
  await c.close();
}

console.log('\npoints set per game, time and level kept, and the winner rule');
{
  const {c,p,errs,posts}=await ctx({tour_active:'yes',tour_games:'magic-tiles'},{needs:{'magic-tiles':300},max:{'magic-tiles':2500}});
  await p.goto(BASE+'/tournament.html'); await until(p,()=>!document.getElementById('tLobby').hidden);
  const L=await p.evaluate(()=>({st:document.querySelector('#tStages .stage .st').textContent, rule:document.querySelector('.rule').textContent}));
  chk('the lobby shows what this game can give: up to 2,500 pts', /up to 2,500 pts/.test(L.st), L.st);
  chk('...and says who wins: the most points, then the fastest, then the highest level', /most points/.test(L.rule) && /fastest/.test(L.rule) && /highest level/.test(L.rule), L.rule);
  await Promise.all([p.waitForURL(/magic-tiles-4k\.html\?tour=/), p.click('#tGo')]);
  await until(p,()=>!!window.__magictiles && !!document.getElementById('fxTourBar'));
  await p.click('#goPlay'); await sleep(1500);
  await p.evaluate(()=>window.__magictiles.addScore(500));              // past one and a half times the 300 target
  await until(p,()=>window.__magictiles.snapshot().state==='over',null,40000);
  await until(p,()=>!!document.getElementById('fxTour'),null,6000);
  const d=await p.evaluate(()=>({text:document.getElementById('fxTour').innerText, done:window.__fxTourDone, run:JSON.parse(localStorage.getItem('fx.tour'))}));
  chk('one and a half times the target earns ALL of the game\'s own points: +2,500 of 2,500', /2,500 of 2,500/.test(d.text) && d.done.pts===2500, d.text);
  chk('the card shows the time and the level', /Time/.test(d.text) && /\d+:\d\d \u00B7 L\d+/.test(d.text), d.text);
  chk('the round keeps its time (at least a second) and level (at least 1)', d.run.secs[0]>=1 && d.run.lvl[0]>=1, d.run);
  await Promise.all([p.waitForURL(/tournament\.html\?tour=/), p.click('#fxTour .ft-go')]);
  await until(p,()=>!!window.__tourFinished,null,8000); await sleep(1500);
  const sent=posts.filter(q=>q.game==='tournament');
  chk('the total is sent with the time and the level, so a tie can be settled', sent.length===1 && sent[0].score===2500 && sent[0].secs>=1 && sent[0].level>=1, sent);
  chk('the result says the time and levels', /Time \d+:\d\d . Levels \d+/.test(await p.textContent('#tSum')));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}
{
  /* the default is 1,500 where the admin has set nothing, and the target earns two thirds of it */
  const {c,p}=await ctx({tour_active:'yes',tour_games:'magic-tiles'},{needs:{'magic-tiles':300}});
  await p.goto(BASE+'/tournament.html'); await until(p,()=>!document.getElementById('tLobby').hidden);
  chk('with nothing set, a game is worth up to 1,500', /up to 1,500 pts/.test(await p.textContent('#tStages .stage .st')));
  chk('the points rule: the target earns two thirds, one and a half times earns all', await p.evaluate(()=>fxTour.points(300,300,1500)===1000 && fxTour.points(450,300,1500)===1500 && fxTour.points(9000,300,1500)===1500 && fxTour.points(300,300,2400)===1600 && fxTour.points(0,300,1500)===0));
  await c.close();
}

console.log('\na game page opened on its own is untouched');
{
  const {c,p,errs}=await ctx({tour_active:'yes',tour_games:'magic-tiles'});
  await p.goto(BASE+'/magic-tiles-4k.html'); await until(p,()=>!!window.__magictiles);
  chk('no banner, Redeem gift still there', await p.evaluate(()=>!document.getElementById('fxTourBar') && getComputedStyle(document.getElementById('goGift')).display!=='none'));
  await p.goto(BASE+'/magic-tiles-4k.html?tour=nonsense'); await until(p,()=>!!window.__magictiles);
  chk('nor with a run id that is not this device\'s', await p.evaluate(()=>!document.getElementById('fxTourBar')));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\nthe booth page button');
for (const [label,set,admin,want] of [['on, three games',{tour_active:'yes',tour_games:'magic-tiles,pack-match,facy-run'},false,'shown'],
                                       ['off',{tour_active:'no',tour_games:'magic-tiles'},false,'hidden'],
                                       ['on, no games',{tour_active:'yes',tour_games:''},false,'hidden']]){
  const {c,p,errs}=await ctx(set,{admin});
  await p.goto(BASE+'/index.html'); await sleep(2500);
  const v=await p.evaluate(()=>{ const b=document.getElementById('tourBtn'); return {hidden:b.hidden||getComputedStyle(b).display==='none',text:b.textContent}; });
  chk(label+': the Tournament button is '+want+(want==='shown'?' ("'+v.text+'")':''), want==='shown'? (!v.hidden && /three games, easy to hard/.test(v.text)) : v.hidden, v);
  chk(label+': no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\nevery round page carries the tournament script before the ranking');
for (const f of ['magic-tiles-4k','pack-match','match-factory-4k','pack-slicer-4k','match-lab','pack-crush-4k','shelf-shot','pack-recall-4k','pack-drop-4k','deep-lab','lab-run','facy-run']){
  const s=fs.readFileSync(path.join(ROOT,f+'.html'),'utf8');
  const a=s.indexOf('src="fx-tour.js"'), r=s.indexOf('src="fx-rank.js"'), k=s.indexOf('window.FX_RANK');
  chk(f+': FX_RANK, then fx-tour.js, then fx-rank.js', k>=0 && a>k && r>a);
}

await b.close(); srv.close();
console.log('\n'+(bad?bad+' FAILED':'all passed')); process.exit(bad?1:0);
