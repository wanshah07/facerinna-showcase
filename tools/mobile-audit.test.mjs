/* Every page and every game screen on a phone, small to large, upright and
   sideways, with the notch and home bar of a modern phone where the page asks
   to run under them.

   The question for each: is anything wider than the screen, cut off by the
   edge, cut by the box that holds it, hidden under the notch, out of reach
   below the fold on a page that cannot scroll, too small to tap, or lying on
   top of another control. layout-sweep asks some of this at 390 wide; this asks
   it at 320, 360, 375, 412 and 430, and sideways at 568, 667, 740, 844 and 915,
   and on tablets (iPad mini, Air and Pro, upright and sideways),
   and on the screens a player actually meets: the name prompt, the start screen,
   mid-game and the result with its gift panel.

     node tools/mobile-audit.test.mjs          six phone sizes and two tablets, the usual run
     node tools/mobile-audit.test.mjs --full   all seventeen: eleven phones, six tablets
     --only lab-run        pages whose name contains this
     --shots DIR           a screenshot of every screen that has a finding

   Exit code 1 if anything is found. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=pkg;
const ROOT='/workspace/facerinna-showcase', PORT=8260+Math.floor(Math.random()*60), BASE='http://127.0.0.1:'+PORT;
const arg=n=>{ const i=process.argv.indexOf('--'+n); return i>0 ? process.argv[i+1] : null; };
const FULL=process.argv.includes('--full'), ONLY=arg('only'), SHOTS=arg('shots');
if(SHOTS) fs.mkdirSync(SHOTS,{recursive:true});

/* name, width, height, safe-area insets of the phone it stands for */
const NONE={top:0,bottom:0,left:0,right:0}, UP={top:47,bottom:34,left:0,right:0}, SIDE={top:0,bottom:21,left:47,right:47}, TAB={top:24,bottom:20,left:0,right:0}, TABS={top:24,bottom:20,left:0,right:0};
const ALL=[
  ['320x568 (iPhone SE 1)',320,568,NONE], ['360x640 (small Android)',360,640,NONE], ['375x667 (iPhone SE/8)',375,667,NONE],
  ['390x844 (iPhone 14)',390,844,UP], ['412x915 (Pixel)',412,915,NONE], ['430x932 (iPhone Pro Max)',430,932,UP],
  ['568x320 sideways SE 1',568,320,NONE], ['667x375 sideways SE/8',667,375,NONE], ['740x360 sideways Android',740,360,NONE],
  ['844x390 sideways iPhone 14',844,390,SIDE], ['915x412 sideways Pixel',915,412,NONE],
  /* tablets: the status bar and the home bar are still there, the notch is not */
  ['744x1133 iPad mini',744,1133,TAB], ['820x1180 iPad Air',820,1180,TAB], ['1024x1366 iPad Pro 12.9',1024,1366,TAB],
  ['1133x744 sideways iPad mini',1133,744,TABS], ['1180x820 sideways iPad Air',1180,820,TABS], ['1366x1024 sideways iPad Pro',1366,1024,TABS],
];
const VIEWS=FULL ? ALL : [ALL[0],ALL[2],ALL[3],ALL[5],ALL[7],ALL[9],ALL[12],ALL[15]];

const GAMES=['lab-run','deep-lab','match-lab','pack-match','shelf-shot','facy-run'];
/* The vault and the two benchmark pages are written in wanshah07/facerinna and copied here (the
   "Refresh the moved pages" commits), so a fix made here is overwritten by the next copy: they are
   looked at there, not here. */
const SITE=['index.html','admin.html','privacy.html','terms.html','cookies.html','redeem.html','scan.html','uv-card.html','events/index.html'];

const T={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{ let f=decodeURIComponent(new URL(q.url,BASE).pathname); if(f.endsWith('/')) f+='index.html'; const fp=path.join(ROOT,f);
  if(f==='/sw.js'||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){ r.writeHead(404); r.end(); return; }
  r.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'}); r.end(fs.readFileSync(fp)); });
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));

/* ---- what the page is asked, run inside it ---- */
const AUDIT=`(function(ins, cover, within, noReach){
  const vw=innerWidth, vh=innerHeight, de=document.documentElement, out=[];
  const scrollY = de.scrollHeight>vh+2 && getComputedStyle(document.body).overflowY!=='hidden' && getComputedStyle(de).overflowY!=='hidden';
  const sel=e=>{ let s=e.tagName.toLowerCase(); if(e.id) return s+'#'+e.id; const c=[...e.classList].filter(x=>!/^(on|in|show|open|hidden|active|reveal)$/.test(x)).slice(0,2); return s+(c.length?'.'+c.join('.'):''); };
  const add=(k,e,d)=>out.push({k:k, s:sel(e), d:d});
  if(de.scrollWidth>vw+1) out.push({k:'sideways-scroll',s:'html',d:'page '+de.scrollWidth+'px in a '+vw+'px screen'});
  if(document.body.scrollWidth>vw+1 && de.scrollWidth<=vw+1) out.push({k:'sideways-scroll',s:'body',d:'body '+document.body.scrollWidth+'px in a '+vw+'px screen'});
  const inter='a[href],button,input,select,textarea,[role=button],[onclick]';
  const els=[...document.querySelectorAll('body *')];
  /* hard=true: only boxes that cut for good (hidden/clip). A box that scrolls (auto/scroll) holds
     what it cannot show at hand: the rest is a scroll away, not lost. */
  const clipOf=(e,hard)=>{ let x0=-1e9,y0=-1e9,x1=1e9,y1=1e9; const cs0=getComputedStyle(e);
    if(cs0.position==='fixed') return {x0,y0,x1,y1};
    for(let p=e.parentElement;p&&p!==document.body&&p!==de;p=p.parentElement){ const cs=getComputedStyle(p);
      const isCut=v=>hard ? (v==='hidden'||v==='clip') : v!=='visible';
      const ox=isCut(cs.overflowX), oy=isCut(cs.overflowY); if(!ox&&!oy) continue;
      const r=p.getBoundingClientRect(); if(ox){x0=Math.max(x0,r.left);x1=Math.min(x1,r.right);} if(oy){y0=Math.max(y0,r.top);y1=Math.min(y1,r.bottom);} }
    return {x0,y0,x1,y1}; };
  const shown=[];
  for(const e of els){
    if(/^(SCRIPT|STYLE|LINK|META|TITLE|HEAD|BR|PATH|CIRCLE|RECT|LINE|G|DEFS|USE|STOP|TEXT|TSPAN|POLYGON|POLYLINE|ELLIPSE|CLIPPATH|MASK|LINEARGRADIENT|RADIALGRADIENT|SYMBOL|SOURCE|TEMPLATE|NOSCRIPT)$/i.test(e.tagName)) continue;
    if(e.closest('svg') && e.tagName.toLowerCase()!=='svg') continue;
    if(e.closest('template,[hidden],[inert]')) continue;
    const cs=getComputedStyle(e), r=e.getBoundingClientRect();
    if(r.width<=0||r.height<=0||cs.visibility==='hidden'||cs.display==='none'||parseFloat(cs.opacity)<0.05) continue;
    if(e.closest('[aria-hidden="true"]') && !e.matches(inter)) continue;       // decoration
    let hid=false; for(let p=e;p&&p!==de;p=p.parentElement){ const c=getComputedStyle(p); if(c.display==='none'||c.visibility==='hidden'||parseFloat(c.opacity)<0.05){hid=true;break;} } if(hid) continue;
    if(within && !e.closest(within)) continue;
    const isInter=e.matches(inter), hasText=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim().length>0);
    const media=/^(IMG|VIDEO|SVG)$/i.test(e.tagName);
    if(!isInter && !hasText && !media) continue;
    const c=clipOf(e);
    const vr={l:Math.max(r.left,c.x0),t:Math.max(r.top,c.y0),r:Math.min(r.right,c.x1),b:Math.min(r.bottom,c.y1)};
    if(vr.r-vr.l<=0||vr.b-vr.t<=0) continue;                                    // wholly clipped: out of sight on purpose
    const fixed=(()=>{ for(let p=e;p&&p!==de;p=p.parentElement) if(getComputedStyle(p).position==='fixed') return true; return false; })();
    // wholly off the screen on purpose (a menu parked beside it)
    if(vr.r<=0||vr.l>=vw) continue;
    // a long line inside something that scrolls sideways on purpose
    if(e.closest('[data-scroll-x],.cg,.marquee-track,.brandstrip,.hero-marquee,.coverflow,.cover-flow,.carousel,.slides,.slideshow')) { /* judged below only for the edge */ }
    if(vr.l<-1||vr.r>vw+1) add('past-the-edge',e,'runs '+Math.round(Math.max(-vr.l,vr.r-vw))+'px past the '+(vr.l<-1?'left':'right')+' edge');
    const ch=clipOf(e,true), hv={l:Math.max(r.left,ch.x0),t:Math.max(r.top,ch.y0),r:Math.min(r.right,ch.x1),b:Math.min(r.bottom,ch.y1)};
    const hidFrac=Math.max(0,1-(Math.max(0,hv.r-hv.l)*Math.max(0,hv.b-hv.t))/(r.width*r.height));
    if((isInter||hasText) && hidFrac>0.08 && !e.closest('.cg,.marquee-track,.brandstrip,.hero-marquee,.coverflow,.cover-flow,.carousel,.slides,.slideshow,[data-scroll-x],[class*=pubx]')) add('cut-by-its-box',e,Math.round(hidFrac*100)+'% hidden by the box that holds it');
    if((isInter) && !noReach && !scrollY && !fixed && (vr.b>vh+2||vr.t<-2) ) add('out-of-reach',e,'sits at '+Math.round(vr.t)+'-'+Math.round(vr.b)+'px on a '+vh+'px screen that cannot scroll');
    if(isInter && fixed && (vr.b>vh+1||vr.t<-1)) add('cut-by-the-screen',e,'fixed control at '+Math.round(vr.t)+'-'+Math.round(vr.b)+'px on a '+vh+'px screen');
    if(cover){
      const over=(a,b)=>Math.max(0,Math.min(a,b));
      /* a plain text box is padded in from its edge: it is where the lettering sits that must clear the notch */
      const pad=isInter?{l:0,r:0,t:0,b:0}:{l:parseFloat(cs.paddingLeft)||0,r:parseFloat(cs.paddingRight)||0,t:parseFloat(cs.paddingTop)||0,b:parseFloat(cs.paddingBottom)||0};
      const cl=vr.l+pad.l, cr=vr.r-pad.r, ct=vr.t+pad.t, cb=vr.b-pad.b;
      const u=Math.max(0,ins.top-ct), d2=Math.max(0,cb-(vh-ins.bottom)), l=Math.max(0,ins.left-cl), rr=Math.max(0,cr-(vw-ins.right));
      const bits=[]; if(u>3&&ins.top&&r.top>=-1) bits.push(Math.round(u)+'px under the top inset'); if(d2>3&&ins.bottom&&r.bottom<=vh+1) bits.push(Math.round(d2)+'px under the home bar'); if(l>3&&ins.left) bits.push(Math.round(l)+'px under the left notch'); if(rr>3&&ins.right) bits.push(Math.round(rr)+'px under the right notch');
      const whole = Math.abs(vr.t-r.top)<1.5 && Math.abs(vr.b-r.bottom)<1.5 && Math.abs(vr.l-r.left)<1.5 && Math.abs(vr.r-r.right)<1.5;
      if(bits.length && (isInter||hasText) && whole && !(r.width>=vw-2&&r.height>=vh-2)) add('under-the-notch',e,bits.join(', '));
    }
    if(isInter && Math.min(hv.r-hv.l,hv.b-hv.t)<32 && !e.closest('.cg,[class*=pubx],.marquee-track') && !e.matches('input[type=checkbox],input[type=radio],input[type=hidden]') && !(e.tagName==='A'&&hasText&&e.closest('p,li,footer,.sub,.note'))){
      /* a control may carry an invisible pad (a ::after) that a finger lands on: ask the page what is under points just outside it */
      const cx=(hv.l+hv.r)/2, cy=(hv.t+hv.b)/2, pad=9, pts=[[hv.l-pad+2,cy],[hv.r+pad-2,cy],[cx,hv.t-pad+2],[cx,hv.b+pad-2]];
      const ok=pts.filter(([x,y])=>{ const t=document.elementFromPoint(x,y); return t&&(t===e||e.contains(t)); }).length;
      /* something else is on top of it (a prompt, a popup): it cannot be tapped, so how big it is does not matter */
      const mid=document.elementFromPoint(cx,cy), covered=!mid||!(mid===e||e.contains(mid));
      if(ok<3 && !covered) add('small-to-tap',e,Math.round(hv.r-hv.l)+'x'+Math.round(hv.b-hv.t)+'px'); }
    if(hasText && parseFloat(cs.fontSize)<10) add('tiny-text',e,cs.fontSize);
    if(/^(hidden|clip)$/.test(cs.overflowX+'') || /^(hidden|clip)$/.test(cs.overflowY+'')){
      if(hasText && cs.textOverflow!=='ellipsis' && !(cs.whiteSpace==='nowrap'&&cs.textOverflow==='ellipsis') && (e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2) && !e.closest('.cg,.marquee-track,.hero-marquee,.brandstrip,.coverflow,.cover-flow,.slides'))
        add('text-clipped',e,'needs '+e.scrollWidth+'x'+e.scrollHeight+', has '+e.clientWidth+'x'+e.clientHeight);
    }
    /* a box that centres its content and scrolls cannot be scrolled up to what overflows its top */
    if((isInter||hasText||media) && !e.closest('.cg,.marquee-track,.brandstrip,.hero-marquee')){
      for(let q=e.parentElement;q&&q!==document.body&&q!==de;q=q.parentElement){ const qs=getComputedStyle(q);
        if(qs.position==='fixed' && false) break;
        if(/^(auto|scroll)$/.test(qs.overflowY)){ const qr=q.getBoundingClientRect();
          if(r.top<qr.top-2 && q.scrollTop<=0.5 && qr.height>0){ add('cut-at-the-top',e,Math.round(qr.top-r.top)+'px of it sits above the top of its box, where scrolling cannot reach'); }
          break; } } }
    if(isInter) shown.push({e:e,r:vr});
  }
  for(const id of ['playBtn','startBtn','again','fxrGo','pickBtn']){ const b=document.getElementById(id); if(!b) continue;
    const cs=getComputedStyle(b), r=b.getBoundingClientRect(); if(cs.display==='none'||cs.visibility==='hidden'||r.width<=0||r.height<=0) continue;
    let hid=false; for(let q=b;q&&q!==de;q=q.parentElement){ const c=getComputedStyle(q); if(c.display==='none'||c.visibility==='hidden'||parseFloat(c.opacity)<0.05){hid=true;break;} } if(hid) continue;
    const mt=r.top<-1?'above':r.bottom>vh+1?'below':r.left<-1?'left of':r.right>vw+1?'right of':'';
    if(mt) out.push({k:'main-button-not-in-view',s:'button#'+id,d:Math.round(mt==='below'?r.bottom-vh:mt==='above'?-r.top:0)+'px '+mt+' the screen'}); }
  const hit=(a,b)=>{ const w=Math.min(a.r,b.r)-Math.max(a.l,b.l), h=Math.min(a.b,b.b)-Math.max(a.t,b.t); return w>0&&h>0?w*h:0; };
  for(let i=0;i<shown.length;i++) for(let j=i+1;j<shown.length;j++){ const a=shown[i],b=shown[j];
    if(a.e.contains(b.e)||b.e.contains(a.e)) continue;
    const ar=(a.r.r-a.r.l)*(a.r.b-a.r.t), br=(b.r.r-b.r.l)*(b.r.b-b.r.t), o=hit(a.r,b.r);
    if(o>0.35*Math.min(ar,br)) {
      const x=(Math.max(a.r.l,b.r.l)+Math.min(a.r.r,b.r.r))/2, y=(Math.max(a.r.t,b.r.t)+Math.min(a.r.b,b.r.b))/2;
      const top=document.elementFromPoint(x,y); if(!top) continue;
      const win=a.e.contains(top)?a.e:b.e.contains(top)?b.e:null; if(!win) continue;          // something else is on top of both
      const lose=win===a.e?b.e:a.e;
      /* a prompt over the page is meant to hide what is under it */
      let modal=false; for(let p=win;p&&p!==de;p=p.parentElement){ const c=getComputedStyle(p); if((c.position==='fixed'||c.position==='absolute')&&c.pointerEvents!=='none'){ const q=p.getBoundingClientRect(); if(q.width>=vw*0.9&&q.height>=vh*0.9){ modal=true; break; } } }
      if(modal) continue;
      if(win.closest('.fxr-pop')) continue;                                        // the ranking board is borrowed on purpose
      const pinned=el=>{ for(let p=el;p&&p!==de;p=p.parentElement) if(getComputedStyle(p).position==='fixed') return true; return false; };
      if(pinned(win)&&!pinned(lose)) continue;
      const scrolls=el=>{ for(let p=el.parentElement;p&&p!==document.body&&p!==de;p=p.parentElement){ const c=getComputedStyle(p); if(/^(auto|scroll)$/.test(c.overflowY)&&p.scrollHeight>p.clientHeight+2) return true; } return false; };
      if(pinned(win)&&scrolls(lose)) continue;                                      // a floating button over scrolling content: scroll and it moves
      if(win.closest('[role=dialog],.chat-panel')) continue;                        // an open panel is meant to cover what is under it
      out.push({k:'controls-overlap',s:sel(win)+' covers '+sel(lose),d:Math.round(100*o/Math.min(ar,br))+'% of the smaller one'}); } }
  return out; })`;

const findings=new Map();              // signature -> {where:Set, detail}
let screens=0, errsTotal=0;
function record(page,state,view,list){
  for(const f of list){
    /* The same thing found at a dozen sizes is one finding with a dozen places. */
    const sig=page+' | '+f.k+' | '+f.s;
    if(!findings.has(sig)) findings.set(sig,{page,k:f.k,s:f.s,where:[],detail:f.d});
    findings.get(sig).where.push(state+' @ '+view.split(' ')[0]);
  }
}

async function open(b,view){
  const [name,w,h,ins]=view;
  const c=await b.newContext({viewport:{width:w,height:h},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await c.route(u=>!u.href.startsWith(BASE), r=>r.abort());
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  const s=await c.newCDPSession(p);
  return {c,p,s,errs};
}
async function setInsets(s,ins,cover){ try{ await s.send('Emulation.setSafeAreaInsetsOverride',{insets: cover?ins:{top:0,bottom:0,left:0,right:0}}); }catch(e){} }
async function run(p,view,page,state,cover,shotTag){
  const ins=view[3];
  /* with the name prompt up, the start screen under it is looked at on its own turn; a modal
     or the ranking board holds the page still, so what is below the fold is not out of reach */
  /* the ranking board covers the page with a blurred backdrop: the header and the
     gallery cards turning under it are not what anybody is looking at */
  const within = state==='name prompt' ? '.fxr-gate,.fxr-back,.fxr-show' : state==='ranking open' ? '#rankModal' : '';
  const noReach = /open$|name prompt|gift panel/.test(state);
  const list=await p.evaluate(AUDIT+'('+JSON.stringify(ins)+','+JSON.stringify(cover)+','+JSON.stringify(within)+','+JSON.stringify(noReach)+')').catch(e=>[{k:'audit-failed',s:'page',d:String(e.message).slice(0,80)}]);
  screens++; record(page,state,view[0],list);
  if(cover && ins.bottom){
    const end=await p.evaluate(inset=>{ const de=document.documentElement; if(de.scrollHeight<=innerHeight+2) return null;
      scrollTo(0,de.scrollHeight); let worst=0, who='';
      for(const e of document.querySelectorAll('body *')){ const cs=getComputedStyle(e); if(cs.position==='fixed'||cs.visibility==='hidden'||cs.display==='none') continue;
        if(!([...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())||e.matches('a,button,input'))) continue;
        const r=e.getBoundingClientRect(); if(r.width<=0||r.height<=0||r.top>innerHeight) continue;
        if(r.bottom>worst){ worst=r.bottom; who=e.tagName.toLowerCase()+(e.id?'#'+e.id:''); } }
      const over=worst-(innerHeight-inset); scrollTo(0,0); return over>3?{who,over:Math.round(over)}:null; }, ins.bottom).catch(()=>null);
    if(end) record(page,state,view[0],[{k:'page-end-under-home-bar',s:end.who,d:end.over+'px: the last line cannot be scrolled clear of the home bar'}]); }
  if(SHOTS && list.length){ await p.screenshot({path:path.join(SHOTS,(page+'-'+state+'-'+view[0].split(' ')[0]).replace(/[^a-z0-9.-]/gi,'_')+'.png')}).catch(()=>{}); }
}
const hasCover=async p=>p.evaluate(()=>/viewport-fit=cover/.test((document.querySelector('meta[name=viewport]')||{}).content||''));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});

async function game(view,g){
  const {c,p,s,errs}=await open(b,view);
  try{
    await p.goto(BASE+'/'+g+'.html',{waitUntil:'load'}); await sleep(1700);
    const cover=await hasCover(p); await setInsets(s,view[3],cover); await sleep(250);
    await run(p,view,g,'name prompt',cover);
    await p.fill('#fxrName','Aina').catch(()=>{}); await p.click('#fxrGo').catch(()=>{}); await sleep(700);
    await run(p,view,g,'start screen',cover);
    if(g==='facy-run') await p.evaluate(()=>window.__facy.start()).catch(()=>{});
    else for(const sel of ['#playBtn','#startBtn']){ const el=await p.$(sel); if(el){ await el.click().catch(()=>{}); break; } }
    await sleep(1800);
    await run(p,view,g,'playing',cover);
    if(g==='facy-run') await p.evaluate(()=>{ window.__facy.setScore(6200); window.__facy.end(); }).catch(()=>{});
    else await p.evaluate(()=>{ const f=window.FX_RANK||{}; const r=document.querySelector(f.result), sc=document.querySelector(f.score); if(sc) sc.textContent='1234'; if(r) r.classList.remove('hidden'); }).catch(()=>{});
    await sleep(2800);
    await run(p,view,g,'result + gift panel',cover);
  }catch(e){ record(g,'run',view[0],[{k:'audit-crashed',s:'page',d:String(e.message).slice(0,100)}]); }
  errsTotal+=errs.length; if(errs.length) record(g,'run',view[0],[{k:'page-error',s:'js',d:errs[0].slice(0,100)}]);
  await c.close();
}
async function plain(view,pg,steps){
  const {c,p,s,errs}=await open(b,view);
  try{
    await p.goto(BASE+'/'+pg,{waitUntil:'load'}); await sleep(pg==='index.html'?2600:1300);
    const cover=await hasCover(p); await setInsets(s,view[3],cover); await sleep(250);
    await run(p,view,pg,'page',cover);
    for(const [state,fn] of (steps||[])){ try{ await fn(p); await sleep(700); await run(p,view,pg,state,cover); }catch(e){} }
  }catch(e){ record(pg,'run',view[0],[{k:'audit-crashed',s:'page',d:String(e.message).slice(0,100)}]); }
  errsTotal+=errs.length; if(errs.length) record(pg,'run',view[0],[{k:'page-error',s:'js',d:errs[0].slice(0,100)}]);
  await c.close();
}

const INDEX_STEPS=[
  ['menu open',p=>p.click('.nav-pill-icon, #burger, .nav-burger, button[aria-label*="enu"]')],
  ['chat open',p=>p.evaluate(()=>{ const m=document.querySelector('.nav-links.open,.nav-open'); if(m) m.classList.remove('open','nav-open'); }).then(()=>p.click('#chatFab'))],
  ['ranking open',p=>p.evaluate(()=>{ const c=document.getElementById('chatClose'); if(c) c.click(); }).then(()=>p.evaluate(()=>document.getElementById('rankBtn').scrollIntoView())).then(()=>p.click('#rankBtn'))],
];
const todo=[];
for(const v of VIEWS){
  for(const g of GAMES) if(!ONLY||g.includes(ONLY)) todo.push(()=>game(v,g));
  for(const pg of SITE) if(!ONLY||pg.includes(ONLY)) todo.push(()=>plain(v,pg,pg==='index.html'?INDEX_STEPS:pg==='uv-card.html'?[['cards screen',p=>p.click('#startBtn')]]:null));
}
/* a few at a time: this machine has four cores, and a screen is not worth waiting alone for */
let next=0; await Promise.all(Array.from({length:3},async()=>{ while(next<todo.length){ const i=next++; await todo[i](); } }));

await b.close(); srv.close();
const kinds={}; for(const f of findings.values()) kinds[f.k]=(kinds[f.k]||0)+1;
console.log(`${screens} screens looked at: ${VIEWS.length} sizes x ${GAMES.length} games (4 screens each) + ${SITE.length} pages`);
console.log(findings.size ? `\n${findings.size} findings  ${JSON.stringify(kinds)}\n` : '\nnothing found');
const byPage={}; for(const f of findings.values()) (byPage[f.page]=byPage[f.page]||[]).push(f);
for(const [pg,list] of Object.entries(byPage)){
  console.log(pg);
  for(const f of list.sort((a,b)=>a.k.localeCompare(b.k))) console.log(`   ${f.k.padEnd(18)} ${f.s.slice(0,60).padEnd(60)} ${f.detail}   [${[...new Set(f.where)].slice(0,4).join('; ')}${new Set(f.where).size>4?'; +'+(new Set(f.where).size-4)+' more':''}]`);
}
process.exit(findings.size ? 1 : 0);
