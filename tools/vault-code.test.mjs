/* The way in from a device the mailed link never reached.

   The link carries the token in a fragment, so it only ever unlocks the
   browser that opened the mail -- at a booth that is the mail app's own
   webview, not the browser in the visitor's hand, and they are left looking
   at the request form with an approved row sitting in the sheet. This drives
   the code route in a real browser against a stand-in script: ask, mistype,
   get it right, and land on the rows.

   The script side is covered by vault-access.test.mjs; what only a browser
   can answer is whether the gate walks a person through it. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const {chromium}=pkg;
const PAGE='file:///workspace/facerinna-showcase/facerinna-test-reports-claims/index.html';
let bad=0; const chk=(l,ok,x)=>{ if(!ok) bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(!ok&&x!==undefined?'  -> '+JSON.stringify(x):'')); };

const ROWS = { ok:true, who:'Coded',
  reports:[{}], series:[], skus:[], thumbs:[] };

const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
for(const [tag,w,h,mob] of [['phone',390,844,true],['desk',1440,900,false]]){
  const c=await b.newContext({viewport:{width:w,height:h},isMobile:mob,hasTouch:mob});
  const p=await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  const seen=[];
  /* Order matters: Playwright tries the most recently added route first, so
     the catch-all goes on FIRST and the stand-in script on top of it.
     Registered the other way round, the catch-all aborts the very call under
     test and the gate reports a network error. */
  await c.route('**/*', r => {
    const u=r.request().url();
    return (u.startsWith('file://')||u.startsWith('data:')||u.startsWith('blob:')) ? r.continue() : r.abort();
  });
  /* the stand-in script: every answer is the shape the real one sends */
  await c.route('**/macros/s/**', async r => {
    const body = JSON.parse(r.request().postData()||'{}');
    seen.push(body.action);
    const send = o => r.fulfill({status:200, contentType:'application/json', body:JSON.stringify(o)});
    if(body.action==='code')   return send({ok:true, status:'sent'});
    if(body.action==='redeem') return send(body.code==='123456'
        ? {ok:true, token:'TOK-FROM-CODE'}
        : {ok:false, reason:'badcode', left:4});
    if(body.action==='data')   return send(body.token==='TOK-FROM-CODE' ? ROWS : {ok:false, reason:'unknown'});
    return send({ok:false, error:'unexpected '+body.action});
  });
  await p.goto(PAGE,{waitUntil:'load'});
  await p.waitForTimeout(1200);

  const vis = s => p.evaluate(sel=>{ const e=document.querySelector(sel);
    return !!e && getComputedStyle(e).display!=='none'; }, s);
  const text = s => p.evaluate(sel=>{ const e=document.querySelector(sel); return e?e.textContent.trim():null; }, s);

  chk(`${tag}: a browser with no token is asked to request access`,
      await vis('#vaultGate') && await vis('#vgForm'));
  chk(`${tag}: ...and is offered the code instead, since the link may have gone elsewhere`,
      await vis('#vgSwitch') && /code/i.test(await text('#vgSwitch')), await text('#vgSwitch'));

  await p.click('#vgSwitch'); await p.waitForTimeout(250);
  chk(`${tag}: the switch opens the code form`, await vis('#vgCodeForm') && !(await vis('#vgForm')));

  await p.fill('#vgCodeEmail','coded@clinic.my');
  await p.click('#vgCodeForm button[type=submit]');
  await p.waitForTimeout(700);
  chk(`${tag}: asking mails a code and asks for the digits`, await vis('#vgPinForm'));
  chk(`${tag}: ...and says where it went`, /coded@clinic\.my/.test(await text('#vgMsg')), await text('#vgMsg'));

  /* a mistype must not throw the person back to the start */
  await p.fill('#vgPin','000000');
  await p.click('#vgPinForm button[type=submit]');
  await p.waitForTimeout(700);
  chk(`${tag}: a wrong code says so and keeps the box open`,
      await vis('#vgPinForm') && /not right/i.test(await text('#vgMsg')), await text('#vgMsg'));
  chk(`${tag}: ...and says how many tries are left`, /4 tries left/.test(await text('#vgNote')), await text('#vgNote'));

  await p.fill('#vgPin','123456');
  await p.click('#vgPinForm button[type=submit]');
  await p.waitForTimeout(1200);
  chk(`${tag}: the right code puts the rows on the screen`, !(await vis('#vaultGate')));
  chk(`${tag}: ...by keeping the token this browser now has`,
      await p.evaluate(()=>localStorage.getItem('fx.vault.token')) === 'TOK-FROM-CODE');
  chk(`${tag}: ...and the token is what bought them`, seen.includes('data'), seen);
  chk(`${tag}: nothing was asked of the script that should not have been`,
      seen.every(a=>['code','redeem','data'].includes(a)), seen);

  /* and it survives a reload, which is the whole point of storing it */
  await p.reload({waitUntil:'load'});
  await p.waitForTimeout(1200);
  chk(`${tag}: a reload does not ask again`, !(await vis('#vaultGate')));
  chk(`${tag}: no page errors`, errs.length===0, errs[0]);
  await c.close();
}
await b.close();
console.log(bad? '\nSOMETHING IS WRONG' : '\nan approved address can get in from any device');
process.exit(bad?1:0);
