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
const Utilities = { getUuid: () => '00000000-0000-4000-8000-' + String(++uuid).padStart(12,'0'), sleep(){} };
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
  return { doPost, doGet, setUp, preview }; })()`);

const call = o => JSON.parse(m.doPost({ postData:{ contents: JSON.stringify(o), type:'text/plain' } }));
const get  = p => JSON.parse(m.doGet({ parameter: p||{} }));
let ok=true;
const check = (l,c,x) => { if(!c) ok=false; console.log((c?'  PASS  ':'  FAIL  ')+l+(!c&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const linkKey = mail => (mail.body.match(/#k=([0-9a-f-]{36})/)||[])[1];

console.log('set up');
m.setUp();
check('four tabs exist', ['Admins','Settings','Segments','Admin sessions'].every(t=>tabs[t]));
check('the owner is the first admin', tabs['Admins'].rows[1] && tabs['Admins'].rows[1][0]===OWNER && tabs['Admins'].rows[1][1]==='yes');
check('every setting has a row', tabs['Settings'].rows.length===6);
check('setUp twice adds nothing', (m.setUp(), tabs['Admins'].rows.length===2 && tabs['Settings'].rows.length===6));

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

console.log('\nbad input');
check('bad json is an answer, not a crash', JSON.parse(m.doPost({postData:{contents:'{nope'}})).ok===false);
check('an unknown action', call({action:'dance'}).ok===false);
check('no action at all', call({}).ok===false);

console.log(ok? '\nadmin: sign in by link, settings, segments' : '\nSOMETHING IS WRONG');
process.exit(ok?0:1);
