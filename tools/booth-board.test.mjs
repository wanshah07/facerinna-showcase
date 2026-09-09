import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
import http from 'http'; import fs from 'fs';
const html=fs.readFileSync('/workspace/facerinna-showcase/index.html');
const srv=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});r.end(html);});
await new Promise(r=>srv.listen(0,r)); const P=srv.address().port;
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
let ok=true; const check=(l,c)=>{ if(!c) ok=false; console.log((c?'  PASS  ':'  FAIL  ')+l); };

async function board(games){
  const ctx=await browser.newContext({viewport:{width:1280,height:900}});
  const pg=await ctx.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(String(e)));
  await pg.route('**/*', r=>{
    const u=r.request().url();
    if(u.startsWith(`http://127.0.0.1:${P}`)) return r.continue();
    if(u.startsWith('https://script.google.com'))
      return r.fulfill({status:200,contentType:'application/json',
        headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ok:true,games})});
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${P}/`,{waitUntil:'domcontentloaded'});
  await pg.waitForTimeout(1500);
  await pg.evaluate(()=>{const b=document.getElementById('rankBtn'); if(b) b.click();});
  await pg.waitForTimeout(800);
  const out=await pg.evaluate(()=>{
    const rows=[...document.querySelectorAll('#rankBody .rank-row')].map(r=>({
      pos:(r.querySelector('.rp')||{}).textContent, n:(r.querySelector('.rn')||{}).textContent}));
    return {rows, body:(document.getElementById('rankBody')||{}).innerText||''};
  });
  await ctx.close(); return {...out, errs};
}
const EMPTY={'shelf-shot':[],'deep-lab':[]};

console.log('a tie: both win one game, both 5 pts — earlier run wins');
{
  /* wad won Pack Match at 10:00. wad1 won Lab Run at 14:00. Same points, same
     games played. wad got there first. */
  const r = await board({...EMPTY,'match-lab':[],
    'pack-match':[{n:'wad', s:3000, t: Date.parse('2026-09-10T10:00:00Z')}],
    'lab-run':   [{n:'wad1',s:707,  t: Date.parse('2026-09-10T14:00:00Z')}]});
  console.log('   order:', r.rows.map(x=>x.pos+' '+x.n).join('  |  '));
  check('wad is first',                r.rows[0] && r.rows[0].n==='wad');
  check('wad1 is second',              r.rows[1] && r.rows[1].n==='wad1');
  check('the rule is stated on screen',/Whoever got there first/.test(r.body));
  check('no page errors',              r.errs.length===0);
}

console.log('\nsame two, times swapped — the order must swap with them');
{
  const r = await board({...EMPTY,'match-lab':[],
    'pack-match':[{n:'wad', s:3000, t: Date.parse('2026-09-10T14:00:00Z')}],
    'lab-run':   [{n:'wad1',s:707,  t: Date.parse('2026-09-10T10:00:00Z')}]});
  console.log('   order:', r.rows.map(x=>x.pos+' '+x.n).join('  |  '));
  check('wad1 is now first', r.rows[0] && r.rows[0].n==='wad1');
}

console.log('\nno tie: the note stays away');
{
  const r = await board({...EMPTY,'lab-run':[],
    'match-lab': [{n:'Solo',s:10,t:1000}],
    'pack-match':[{n:'Solo',s:20,t:2000}]});
  check('one clear leader',        r.rows.length===1 && r.rows[0].n==='Solo');
  check('no tiebreak note shown', !/Whoever got there first/.test(r.body));
}

console.log('\na row with no timestamp loses the tie rather than winning it');
{
  const r = await board({...EMPTY,'match-lab':[],
    'pack-match':[{n:'NoTime', s:3000}],                                  // t missing
    'lab-run':   [{n:'Timed',  s:707, t: Date.parse('2026-09-10T23:00:00Z')}]});
  console.log('   order:', r.rows.map(x=>x.pos+' '+x.n).join('  |  '));
  check('the timestamped run wins', r.rows[0] && r.rows[0].n==='Timed');
}

console.log(ok?'\nall good':'\nSOMETHING IS WRONG');
await browser.close(); srv.close(); process.exit(ok?0:1);
