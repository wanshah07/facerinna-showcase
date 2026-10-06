/* QR codes and posters an admin uploads, per event.

   What has to hold: the page names what is uploaded (nobody types a file name);
   a QR code is named for where it leads; the event the booth is running is the
   one switch -- everything tagged with another event is locked at the source
   (the Drive file goes private AND it leaves the public config), and comes back
   when the event does; each item can also be switched off, moved or deleted;
   the public config says nothing about who uploaded what, which file it is, or
   what other events there are; and the gate is the script's, not the page's. */
import { load, OWNER } from './booth-admin-harness.mjs';

let bad=0;
const check=(l,c,x)=>{ if(!c) bad++; console.log((c?'  PASS  ':'  FAIL  ')+l+(!c&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const { call, signIn, tabs, DRIVE } = load();
const own = signIn(OWNER);
const A = o => call({ token: own.token, ...o });
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');   /* the picture's bytes do not matter to the script */
const up = o => A({ action:'admin.media.upload', mime:'image/png', data:PNG, ...o });
const pub = () => call({ action:'config' }).media;

console.log('set up');
check('a Media tab with its columns', tabs['Media'] && tabs['Media'].rows[0].join()==='id,kind,name,label,event,on,file_id,target,mime,bytes,created,by,updated,shared', tabs['Media'] && tabs['Media'].rows[0]);
let cfg = call({ action:'config' });
check('the public config starts with no media', Array.isArray(cfg.media) && cfg.media.length===0, cfg.media);
check('no event chosen, and nothing built into the page is left out', cfg.settings.active_event==='' && Array.isArray(cfg.builtin_off) && cfg.builtin_off.length===0, cfg.builtin_off);

console.log('\nnaming');
let r = up({ kind:'qr', event:'AGM Penang 2026', target:'https://wa.me/message/YKYI736CG4FZH1', filename:'IMG_2231.png' });
check('a QR code is named for where it leads, never from the file name', r.ok && r.name==='qr-agm-penang-2026-whatsapp-01', r);
r = up({ kind:'qr', event:'AGM Penang 2026', target:'https://wa.me/message/OTHER', filename:'x.png' });
check('a second one for the same place counts on', r.ok && r.name==='qr-agm-penang-2026-whatsapp-02', r.name);
r = up({ kind:'qr', event:'AGM Penang 2026', target:'https://docs.google.com/forms/d/e/abc/viewform' });
check('a Google Form is a form', r.name==='qr-agm-penang-2026-form-01', r.name);
r = up({ kind:'qr', event:'AGM Penang 2026', target:'https://my.facerinna.com/' });
check('this site is the website', r.name==='qr-agm-penang-2026-website-01', r.name);
r = up({ kind:'qr', event:'AGM Penang 2026', target:'https://example-clinic.com.my/book' });
check('anything else is named for its host', r.name==='qr-agm-penang-2026-example-clinic-01' || /^qr-agm-penang-2026-[a-z0-9-]+-01$/.test(r.name), r.name);
r = up({ kind:'qr', event:'AGM Penang 2026' });
check('a QR code that could not be read is just a code', r.name==='qr-agm-penang-2026-code-01', r.name);
r = up({ kind:'poster', event:'AGM Penang 2026', filename:'Dermocosmetic Talk_FINAL v2.png' });
check('a poster is named from its file, tidied', r.ok && r.name==='poster-agm-penang-2026-dermocosmetic-talk-final-v2-01', r);
r = up({ kind:'poster', event:'', filename:'Walk-in.png' });
check('no event says "all"', r.ok && r.name==='poster-all-walk-in-01', r);

console.log('\nwhat Drive holds');
const files = Object.values(DRIVE.files);
check('one folder, made once', DRIVE.folders.length===1 && DRIVE.folders[0].name==='FACERINNA booth media', DRIVE.folders.map(f=>f.name));
check('every upload is a file, shared by link while it is live', files.length===8 && files.every(f=>f.access==='ANYONE_WITH_LINK'), files.map(f=>f.access));
check('the file carries the generated name', files[0].name==='qr-agm-penang-2026-whatsapp-01.png', files[0].name);

console.log('\nthe public config');
let m = pub();
check('every live item is there', m.length===8, m.length);
check('it carries a picture address, a name, a label, a kind', m.every(x=>/^https:\/\/lh3\.googleusercontent\.com\/d\/drv\d+=/.test(x.url) && x.name && x.kind), m[0]);
check('a QR code that leads somewhere says where (https only)', m.find(x=>x.name==='qr-agm-penang-2026-whatsapp-01').link==='https://wa.me/message/YKYI736CG4FZH1');
check('...a poster has no link', !('link' in m.find(x=>x.kind==='poster')));
const text = JSON.stringify(call({ action:'config' }));
check('it does not say who uploaded, which Drive file, or which event', !/owner@|file_id|"event"|"by"/.test(text) && !/AGM Penang/.test(JSON.stringify(m)), m[0]);

console.log('\nthe event is the one switch');
const wa1 = A({ action:'admin.get' }).media.find(x=>x.name==='qr-agm-penang-2026-whatsapp-01');
r = up({ kind:'qr', event:'Pharmacy Day', target:'https://wa.me/message/PHARM' });
check('another event, uploaded while no event is chosen, is live', r.ok && r.live===true);
const pharm = r.id;
r = A({ action:'admin.settings', settings:{ active_event:'AGM Penang 2026' } });
check('choosing the event is saved', r.ok && r.settings.active_event==='AGM Penang 2026', r);
m = pub();
check('...and the other event\'s code is gone from the page', m.length===8 && !m.some(x=>x.id===pharm), m.length);
let ph = A({ action:'admin.get' }).media.find(x=>x.id===pharm);
check('...admin sees it as locked, not as off', ph.locked===true && ph.on===true && ph.live===false && ph.url==='', ph);
const phFile = Object.values(DRIVE.files).find(f=>f.name.startsWith('qr-pharmacy-day'));
check('...and its Drive file is private, so a saved link stops working', phFile.access==='PRIVATE', phFile.access);
check('the current event\'s files are still public', Object.values(DRIVE.files).filter(f=>f.name.startsWith('qr-agm')||f.name.startsWith('poster-agm')).every(f=>f.access==='ANYONE_WITH_LINK'));
check('an item with no event shows at every event', m.some(x=>x.name==='poster-all-walk-in-01'));
r = up({ kind:'poster', event:'Pharmacy Day', filename:'Pharmacy.png' });
check('uploading for an event that is not on locks it from the start', r.ok && r.live===false && Object.values(DRIVE.files).find(f=>f.name.startsWith('poster-pharmacy')).access==='PRIVATE', r);
r = A({ action:'admin.settings', settings:{ active_event:'pharmacy day' } });
m = pub();
check('the event name matches without caring about case', m.some(x=>x.id===pharm) && !m.some(x=>x.name.startsWith('qr-agm')), m.map(x=>x.name));
check('...and the AGM files are now private', Object.values(DRIVE.files).filter(f=>f.name.startsWith('qr-agm')).every(f=>f.access==='PRIVATE'));
r = A({ action:'admin.settings', settings:{ active_event:'' } });
check('no event chosen: everything that is on comes back', pub().length===10 && Object.values(DRIVE.files).every(f=>f.access==='ANYONE_WITH_LINK'), pub().length);
A({ action:'admin.settings', settings:{ active_event:'AGM Penang 2026' } });

console.log('\nswitching one off, moving, bulk');
r = A({ action:'admin.media.set', id:wa1.id, on:false });
check('one item off', r.ok && r.media.find(x=>x.id===wa1.id).on===false && !pub().some(x=>x.id===wa1.id), r.ok);
check('...its file is private', Object.values(DRIVE.files).find(f=>f.name==='qr-agm-penang-2026-whatsapp-01.png').access==='PRIVATE');
r = A({ action:'admin.media.set', id:wa1.id, on:true });
check('...and back on', pub().some(x=>x.id===wa1.id));
r = A({ action:'admin.media.set', id:pharm, event:'AGM Penang 2026' });
check('moved to the current event, it goes live', pub().some(x=>x.id===pharm) && Object.values(DRIVE.files).find(f=>f.name.startsWith('qr-pharmacy-day')).access==='ANYONE_WITH_LINK', r.ok);
r = A({ action:'admin.media.set', for_event:'AGM Penang 2026', on:false });
check('a whole event off at once', r.ok && r.changed>=7 && pub().every(x=>x.name.startsWith('poster-all')), pub().map(x=>x.name));
r = A({ action:'admin.media.set', for_event:'AGM Penang 2026', on:true });
check('...and on again', pub().length>=8);
check('nothing matching is an error, not a silent success', A({ action:'admin.media.set', id:'med-nope', on:false }).ok===false);
check('which one has to be said', A({ action:'admin.media.set', on:false }).ok===false);

console.log('\nrefusals');
const n0 = Object.keys(DRIVE.files).length;
check('no kind', up({ kind:'' }).ok===false);
check('not a picture type', up({ kind:'poster', mime:'application/pdf' }).ok===false);
check('not base64', up({ kind:'poster', data:'<script>alert(1)</script>' }).ok===false);
check('empty', up({ kind:'poster', data:'' }).ok===false);
check('too big', up({ kind:'poster', data:Buffer.alloc(2600000).toString('base64') }).ok===false);
check('...and nothing reached Drive for any of them', Object.keys(DRIVE.files).length===n0);
r = up({ kind:'qr', event:'<img src=x onerror=alert(1)>', target:'http://insecure.example/x' });
const row = A({ action:'admin.get' }).media.find(x=>x.id===r.id);
check('an event name is plain text: no markup survives', r.ok && !/[<>=]/.test(row.event), row.event);
check('a link that is not https is not kept', row.target==='', row.target);
DRIVE.failShare = true;
const n1 = Object.keys(DRIVE.files).length;
r = up({ kind:'poster', event:'', filename:'Blocked.png' });
check('if Drive will not share, the upload fails and says why', r.ok===false && /sharing/i.test(r.error), r);
check('...and the file it made is put in the bin, not left lying about', Object.values(DRIVE.files).slice(n1).every(f=>f.trashed), Object.values(DRIVE.files).slice(n1));
DRIVE.failShare = false;

console.log('\nwho may');
A({ action:'admin.team.save', person:{ email:'ben@clinic.test', name:'Ben', role:'staff', access:['counter'] } });
A({ action:'admin.team.save', person:{ email:'cara@clinic.test', name:'Cara', role:'staff', access:['media'] } });
const ben = signIn('ben@clinic.test'), cara = signIn('cara@clinic.test');
check('staff without the area are refused every media action', ['admin.media.upload','admin.media.set','admin.media.delete'].every(a=>{ const x=call({ token:ben.token, action:a, kind:'poster', mime:'image/png', data:PNG, id:'x', on:false }); return x.ok===false && x.reason==='forbidden' && x.area==='media'; }));
check('...they are not even sent the library', !('media' in call({ token:ben.token, action:'admin.get' })));
check('...and may not change the event', call({ token:ben.token, action:'admin.settings', settings:{ active_event:'X' } }).reason==='forbidden');
r = call({ token:cara.token, action:'admin.media.upload', kind:'poster', mime:'image/png', data:PNG, filename:'Cara.png', event:'AGM Penang 2026' });
check('staff with the area can upload', r.ok && r.name==='poster-agm-penang-2026-cara-01', r);
check('...and change the event', call({ token:cara.token, action:'admin.settings', settings:{ active_event:'AGM Penang 2026' } }).ok===true);
check('no token, no media', call({ action:'admin.media.upload', kind:'poster', mime:'image/png', data:PNG }).ok===false);
check('the public config is the only thing a stranger can read, and it only ever lists live items', pub().every(x=>x.url));

console.log('\ndeleting');
const id = r.id;
r = A({ action:'admin.media.delete', id });
check('delete removes it from the library and the page', r.ok && !r.media.some(x=>x.id===id) && !pub().some(x=>x.id===id));
check('...and puts the Drive file in the bin', Object.values(DRIVE.files).find(f=>f.name.startsWith('poster-agm-penang-2026-cara')).trashed===true);
check('...nothing left to delete twice', A({ action:'admin.media.delete', id }).ok===false);

console.log('\nwhat is built into the page');
let lib = A({ action:'admin.get' }).media;
const BI = ['builtin-qr-registration','builtin-qr-more-info','builtin-qr-whatsapp','builtin-poster-session-talk'];
check('the three codes and the session poster head the list', BI.every((id,i)=>lib[i].id===id && lib[i].builtin===true), lib.slice(0,4).map(x=>x.id));
check('...each with the page\'s own picture to show', lib.slice(0,4).every(x=>/^(media|docs)\/[\w.-]+\.(png|webp)$/.test(x.thumb)), lib.slice(0,4).map(x=>x.thumb));
check('...on, for every event, until somebody changes them', lib.slice(0,4).every(x=>x.on && x.live && x.event===''), lib.slice(0,4));
const tabRows = () => tabs['Media'].rows.filter(r=>String(r[0]).startsWith('builtin-'));
check('...and no rows written just for listing them', tabRows().length===0);
const files0 = JSON.stringify(DRIVE.files);
r = A({ action:'admin.media.set', id:'builtin-qr-whatsapp', on:false });
check('a built-in code can be hidden', r.ok && call({ action:'config' }).builtin_off.join()==='builtin-qr-whatsapp', call({ action:'config' }).builtin_off);
check('...which writes its row then', tabRows().length===1 && tabRows()[0][5]==='no', tabRows());
check('...and touches nothing in Drive', JSON.stringify(DRIVE.files)===files0);
r = A({ action:'admin.media.set', id:'builtin-qr-whatsapp', on:true });
check('...and shown again', r.ok && call({ action:'config' }).builtin_off.length===0 && tabRows().length===1);
A({ action:'admin.settings', settings:{ active_event:'AGM Penang 2026' } });
r = A({ action:'admin.media.set', id:'builtin-poster-session-talk', event:'AGM Penang 2026' });
check('the session poster tied to the AGM shows at the AGM', r.ok && !call({ action:'config' }).builtin_off.includes('builtin-poster-session-talk'));
A({ action:'admin.settings', settings:{ active_event:'Pharmacy Day' } });
check('...and is locked off the page at any other event', call({ action:'config' }).builtin_off.includes('builtin-poster-session-talk'));
lib = A({ action:'admin.get' }).media;
check('...admin sees it as locked', lib.find(x=>x.id==='builtin-poster-session-talk').locked===true);
A({ action:'admin.settings', settings:{ active_event:'' } });
check('no event chosen: it is back', !call({ action:'config' }).builtin_off.includes('builtin-poster-session-talk'));
r = A({ action:'admin.media.delete', id:'builtin-qr-registration' });
check('a built-in piece cannot be deleted, only hidden', r.ok===false && /turn it off/.test(r.error), r);
check('the public config never lists them as media', !call({ action:'config' }).media.some(x=>/^builtin-/.test(x.id)));
A({ action:'admin.media.set', id:'builtin-poster-session-talk', event:'' });
r = A({ action:'admin.media.set', for_event:'', on:false });
check('"all off" for every event takes the built-ins with it', r.ok && BI.every(id=>call({ action:'config' }).builtin_off.includes(id)), call({ action:'config' }).builtin_off);
A({ action:'admin.media.set', for_event:'', on:true });
check('...and "all on" brings them back', call({ action:'config' }).builtin_off.length===0, call({ action:'config' }).builtin_off);
{
  /* the old all-or-nothing switch, left at hide: the three codes start hidden */
  const H2 = load(), o2 = H2.signIn(OWNER);
  H2.call({ token:o2.token, action:'admin.settings', settings:{ qr_builtin:'hide' } });
  const off = H2.call({ action:'config' }).builtin_off;
  check('a "hide" left by the old switch starts the three codes hidden, not the poster', off.join()==='builtin-qr-registration,builtin-qr-more-info,builtin-qr-whatsapp', off);
  H2.call({ token:o2.token, action:'admin.media.set', id:'builtin-qr-more-info', on:true });
  check('...and each can be turned back on from the list', !H2.call({ action:'config' }).builtin_off.includes('builtin-qr-more-info'));
}

console.log('\nhardening: no Media tab, Drive calls, names that look like dates');
{
  /* a script pasted in without setUp has no Media tab: the page's config must still work */
  const H3 = load(); delete H3.tabs['Media'];
  const c3 = H3.call({ action:'config' });
  check('no Media tab: the config still answers, with the page settings intact', c3.ok===true && c3.settings.page_mode==='open' && Array.isArray(c3.sections), c3);
  check('...and simply no media, nothing built in left out', c3.media.length===0 && c3.builtin_off.length===0, { media:c3.media, off:c3.builtin_off });
  const o3 = H3.signIn(OWNER);
  check('...admin.get still opens too', H3.call({ token:o3.token, action:'admin.get' }).ok===true);
}
{
  /* turning one item off should ask Drive about one file, not every file in the library */
  const H4 = load(), o4 = H4.signIn(OWNER), A4 = x => H4.call({ token:o4.token, ...x });
  for(let i=0;i<12;i++) A4({ action:'admin.media.upload', kind:'poster', mime:'image/png', data:PNG, filename:'P'+i+'.png', event: i<6 ? 'AGM' : 'Pharmacy Day' });
  let calls=0; Object.values(H4.DRIVE.files).forEach(f=>{ const s0=f.setSharing; f.setSharing=(a,p)=>{ calls++; return s0(a,p); }; });
  const one = A4({ action:'admin.get' }).media.find(x=>!x.builtin);
  A4({ action:'admin.media.set', id:one.id, on:false });
  check('one item off, twelve in the library: Drive is asked once', calls===1, calls);
  calls=0; A4({ action:'admin.media.set', id:one.id, on:false });
  check('...asked again to do what is already done: Drive is not asked at all', calls===0, calls);
  calls=0; A4({ action:'admin.settings', settings:{ active_event:'AGM' } });
  check('choosing an event asks Drive only about the files whose answer changed (the other six)', calls===6, calls);
  check('...and each file\'s sharing is what the list says', A4({ action:'admin.get' }).media.filter(x=>!x.builtin).every(m=>{ const f=Object.values(H4.DRIVE.files).find(f=>f.name.startsWith(m.name)); return (f.access==='ANYONE_WITH_LINK')===m.live; }));
  /* a row from before the column: Drive is told once, then remembered */
  H4.tabs['Media'].rows.slice(1).forEach(r=>{ r[13]=''; });
  calls=0; A4({ action:'admin.media.set', id:one.id, on:true });
  check('rows from before the "shared" column are put right once', calls===12, calls);
  calls=0; A4({ action:'admin.media.set', id:one.id, on:true });
  check('...and then left alone', calls===0, calls);
}
{
  /* Sheets turns "13/9" into a date as it is typed in; an event name is text */
  const H5 = load(), o5 = H5.signIn(OWNER), A5 = x => H5.call({ token:o5.token, ...x });
  const r5 = A5({ action:'admin.media.upload', kind:'poster', mime:'image/png', data:PNG, filename:'Day.png', event:'13/9' });
  const row = H5.tabs['Media'].rows.find(x=>x[0]===r5.id);
  check('an event that looks like a date is written as text (the apostrophe Sheets hides)', row[4]==="'13/9", row[4]);
  check('...and reads back as the name that was typed', A5({ action:'admin.get' }).media.find(x=>x.id===r5.id).event==='13/9');
  A5({ action:'admin.settings', settings:{ active_event:'13/9' } });
  check('choosing it as the event: stored as text, and it matches', H5.call({ action:'config' }).settings.active_event==='13/9' && H5.call({ action:'config' }).media.some(x=>x.id===r5.id));
  const r6 = A5({ action:'admin.media.upload', kind:'poster', mime:'image/png', data:PNG, filename:'2026.png', event:'2026' });
  check('a name that is all digits stays text too', H5.tabs['Media'].rows.find(x=>x[0]===r6.id)[4]==="'2026");
}

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad?1:0);
