/* The booth admin script, driven for real against in-memory tabs with the
   Google services stubbed. What is under test is the gate and what it guards:
   who can get a link, what a link buys and for how long, that the public
   config never leaks the passcode or the admin list, and that the sheet is
   the one place an admin can be revoked. */
import fs from 'fs';
const src = fs.readFileSync('/workspace/facerinna-showcase/tools/booth-admin.gs','utf8');

const BOOK_ID = '1J9QAO7PUO4caLhDBsKMGZ5tofv4Gqy5-QSVlo_hBEso';
const tabs = {};
const mkSheet = o => ({
  getLastRow: () => o.rows.length,
  appendRow: r => o.rows.push(r.slice()),
  setFrozenRows(){}, setColumnWidth(){}, hideColumns(){},
  getRange: (r,c,nr,nc) => {
    const put = (ri,ci,v) => { while(o.rows.length<=ri) o.rows.push([]);
                               while(o.rows[ri].length<=ci) o.rows[ri].push('');
                               o.rows[ri][ci]=v; };
    const range = {
      getValues: () => { const out=[]; for(let i=r-1;i<r-1+(nr||1);i++){ const row=o.rows[i]||[]; const line=[];
        for(let j=c-1;j<c-1+(nc||1);j++) line.push(row[j]===undefined?'':row[j]); out.push(line);} return out; },
      setValue: v => { for(let i=r-1;i<r-1+(nr||1);i++) put(i,c-1,v); return range; },
      setValues: vals => { vals.forEach((row,i) => row.forEach((v,j) => put(r-1+i, c-1+j, v))); return range; },
      setFontWeight(){ return range; },
    };
    return range;
  },
});
const SpreadsheetApp = { openById: id => {
  if(id!==BOOK_ID) throw new Error('no book '+id);
  return { getSheetByName: n => tabs[n] ? mkSheet(tabs[n]) : null,
           insertSheet: n => { tabs[n]={rows:[]}; return mkSheet(tabs[n]); } };
}};
const OWNER='owner@facerinna.test';
const mails=[];
const MailApp = { sendEmail: o => mails.push(o), getRemainingDailyQuota: () => 100 };
let LOCK_FREE=true;
const LockService = { getScriptLock: () => ({ waitLock(){}, releaseLock(){ LOCK_FREE=true; },
  tryLock(){ if(!LOCK_FREE) return false; LOCK_FREE=false; return true; } }) };
const ContentService = { MimeType:{JSON:'j'}, createTextOutput: s => ({ setMimeType: () => s }) };
let uuid=0;
let slept=[];
const Utilities = { getUuid: () => '00000000-0000-4000-8000-' + String(++uuid).padStart(12,'0'),
                    sleep(ms){ slept.push(ms); } };
const PROPS={};
const PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (k in PROPS ? PROPS[k] : null),
  setProperty: (k,v) => { PROPS[k]=String(v); },
  deleteProperty: k => { delete PROPS[k]; } }) };
const Session = { getEffectiveUser: () => ({ getEmail: () => OWNER }) };
const Logger = { log(){} };
/* a clock the tests can move */
let NOW = Date.parse('2026-09-16T12:00:00Z');
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a){ if(a.length) super(...a); else super(NOW); }
  static now(){ return NOW; }
}
const Date_ = FakeDate;

const m = eval(`(() => { const Date = Date_; ${src}
  return { doPost, doGet, setUp, preview, SETTING_KEYS }; })()`);

const call = o => JSON.parse(m.doPost({ postData:{ contents: JSON.stringify(o), type:'text/plain' } }));
const get  = p => JSON.parse(m.doGet({ parameter: p||{} }));
let ok=true;
const check = (l,c,x) => { if(!c) ok=false; console.log((c?'  PASS  ':'  FAIL  ')+l+(!c&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const linkKey = mail => (mail.body.match(/#k=([0-9a-f-]{36})/)||[])[1];

console.log('set up');
m.setUp();
check('four tabs exist', ['Admins','Settings','Segments','Admin sessions'].every(t=>tabs[t]));
check('the owner is the first admin', tabs['Admins'].rows[1] && tabs['Admins'].rows[1][0]===OWNER && tabs['Admins'].rows[1][1]==='yes');
const NSET = Object.keys(m.SETTING_KEYS).length;     /* asked, not hard-coded, so it cannot go stale */
check('every setting has a row', tabs['Settings'].rows.length===NSET+1);
check('setUp twice adds nothing', (m.setUp(), tabs['Admins'].rows.length===2 && tabs['Settings'].rows.length===NSET+1));

console.log('\nthe public config');
let cfg=call({action:'config'});
check('config is public and open by default', cfg.ok && cfg.settings.page_mode==='open' && cfg.settings.welcome==='show');
check('it carries no passcode and no admins', !('passcode' in cfg.settings) && !('admins' in cfg));
check('GET ?config=1 says the same', JSON.stringify(get({config:'1'}).settings)===JSON.stringify(cfg.settings));
check('GET alone only says it is alive', get().service==='facerinna booth admin');

console.log('\nsigning in');
let r=call({action:'login',email:'stranger@example.com'});
check('a stranger gets the same answer as an admin', r.ok===true && r.sent===true);
check('...but no mail', mails.length===0);
check('a bad address is refused', call({action:'login',email:'nope'}).ok===false);
r=call({action:'login',email:'Owner@Facerinna.test'});
check('an admin gets a link, case-insensitively', r.ok && mails.length===1 && mails[0].to===OWNER);
const key=linkKey(mails[0]);
check('the link carries a key', !!key);
check('the mail is a sign-in link, not anything else', /admin.html#k=/.test(mails[0].body));
check('nothing admin works without a token', call({action:'admin.get'}).ok===false);
check('a made-up token is refused', call({action:'admin.get',token:'00000000-0000-4000-8000-999999999999'}).ok===false);
check('the link key itself is not a session', call({action:'admin.get',token:key}).ok===false);
r=call({action:'exchange',key});
check('the link becomes a session', r.ok && r.token && r.email===OWNER);
const token=r.token;
check('the link works once', call({action:'exchange',key}).ok===false);
check('whoami knows the admin', call({action:'whoami',token}).email===OWNER);
r=call({action:'admin.get',token});
check('admin.get shows the private settings and the admin list', r.ok && 'passcode' in r.settings && r.admins.length===1 && Array.isArray(r.sections));

console.log('\nlinks expire, sessions expire, admins can be revoked');
call({action:'login',email:OWNER}); const key2=linkKey(mails[1]);
NOW += 21*60*1000;
check('a link older than 20 minutes is dead', /expired/.test(call({action:'exchange',key:key2}).error||''));
call({action:'login',email:OWNER}); const key3=linkKey(mails[2]);
const t3=call({action:'exchange',key:key3}).token;
NOW += 31*24*3600*1000;
check('a session older than 30 days is dead', call({action:'whoami',token:t3}).ok===false);
check('...while a younger one lives', (NOW-=31*24*3600*1000, call({action:'whoami',token:t3}).ok===true));
tabs['Admins'].rows[1][1]='no';
check('active = no in the sheet ends the session at once', call({action:'whoami',token}).ok===false && call({action:'admin.get',token}).ok===false);
check('...and stops new links', (call({action:'login',email:OWNER}), mails.length===3));
tabs['Admins'].rows[1][1]='yes';
check('active = yes brings it back', call({action:'whoami',token}).ok===true);
tabs['Admins'].rows.push(['second@clinic.my','yes','Second','']);
call({action:'login',email:'second@clinic.my'});
check('a second admin typed into the sheet can sign in', mails.length===4 && mails[3].to==='second@clinic.my');
check('logout ends a session', (call({action:'logout',token:t3}), call({action:'whoami',token:t3}).ok===false));

console.log('\nsettings');
r=call({action:'admin.settings',token,settings:{page_mode:'locked'}});
check('locking without a passcode is refused', r.ok===false && /passcode/.test(r.error));
check('...and the page stays open', call({action:'config'}).settings.page_mode==='open');
/* the sheet, not only the public view: the public view coerces a locked page
   with no passcode back to open, which once hid a refusal that had already
   written 'locked' into the sheet */
check('...and nothing was written before the refusal', call({action:'admin.get',token}).settings.page_mode==='open');
r=call({action:'admin.settings',token,settings:{passcode:'booth2026',page_mode:'locked',lock_message:'Ask the team',welcome:'hide',bogus:'x'}});
check('with a passcode the page locks', r.ok && r.public.page_mode==='locked');
cfg=call({action:'config'});
check('the page sees locked + the message + welcome hidden', cfg.settings.page_mode==='locked' && cfg.settings.lock_message==='Ask the team' && cfg.settings.welcome==='hide');
check('the passcode still never goes out', !('passcode' in cfg.settings) && !JSON.stringify(cfg).includes('booth2026'));
check('an unknown key is dropped, not stored', !tabs['Settings'].rows.some(x=>x[0]==='bogus'));
check('unlock with the right passcode', call({action:'unlock',passcode:'booth2026'}).ok===true);
check('unlock with the wrong one', call({action:'unlock',passcode:'booth2025'}).ok===false);
check('unlock with nothing', call({action:'unlock'}).ok===false);
check('a stranger cannot change settings', call({action:'admin.settings',settings:{page_mode:'open'}}).ok===false && call({action:'config'}).settings.page_mode==='locked');
r=call({action:'admin.settings',token,settings:{page_mode:'hidden',hidden_message:'Back on Monday'}});
check('hidden mode', call({action:'config'}).settings.page_mode==='hidden' && call({action:'config'}).settings.hidden_message==='Back on Monday');
call({action:'admin.settings',token,settings:{page_mode:'open',welcome:'show'}});
check('open again', call({action:'config'}).settings.page_mode==='open' && call({action:'config'}).settings.welcome==='show');
LOCK_FREE=false;
check('a write while the lock is held says busy', /busy/.test(call({action:'admin.settings',token,settings:{page_mode:'open'}}).error||''));
LOCK_FREE=true;

console.log('\nsegments');
check('a segment needs a title', call({action:'admin.segment.save',token,segment:{}}).ok===false);
check('urls must be https', /https/.test(call({action:'admin.segment.save',token,segment:{title:'X',embed_url:'http://x.y'}}).error||''));
r=call({action:'admin.segment.save',token,segment:{title:'Skin IQ video',eyebrow:'Watch',description:'A short clip',after:'qrcore',
  thumbnail_url:'https://img.example/a.jpg',embed_url:'https://www.youtube.com/embed/abc',link_url:'https://example.com/more',link_label:'More'}});
check('a segment is saved with an id', r.ok && /^seg-[0-9a-f]{10}$/.test(r.id), r);
const id1=r.id;
r=call({action:'admin.segment.save',token,segment:{title:'Second',after:'nowhere',visible:'no'}});
check('an unknown place falls back to the end', r.ok && r.segments.find(s=>s.id===r.id).after==='end');
const id2=r.id;
cfg=call({action:'config'});
check('the page gets only the visible one', cfg.segments.length===1 && cfg.segments[0].id===id1 && cfg.segments[0].after==='qrcore' && cfg.segments[0].embed_url.includes('youtube'));
check('the admin sees both', call({action:'admin.get',token}).segments.length===2);
r=call({action:'admin.segment.save',token,segment:{id:id2,title:'Second, shown',visible:'yes',after:'game'}});
check('editing keeps the id and shows it', r.ok && call({action:'config'}).segments.length===2);
r=call({action:'admin.segment.order',token,ids:[id2,id1]});
check('reordering is honoured', r.segments[0].id===id2 && call({action:'config'}).segments[0].id===id2);
check('a stranger cannot save', call({action:'admin.segment.save',segment:{title:'Evil'}}).ok===false);
r=call({action:'admin.segment.delete',token,id:id1});
check('deleting removes it', r.ok && r.segments.length===1 && call({action:'config'}).segments.length===1);
check('deleting twice says so', call({action:'admin.segment.delete',token,id:id1}).ok===false);
check('titles are cut, not refused', call({action:'admin.segment.save',token,segment:{title:'x'.repeat(500)}}).ok===true && call({action:'admin.get',token}).segments.every(s=>s.title.length<=160));

console.log('\nsections of the page');
check('setUp gave every section a row, all showing',
  tabs['Sections'].rows.length===9 && call({action:'admin.get',token}).section_rows.every(x=>x.mode==='show'));
check('the section rows are in the order of the page, not the sheet',
  call({action:'admin.get',token}).section_rows.map(x=>x.id).join()==='range,heroes,evidence,gallery,clinic,qrcore,talk,game');
check('a page with nothing changed sends no section states', call({action:'config'}).section_states.length===0);
check('an unknown section is refused', call({action:'admin.section.set',token,id:'nope',mode:'hidden'}).ok===false);
check('a stranger cannot change one', call({action:'admin.section.set',id:'qrcore',mode:'hidden'}).ok===false);

r=call({action:'admin.section.set',token,id:'qrcore',mode:'hidden'});
cfg=call({action:'config'});
check('hiding the QR section reaches the page', r.ok && cfg.section_states.length===1
  && cfg.section_states[0].id==='qrcore' && cfg.section_states[0].mode==='hidden' && cfg.section_states[0].label==='QR Code');
check('...and the other seven are left alone', call({action:'admin.get',token}).section_rows.filter(x=>x.mode==='show').length===7);

/* the site passcode is 'booth2026' by now, set earlier */
r=call({action:'admin.section.set',token,id:'game',mode:'locked',message:'Ask at the counter'});
check('a section locks on the site passcode when given none of its own', r.ok);
cfg=call({action:'config'});
const gameState=cfg.section_states.filter(x=>x.id==='game')[0];
check('the page is told it is locked, and the message, but never a passcode',
  gameState && gameState.mode==='locked' && gameState.message==='Ask at the counter'
  && !('passcode' in gameState) && !JSON.stringify(cfg).includes('booth2026'), gameState);
check('the site passcode opens it', call({action:'unlock',section:'game',passcode:'booth2026'}).ok===true);
check('a wrong one does not', call({action:'unlock',section:'game',passcode:'nope'}).ok===false);
check('a section that is not locked opens without asking', call({action:'unlock',section:'range'}).open===true);
check('an unknown section is not a way in', call({action:'unlock',section:'nope',passcode:'booth2026'}).ok===false);

r=call({action:'admin.section.set',token,id:'talk',mode:'locked',passcode:'derma'});
check('a section can carry its own passcode', r.ok && call({action:'unlock',section:'talk',passcode:'derma'}).ok===true);
check('...and then the site one does not open it', call({action:'unlock',section:'talk',passcode:'booth2026'}).ok===false);
check('...while the site passcode still opens the one that leans on it', call({action:'unlock',section:'game',passcode:'booth2026'}).ok===true);
check('its own passcode never goes out', !JSON.stringify(call({action:'config'})).includes('derma'));

r=call({action:'admin.settings',token,settings:{passcode:''}});
check('clearing the site passcode while a section leans on it is refused, by name',
  r.ok===false && /Games/.test(r.error||''), r);
check('...and the passcode is still in the sheet, not cleared before the refusal',
  call({action:'admin.get',token}).settings.passcode==='booth2026');
check('...so the lock still asks', call({action:'unlock',section:'game',passcode:'nope'}).ok===false
  && call({action:'unlock',section:'game',passcode:'booth2026'}).ok===true);
call({action:'admin.section.set',token,id:'game',mode:'show'});
call({action:'admin.section.set',token,id:'qrcore',mode:'show'});
call({action:'admin.section.set',token,id:'talk',mode:'show'});
check('putting them back clears the page states', call({action:'config'}).section_states.length===0);

console.log('\na locked segment withholds its content, not just covers it');
r=call({action:'admin.segment.save',token,segment:{title:'Members video',after:'game',mode:'locked',
  thumbnail_url:'https://img.example/a.jpg',embed_url:'https://embed.example/secret',link_url:'https://example.com/secret',link_label:'Watch'}});
const lockedSeg=r.id;
cfg=call({action:'config'});
const sent=cfg.segments.filter(x=>x.id===lockedSeg)[0];
check('the page gets its title and thumbnail', sent && sent.title==='Members video' && sent.thumbnail_url==='https://img.example/a.jpg');
check('...and is told it is locked', sent && sent.locked===true);
check('...but the embed and the link are not in the config at all',
  !('embed_url' in sent) && !('link_url' in sent) && !JSON.stringify(cfg).includes('embed.example/secret'), sent);
r=call({action:'unlock',segment:lockedSeg,passcode:'booth2026'});
check('the passcode is what fetches them', r.ok===true && r.segment.embed_url==='https://embed.example/secret' && r.segment.link_label==='Watch', r);
check('a wrong passcode fetches nothing', call({action:'unlock',segment:lockedSeg,passcode:'nope'}).ok===false);
check('an unknown segment is not a way in', call({action:'unlock',segment:'seg-nope',passcode:'booth2026'}).ok===false);
check('clearing the site passcode while a segment is locked is refused',
  call({action:'admin.settings',token,settings:{passcode:''}}).ok===false);
call({action:'admin.segment.save',token,segment:{id:lockedSeg,title:'Members video',mode:'hidden'}});
check('hidden again, the page is not even told it exists', !call({action:'config'}).segments.some(x=>x.id===lockedSeg));
check('the admin still sees it, with its mode', call({action:'admin.get',token}).segments.some(x=>x.id===lockedSeg && x.mode==='hidden'));

console.log('\nthe privacy notice details');
r=call({action:'admin.settings',token,settings:{privacy_entity:'FACERINNA Sdn. Bhd.',privacy_email:'privacy@facerinna.test',
  privacy_address:'12 Jalan Contoh, Penang',privacy_retention:'24 months'}});
cfg=call({action:'config'});
check('they are public, because a notice with no entity is not a notice',
  r.ok && cfg.settings.privacy_entity==='FACERINNA Sdn. Bhd.' && cfg.settings.privacy_email==='privacy@facerinna.test'
  && cfg.settings.privacy_retention==='24 months', cfg.settings);
check('the passcode is still not', !('passcode' in cfg.settings));
check('empty is the default, not an invented value',
  call({action:'admin.settings',token,settings:{privacy_entity:''}}).ok && call({action:'config'}).settings.privacy_entity==='');

console.log('\nguessing the passcode costs more each time');
call({action:'admin.settings',token,settings:{passcode:'booth2026',page_mode:'open'}});
/* from a clean slate, or the count left behind by an earlier check decides
   where the ramp starts */
call({action:'unlock',passcode:'booth2026'});
slept=[];
for(let i=0;i<4;i++) call({action:'unlock',passcode:'nope'});
check('each wrong guess waits longer than the last, up to the cap',
  JSON.stringify(slept)===JSON.stringify([600,1200,1800,2000]), slept);
/* The cap is low on purpose: a long wait holds a simultaneous-execution slot,
   so too generous a cap turns the throttle into the cheaper attack. Pinned to
   the exact number rather than a range -- a cap that quietly drifted upward is
   the failure this is here to catch. */
check('...and the wait is capped at two seconds, so a guesser cannot hold a script slot open',
  (slept=[], Array.from({length:12},()=>call({action:'unlock',passcode:'nope'})), Math.max(...slept)===2000), slept);
check('a right passcode costs nothing', (slept=[], call({action:'unlock',passcode:'booth2026'}).ok===true && slept.length===0));
check('...and clears the cost for the next wrong one',
  (slept=[], call({action:'unlock',passcode:'nope'}), slept[0]===600), slept);
check('it is not a lockout: the right passcode still works after many wrong ones',
  (Array.from({length:20},()=>call({action:'unlock',passcode:'nope'})),
   call({action:'unlock',passcode:'booth2026'}).ok===true));

console.log('\nan address that would be a formula in the sheet');
check('an admin address starting with = cannot be used to ask for a link',
  call({action:'login',email:'=cmd|calc!A1@evil.test'}).ok===false);
check('...nor with + or @', call({action:'login',email:'+x@y.test'}).ok===false
  && call({action:'login',email:'@x@y.test'}).ok===false);
check('an ordinary address still works', call({action:'login',email:'dr.lim99@clinic.com.my'}).ok===true);

console.log('\nbad input');
check('bad json is an answer, not a crash', JSON.parse(m.doPost({postData:{contents:'{nope'}})).ok===false);
check('an unknown action', call({action:'dance'}).ok===false);
check('no action at all', call({}).ok===false);

console.log(ok? '\nadmin: sign in, settings, sections, segments, privacy' : '\nSOMETHING IS WRONG');
process.exit(ok?0:1);
