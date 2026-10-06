/* Turning a game on or off from the admin page: the real booth script (Google
   services stubbed, see booth-admin-harness.mjs) behind a local server, and
   the real pages in a browser.

   What it has to do: an admin, or staff with the Games area, can untick a
   game and save; nobody else can. The booth page then leaves it off the
   wheel, the ranking board, the headline and the chat, and the wheel closes
   up round the games that are left. The game's own page shows a resting card
   to a visitor who opens it from an old link, and the script gives no gift
   for it. Ticking it again brings all of that back. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { load, OWNER } from './booth-admin-harness.mjs';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8211, BASE='http://127.0.0.1:'+PORT, API=BASE+'/api';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, ms=6000, step=80){ const t=Date.now(); while(Date.now()-t<ms){ if(await fn()) return true; await sleep(step);} return fn(); }

const H = load();
const asked=[];
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.webmanifest':'application/manifest+json'};
const srv=http.createServer((req,res)=>{
  const u=new URL(req.url,BASE);
  if(u.pathname==='/api'){
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
      let out; try{ const b=JSON.parse(body||'{}'); asked.push(b.action); out=H.call(b); }catch(e){ out={ok:false,error:String(e.message)}; }
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(out));
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

const setting = k => (H.tabs['Settings'].rows.find(r=>r[0]===k)||[])[1];

/* ------------------------------------------------------------ the script */
console.log('the script');
const own = H.signIn(OWNER);
{
  chk('setUp writes a games_off row, empty: every game on', setting('games_off')==='', H.tabs['Settings'].rows.map(r=>r[0]));
  const cfg = H.call({action:'config'});
  chk('config lists the nine games in wheel order',
      (cfg.games||[]).map(g=>g[0]).join()==='match-lab,pack-match,shelf-shot,deep-lab,lab-run,uv-card,skin-iq,facy-run,lucky-wheel', cfg.games);
  chk('config says none are off', cfg.settings.games_off==='', cfg.settings.games_off);
  const g = H.call({action:'admin.get', token:own.token});
  chk('Games is one of the areas, with what it does', g.perms.some(p=>p[0]==='games' && /on or off/.test(p[2])), g.perms);
  chk('admin.get carries the list too', (g.games||[]).length===9);

  let r = H.call({action:'admin.settings', token:own.token, settings:{games_off:' UV-Card, deep-lab;nope uv-card '}});
  chk('an admin saves it, read the way a person types it: case, separators, unknown and twice',
      r.ok && setting('games_off')==='uv-card,deep-lab', [r, setting('games_off')]);
  chk('the public config says so', H.call({action:'config'}).settings.games_off==='uv-card,deep-lab');
  /* a person typing straight into the sheet is read the same way */
  H.tabs['Settings'].rows.find(x=>x[0]==='games_off')[1]='Deep-Lab  FACY-RUN, x';
  /* a hand edit reaches the page when the script's cached copy of the config
     runs out (twenty seconds); an admin save drops it at once, a typed cell cannot */
  H.CACHE.clear();
  chk('...and so is the sheet, edited by hand', H.call({action:'config'}).settings.games_off==='deep-lab,facy-run');
  H.call({action:'admin.settings', token:own.token, settings:{games_off:'uv-card,deep-lab'}});

  H.call({action:'admin.team.save', token:own.token, person:{email:'g@clinic.test', name:'Games', role:'staff', access:['games']}});
  H.call({action:'admin.team.save', token:own.token, person:{email:'c@clinic.test', name:'Counter', role:'staff', access:['counter']}});
  const gs = H.signIn('g@clinic.test'), cs = H.signIn('c@clinic.test');
  const gget = H.call({action:'admin.get', token:gs.token});
  chk('staff with Games see that setting and no other', Object.keys(gget.settings).join()==='games_off', gget.settings);
  chk('...and preview the page whole, as an admin does', H.call({action:'whoami', token:gs.token}).preview===true);
  r = H.call({action:'admin.settings', token:gs.token, settings:{games_off:'uv-card'}});
  chk('...and can change it', r.ok && setting('games_off')==='uv-card', r);
  r = H.call({action:'admin.settings', token:cs.token, settings:{games_off:''}});
  chk('counter staff cannot: refused, naming the area', r.ok===false && r.area==='games', r);
  chk('...and the sheet is untouched', setting('games_off')==='uv-card');
  r = H.call({action:'admin.settings', token:gs.token, settings:{games_off:'', welcome:'hide'}});
  chk('a save reaching outside Games is refused whole', r.ok===false && setting('games_off')==='uv-card', r);

  /* the gift: a game that is off gives none */
  H.call({action:'admin.stock.set', token:own.token, product:'Ceramide B5 Balancing Moisturizer', quantity:5});
  H.call({action:'admin.settings', token:own.token, settings:{gift_active:'yes', gift_points:'facy-run = 6000\nlab-run = 100', games_off:'facy-run'}});
  r = H.call({action:'gift.claim', device:'devoff01', score:9000, game:'facy-run'});
  chk('a game that is off gives no gift', r.ok===false && r.reason==='gameoff', r);
  r = H.call({action:'gift.claim', device:'devon001', score:900, game:'lab-run'});
  chk('...a game that is on still does', r.ok===true && !!r.claim, r);
  H.call({action:'admin.settings', token:own.token, settings:{games_off:''}});
  r = H.call({action:'gift.claim', device:'devoff01', score:9000, game:'facy-run'});
  chk('...and switched back on, it gives again', r.ok===true, r);
  H.call({action:'admin.settings', token:own.token, settings:{gift_active:'no'}});
}

/* ------------------------------------------------------------ the pages */
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
async function open(url, {admin=null, w=1280, h=900, mob=false, cache=null}={}){
  const c=await b.newContext({viewport:{width:w,height:h},isMobile:mob,hasTouch:mob});
  await c.addInitScript(([a,t,cfg])=>{ window.__BOOTH_API=a;
    try{ localStorage.setItem('fx.player','Aina');
         if(t) localStorage.setItem('fx.admin.token',t);
         if(cfg) localStorage.setItem('fx.booth.config', JSON.stringify(cfg)); }catch(e){} }, [API, admin, cache]);
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  p.on('dialog', d=>d.accept());
  await p.goto(BASE+url,{waitUntil:'load'});
  return {c,p,errs};
}
const wheel = p => p.evaluate(()=>{
  const on=[...document.querySelectorAll('#gameRing .cg-item')].filter(el=>getComputedStyle(el).display!=='none');
  return { ids:on.map(el=>el.dataset.game), nums:on.map(el=>el.querySelector('.cg-num').textContent),
           idx:on.map(el=>el.style.getPropertyValue('--i')),
           step:document.getElementById('gameRing').style.getPropertyValue('--cg-step'),
           head:document.getElementById('gameHeadline').textContent,
           intro:document.getElementById('gameIntro').textContent,
           rank:document.getElementById('rankBtn').textContent,
           rankShown:!document.getElementById('rankBtn').closest('[hidden]'),
           wheelShown:!document.getElementById('gameGallery').closest('[hidden]'),
           quiz:getComputedStyle(document.getElementById('skinIQ')).display,
           ribbon:(document.getElementById('boothRibbon')||{}).textContent||'' };
});

console.log('\nthe admin page');
{
  const {c,p,errs}=await open('/admin.html', {admin:own.token});
  await until(()=>p.evaluate(()=>!document.getElementById('app').hidden));
  await until(()=>p.evaluate(()=>document.querySelectorAll('#gameToggles input').length===9));
  const v = await p.evaluate(()=>({ shown:!document.getElementById('cardGames').hidden,
    names:[...document.querySelectorAll('#gameToggles label span')].map(l=>l.textContent),
    on:[...document.querySelectorAll('#gameToggles input')].filter(i=>i.checked).length,
    note:document.getElementById('gamesCount').textContent }));
  chk('the Games card is on the Settings tab', v.shown, v);
  chk('...a switch per game, by name, all on', v.names.length===9 && v.names[5]==='UV Card' && v.names[8]==='Lucky Wheel' && v.on===9, v);
  chk('...and it says so', /All 9 games are on/.test(v.note), v.note);
  await p.click('#gameToggles input[data-game="uv-card"]');
  await p.click('#gameToggles input[data-game="deep-lab"]');
  chk('unticking counts down at once', /7 of 9 games on/.test(await p.textContent('#gamesCount')));
  chk('...and each row says ON or OFF in words', await p.evaluate(()=>[...document.querySelectorAll('#gameToggles label b')].map(x=>x.textContent).join())==='ON,ON,ON,OFF,ON,OFF,ON,ON,ON');
  chk('...and strikes the name through', await p.evaluate(()=>getComputedStyle(document.querySelector('#gameToggles input[data-game="uv-card"]').nextSibling).textDecorationLine==='line-through'));
  await p.click('#saveSettings');
  await until(()=>setting('games_off')==='deep-lab,uv-card' || setting('games_off')==='uv-card,deep-lab');
  chk('Save settings writes them to the sheet', /deep-lab/.test(setting('games_off')) && /uv-card/.test(setting('games_off')), setting('games_off'));
  await p.reload({waitUntil:'load'});
  await until(()=>p.evaluate(()=>document.querySelectorAll('#gameToggles input').length===9));
  await sleep(300);
  chk('...and they come back unticked after a reload',
      await p.evaluate(()=>[...document.querySelectorAll('#gameToggles input')].filter(i=>!i.checked).map(i=>i.dataset.game).sort().join())==='deep-lab,uv-card');
  chk('no page errors', errs.length===0, errs);
  await c.close();

  /* A booth script from before the switch sends no games list and would drop
     the setting without a word, so the card says so instead of pretending. */
  {
    const o = await open('/admin.html', {admin:own.token});
    await o.p.route(API, async route=>{
      const r = await route.fetch(); const j = await r.json();
      if(j && j.games) delete j.games;
      await route.fulfill({response:r, json:j});
    });
    await o.p.reload({waitUntil:'load'});
    await until(()=>o.p.evaluate(()=>document.querySelectorAll('#gameToggles input').length===9));
    await sleep(300);
    const v = await o.p.evaluate(()=>({ warn:!document.getElementById('gamesOld').hidden,
      text:document.getElementById('gamesOld').textContent,
      off:[...document.querySelectorAll('#gameToggles input')].every(i=>i.disabled) }));
    chk('an old script: the card says to deploy the new one, and the switches are greyed', v.warn && /deploy/.test(v.text) && v.off, v);
    const sent = [];
    o.p.on('request', q=>{ if(q.url()===API){ try{ sent.push(JSON.parse(q.postData()||'{}')); }catch(e){} } });
    await o.p.click('#saveSettings'); await sleep(800);
    const save = sent.find(x=>x.action==='admin.settings');
    chk('...and Save settings does not send it', save && !('games_off' in save.settings), save);
    await o.c.close();
  }

  /* staff without Games do not get the card */
  const cs = H.signIn('c@clinic.test');
  const o = await open('/admin.html', {admin:cs.token});
  await until(()=>o.p.evaluate(()=>!document.getElementById('app').hidden));
  await sleep(300);
  chk('counter staff do not see the Games card', await o.p.evaluate(()=>!!document.getElementById('cardGames').closest('[hidden]')));
  await o.c.close();
}

console.log('\nthe booth page, for a visitor');
{
  const {c,p,errs}=await open('/index.html');
  await until(()=>p.evaluate(()=>document.querySelectorAll('#gameRing .cg-off').length===2));
  let w = await wheel(p);
  chk('the two games are off the wheel', w.ids.join()==='match-lab,pack-match,shelf-shot,lab-run,skin-iq,facy-run,lucky-wheel', w.ids);
  chk('...the seven left are numbered 01 to 07', w.nums.join()==='01,02,03,04,05,06,07', w.nums);
  chk('...and spread round the whole ring', w.step===(360/7)+'deg' && w.idx.join()==='0,1,2,3,4,5,6', [w.step, w.idx]);
  chk('the headline counts seven', w.head==='Seven games, one booth', w.head);
  chk('the intro names the seven and only them', /^Match Lab, Pack Match, Shelf Shot, Lab Run, Skin IQ Challenge, Facy Run and Lucky Wheel/.test(w.intro) && !/UV Card|Deep Lab|Eight/.test(w.intro), w.intro);
  chk('the ranking board counts six scored games (UV Card never had a column)', /all six games/.test(w.rank), w.rank);
  await p.evaluate(()=>{ const t=Date.now();
    localStorage.setItem('fx.rank.deep-lab', JSON.stringify([{n:'Deepa',s:900,t}]));
    localStorage.setItem('fx.rank.lab-run', JSON.stringify([{n:'Rina',s:700,t}]));
    document.getElementById('rankBtn').click(); });
  await sleep(300);
  const cols = await p.evaluate(()=>document.getElementById('rankModal').innerText);
  chk('...and the board leaves Deep Lab out, scores and all', !/Deep Lab|Deepa/.test(cols) && /Rina/.test(cols), cols.slice(0,600));
  await p.keyboard.press('Escape');
  chk('no admin ribbon for a visitor', w.ribbon==='', w.ribbon);
  chk('no page errors', errs.length===0, errs);

  /* switch the quiz off too, and watch an open page catch up */
  H.call({action:'admin.settings', token:own.token, settings:{games_off:'uv-card,deep-lab,skin-iq'}});
  await p.evaluate(()=>window.__boothRefresh(true));
  await until(()=>p.evaluate(()=>document.querySelectorAll('#gameRing .cg-off').length===3));
  w = await wheel(p);
  chk('an open page catches up: six left, renumbered', w.ids.length===6 && w.nums.join()==='01,02,03,04,05,06' && w.step==='60deg', w);
  chk('...and the quiz panel goes with its card', w.quiz==='none', w.quiz);
  chk('the chat answer lists only what is on',
      await p.evaluate(()=>{ const off=window.__fxGamesOff; return off.join(); })==='uv-card,deep-lab,skin-iq');

  /* every game off */
  H.call({action:'admin.settings', token:own.token, settings:{games_off:'match-lab,pack-match,shelf-shot,deep-lab,lab-run,uv-card,skin-iq,facy-run,lucky-wheel'}});
  await p.evaluate(()=>window.__boothRefresh(true));
  await until(()=>p.evaluate(()=>document.querySelectorAll('#gameRing .cg-off').length===9));
  w = await wheel(p);
  chk('all off: no wheel, no ranking button, and the page says they are resting',
      !w.wheelShown && !w.rankShown && /resting/.test(w.intro) && w.head==='No games, one booth', w);

  /* and back on */
  H.call({action:'admin.settings', token:own.token, settings:{games_off:''}});
  await p.evaluate(()=>window.__boothRefresh(true));
  await until(()=>p.evaluate(()=>document.querySelectorAll('#gameRing .cg-off').length===0));
  w = await wheel(p);
  chk('all back on: nine on the wheel, 01 to 09, at 40 degrees', w.ids.length===9 && w.nums[8]==='09' && w.step==='40deg', w);
  chk('...the headline and the intro are the originals again', w.head==='Nine games, one booth' && /^Nine challenges built for the booth/.test(w.intro), w);
  chk('...and the board is back to seven', /all seven games/.test(w.rank) && w.rankShown, w.rank);
  chk('no page errors after all that', errs.length===0, errs);
  await c.close();
}

console.log('\nthe chat');
{
  H.call({action:'admin.settings', token:own.token, settings:{games_off:'uv-card,facy-run'}});
  const {c,p,errs}=await open('/index.html');
  await until(()=>p.evaluate(()=>document.querySelectorAll('#gameRing .cg-off').length===2));
  await p.click('#chatFab'); await sleep(400);
  await p.fill('#chatIn','what games can I play');
  await p.click('#chatSend');
  await until(()=>p.evaluate(()=>/games at this booth/.test(document.getElementById('chatMsgs').innerText)), 5000);
  const said = await p.evaluate(()=>{ const box=document.getElementById('chatMsgs'); return box ? box.innerText : null; });
  if(said===null) chk('the chat box is where the test expects it', false);
  else {
    chk('the chat says seven games', /Seven games at this booth/.test(said), said.slice(-400));
    chk('...and leaves out the two that are off', !/UV Card|Facy Run/.test(said.slice(said.lastIndexOf('games at this booth'))), said.slice(-400));
  }
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\nthe booth page, for an admin');
{
  const {c,p,errs}=await open('/index.html', {admin:own.token});
  await until(()=>p.evaluate(()=>(document.getElementById('boothRibbon')||{}).textContent||'').then(t=>/off/.test(t)));
  /* An admin on the same browser sees what a visitor sees -- an off game is off --
     because a page that still showed everything read as the switch not working.
     The ribbon names what is off and offers the preview. */
  let w = await wheel(p);
  chk('an admin sees the page as a visitor does: the off games are not on the wheel', w.ids.length===7 && !w.ids.includes('uv-card') && !w.ids.includes('facy-run'), w.ids);
  chk('...and the ribbon says which are off, with a button to show them', /UV Card, Facy Run are off/.test(w.ribbon) && /Show the hidden parts/.test(w.ribbon), w.ribbon);
  await p.click('#boothPreviewBtn'); await sleep(400);
  w = await wheel(p);
  chk('the button shows every game', w.ids.length===9, w.ids);
  const marks = await p.evaluate(()=>[...document.querySelectorAll('#gameRing .cg-item')].map(el=>({id:el.dataset.game,
    off:el.classList.contains('cg-adminoff'), label:getComputedStyle(el,'::after').content,
    grey:getComputedStyle(el.querySelector('.cg-card')).filter})));
  chk('...the off ones greyed and labelled',
      marks.filter(m=>m.off).map(m=>m.id).join()==='uv-card,facy-run' &&
      marks.filter(m=>m.off).every(m=>/OFF/.test(m.label) && /grayscale/.test(m.grey)), marks);
  chk('...and the ones that are on look as they always did',
      marks.filter(m=>!m.off).every(m=>m.label==='none' && m.grey==='none'), marks.filter(m=>!m.off));
  chk('...and the ribbon offers the way back', /Back to the visitor view/.test(w.ribbon), w.ribbon);
  await p.click('#boothPreviewBtn'); await sleep(400);
  chk('back to the visitor view: the off games are gone again', (await wheel(p)).ids.length===7);
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

console.log('\na game page opened directly');
{
  /* Facy Run is off (above). A visitor arriving from an old link: */
  let {c,p,errs}=await open('/facy-run.html', {mob:true, w:390, h:844});
  await until(()=>p.evaluate(()=>!!document.getElementById('fxRest')));
  let v = await p.evaluate(()=>{ const r=document.getElementById('fxRest'); if(!r) return null;
    const a=r.querySelector('a'), box=r.getBoundingClientRect(), ab=a.getBoundingClientRect();
    return { text:r.innerText, href:a.getAttribute('href'), covers:box.width>=innerWidth-1&&box.height>=innerHeight-1,
             tall:ab.height, top:document.elementFromPoint(innerWidth/2, 40)===r||r.contains(document.elementFromPoint(innerWidth/2,40)) }; });
  chk('an off game shows the resting card', v && /This game is resting/.test(v.text), v);
  chk('...over the whole screen, on top of the game', v && v.covers && v.top, v);
  chk('...with the way back to the booth games, big enough for a thumb', v && v.href==='index.html#game' && v.tall>=44, v);
  chk('no page errors', errs.length===0, errs);
  await c.close();

  ({c,p,errs}=await open('/lab-run.html', {mob:true, w:390, h:844}));
  await until(()=>asked.length && asked[asked.length-1]==='config');
  await sleep(1200);
  chk('a game that is on plays as before: no card', await p.evaluate(()=>!document.getElementById('fxRest')));
  await c.close();

  ({c,p,errs}=await open('/uv-card.html', {mob:true, w:390, h:844}));
  await until(()=>p.evaluate(()=>!!document.getElementById('fxRest')));
  chk('UV Card, which keeps no score, rests the same way', await p.evaluate(()=>!!document.getElementById('fxRest')));
  await c.close();

  ({c,p,errs}=await open('/facy-run.html', {admin:own.token}));
  await sleep(1500);
  chk('an admin signed in on this device can still open it', await p.evaluate(()=>!document.getElementById('fxRest')));
  await c.close();

  /* the booth page's fresh copy of the config is used as it is: no call */
  const fresh={at:Date.now(), cfg:{ok:true, settings:{games_off:'match-lab'}}};
  const before=asked.length;
  ({c,p,errs}=await open('/match-lab.html', {cache:fresh}));
  await until(()=>p.evaluate(()=>!!document.getElementById('fxRest')));
  await sleep(800);
  chk('a fresh copy from the booth page decides at once, without asking the script',
      await p.evaluate(()=>!!document.getElementById('fxRest')) && asked.slice(before).indexOf('config')<0, asked.slice(before));
  await c.close();

  /* a stale copy saying "off" is overruled by the script saying "on" */
  const stale={at:Date.now()-3600000, cfg:{ok:true, settings:{games_off:'pack-match'}}};
  ({c,p,errs}=await open('/pack-match.html', {cache:stale}));
  await until(()=>p.evaluate(()=>!document.getElementById('fxRest')), 6000);
  chk('a stale copy is checked, and the card lifts when the script says the game is on',
      await p.evaluate(()=>!document.getElementById('fxRest')));
  chk('no page errors', errs.length===0, errs);
  await c.close();
}

H.call({action:'admin.settings', token:own.token, settings:{games_off:''}});
await b.close(); srv.close();
console.log(bad ? '\n'+bad+' FAILED' : '\nall passed');
process.exit(bad?1:0);
