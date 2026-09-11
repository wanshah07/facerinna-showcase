/* What a phone actually gets. Nine-tenths of a "mobile bug" is something
   sticking out of the viewport, a control too small to hit, or text clipped by
   a box that stopped growing -- so those are measured here rather than judged
   by eye, at the five widths that cover nearly every handset in a hall.

   Two things this deliberately does not flag: a child wider than the screen
   inside a carousel or marquee, because an ancestor clips it and that is the
   whole point of the component; and a visually-hidden heading, whose 1px
   clipped box IS the technique.  */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const {chromium}=pkg;
const FILE = process.env.PAGE || 'file:///workspace/facerinna-showcase/index.html';
const WIDTHS=[320,360,390,414,430];
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
let bad=0;
for(const w of WIDTHS){
  const c=await b.newContext({viewport:{width:w,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const p=await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.route('**/*', r=>{const u=r.request().url();
    return (u.startsWith('file://')||u.startsWith('data:')||u.startsWith('blob:'))?r.continue():r.abort();});
  await p.goto(FILE,{waitUntil:'load'});
  await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=600){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,25));}window.scrollTo(0,0);});
  await p.waitForTimeout(700);

  const r=await p.evaluate(w=>{
    const clipped=el=>{ for(let n=el.parentElement;n;n=n.parentElement){
        const s=getComputedStyle(n); if(s.overflowX!=='visible'||s.overflow!=='visible') return true; } return false; };
    const vis=el=>{const s=getComputedStyle(el);
      return s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0';};
    const out={over:[],small:[],clip:[]};
    for(const el of document.querySelectorAll('body *')){
      if(!vis(el)) continue;
      const s=getComputedStyle(el), b=el.getBoundingClientRect();
      if(b.width===0&&b.height===0) continue;
      /* real overflow: sticks out AND nothing above it clips the overflow */
      if(s.position!=='fixed'&&(b.right>w+1||b.left<-1)&&!clipped(el))
        out.over.push(el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+'.'+String(el.className||'').trim().split(/\s+/)[0]+` [${Math.round(b.left)}..${Math.round(b.right)}]`);
      /* a control too small to hit with a thumb */
      if(/^(a|button)$/.test(el.tagName.toLowerCase())&&el.offsetParent!==null){
        const t=(el.innerText||'').trim();
        if(t&&(b.height<28||b.width<28))
          out.small.push(`${el.tagName.toLowerCase()} "${t.slice(0,22)}" ${Math.round(b.width)}x${Math.round(b.height)}`);
      }
      /* text taller than the box that holds it, with the overflow hidden */
      /* A visually-hidden heading is a 1px box with its overflow clipped on
         purpose -- that is the whole technique, not a layout fault. */
      const srOnly = (b.width<=2&&b.height<=2)||s.clipPath!=='none'||s.clip!=='auto';
      if(el.children.length===0&&(el.innerText||'').trim()&&s.overflow==='hidden'&&!srOnly
         && el.scrollHeight>el.clientHeight+2 && !s.webkitLineClamp.match(/^\d/))
        out.clip.push(el.tagName.toLowerCase()+'.'+String(el.className||'').trim().split(/\s+/)[0]+` "${el.innerText.trim().slice(0,26)}"`);
    }
    return {...out, sw:document.documentElement.scrollWidth};
  },w);

  const uniq=a=>[...new Set(a)];
  const line=(l,ok)=>{ if(!ok) bad++; console.log((ok?'  PASS  ':'  FAIL  ')+`${String(w).padStart(4)}  ${l}`); };
  line('no sideways scroll', r.sw<=w+1);
  line('nothing escapes its clip'+(r.over.length?': '+uniq(r.over).join(' | '):''), r.over.length===0);
  line('every control is thumb-sized'+(r.small.length?': '+uniq(r.small).slice(0,6).join(' | '):''), r.small.length===0);
  line('no text cut off'+(r.clip.length?': '+uniq(r.clip).slice(0,6).join(' | '):''), r.clip.length===0);
  line('no page errors'+(errs.length?': '+errs[0]:''), errs.length===0);
  await c.close();
}
await b.close();
console.log(bad? '\nSOMETHING IS WRONG' : '\nall good');
process.exit(bad?1:0);
