/* Apps Script will not run here, so the Google services are stubbed and
   doPost is driven for real against an in-memory request sheet and in-memory
   workbooks. The point of most of it is the gate: what a token buys, what it
   stops buying the moment a cell changes, and that the four reasons a refusal
   can have stay distinguishable. */
import fs from 'fs';
const src = fs.readFileSync('/workspace/facerinna-showcase/tools/vault-access.gs','utf8');

/* --- a fake workbook set, shaped exactly like the real tabs --- */
const REQ = { name:'Vault requests', rows: [] };
const books = {
  '1J9QAO7PUO4caLhDBsKMGZ5tofv4Gqy5-QSVlo_hBEso': { byName: { 'Vault requests': REQ } },
  '15eD6XtMVN1BRm41cD9wm33QMwW16R5sS': { byGid: {
     378921450: [['note','ignore me'],
                 ['No.','Code','SKU','Report No','Lab','Date','Subject','Param',
                  'CI','CP','CO','Generic','Disclaimer'],
                 ['1','FMS004','B5','INB/1','INBIOSIS','31 March 2026','subj','par',
                  'none','','other','generic','disc'],
                 ['2','FSS003','Toner','INB/2','Equilab','1 April 2026','s2','p2',
                  'ci2','cp2','','g2','d2'],
                 ['','spacer row that must be dropped']],
     610219740: [['No.','Series','SKUs','Generic','Disclaimer'],
                 ['1','Ceramide B5','a; b','gc','dd']],
     1440505952:[['No.','Code','SKU','Series','Aliases','Reports'],
                 ['1','FMS004','B5','Ceramide B5','none','4']] } },
  '1F1zDeTnSrfZ7j7bIu7FfiHRW0eoXu3_n4NjFAmnWBfE': { byGid: {
     524451717: [['junk'],
                 ['Product Name','SKU Code','Image URL','Test Report URL','Claims URL'],
                 ['B5 MOISTURIZER','FMS004',
                  'https://drive.google.com/file/d/ABC123xyz/view',
                  'https://drive.google.com/file/d/SECRET/view',
                  'https://canva.com/design/SECRET'],
                 ['','','']] } },
};
const mkSheet = o => ({
  getLastRow: () => (o.rows ? o.rows.length : o.grid.length),
  appendRow: r => o.rows.push(r),
  setFrozenRows(){}, setColumnWidth(){}, hideColumns(){},
  getSheetId: () => o.gid,
  getDataRange: () => ({ getDisplayValues: () => o.grid }),
  getRange: (r,c,nr,nc) => ({
    /* r is a 1-based SHEET row and rows[] is 0-based, so getRange(2,...) must
       start at rows[1]. Slicing from r-2 started at the header and dropped the
       last data row -- which is how a stub quietly tests something other than
       the code. */
    getValues: () => o.rows.slice(r-1, r-1+(nr||1)).map(x => x.slice(c-1, c-1+(nc||1))),
    setValue: v => { for(let i=r-1;i<r-1+(nr||1);i++){ while(o.rows[i].length<c) o.rows[i].push(''); o.rows[i][c-1]=v; } },
    setFontWeight(){ return this; },
  }),
});
const SpreadsheetApp = { openById: id => {
  const b = books[id]; if(!b) throw new Error('no book '+id);
  return {
    getSheetByName: n => b.byName && b.byName[n] ? mkSheet(b.byName[n]) : null,
    insertSheet: n => { b.byName = b.byName||{}; b.byName[n]={name:n,rows:[]}; return mkSheet(b.byName[n]); },
    getSheets: () => Object.keys(b.byGid||{}).map(g => mkSheet({gid:Number(g), grid:b.byGid[g]})),
  };
}};
const OWNER = 'owner@facerinna.test';
const mails = [];
/* Every mail lands in mails[]. The two kinds are told apart by filtering, not
   by keeping separate lists: a bug that mailed an approval LINK to the owner
   would vanish into a separate list and show up here. */
const links   = () => mails.filter(x => x.to !== OWNER);
const notices = () => mails.filter(x => x.to === OWNER);
let MAIL_BREAK = null;                 /* an address the mail server refuses */
const MailApp = { sendEmail: o => {
                    if(/^bounce@/.test(o.to) || o.to === MAIL_BREAK) throw new Error('bounced');
                    mails.push(o); },
                  getRemainingDailyQuota: () => 100 };
let LOCK_FREE = true;
const LockService = { getScriptLock: () => ({
  waitLock(){}, releaseLock(){ LOCK_FREE = true; },
  /* tryLock must be able to say no, or the lock is not under test at all. */
  tryLock(){ if(!LOCK_FREE) return false; LOCK_FREE = false; return true; } }) };

/* Installable triggers, kept in a list so stacking is visible. */
const TRIGGERS = [];
const ScriptApp = {
  newTrigger: fn => { const t={fn, kind:null};
    const b = { forSpreadsheet(){ t.kind="edit-book"; return b; },
                onEdit(){ return b; },
                timeBased(){ t.kind="timer"; return b; },
                everyMinutes(n){ t.mins=n; return b; },
                create(){ TRIGGERS.push(t); return t; } };
    return b; },
  getProjectTriggers: () => TRIGGERS.map(t => ({
    getHandlerFunction: () => t.fn, _t: t })),
  deleteTrigger: h => { const i = TRIGGERS.indexOf(h._t); if(i>=0) TRIGGERS.splice(i,1); },
};
const ContentService = { MimeType:{JSON:'j'}, createTextOutput: s => ({ setMimeType: () => s }) };
let uuid = 0;
const Utilities = { getUuid: () => 'tok-' + (++uuid),
                    formatDate: d => d.toISOString().slice(0,10) };
const Session = { getScriptTimeZone: () => 'UTC',
                  getEffectiveUser: () => ({ getEmail: () => 'owner@facerinna.test' }) };
const Logger = { log(){} };

const m = eval(`(() => { ${src}
  return { doPost, doGet, setUp, sendApprovals, preview, checkWorkbooks, readVault_,
           onSheetEdit, installTriggers, removeTriggers }; })()`);

const call = o => JSON.parse(m.doPost({ postData:{ contents: JSON.stringify(o), type:'text/plain' } }));
let ok = true;
const check = (l,c) => { if(!c) ok=false; console.log((c?'  PASS  ':'  FAIL  ')+l); };
const statusCell = (email, v) => {
  const r = REQ.rows.find(x => String(x[2]).toLowerCase() === email);
  r[4] = v; return r;
};

m.setUp();

console.log('asking for access');
check('a request is accepted',
  call({action:'request',name:'Dr Lim',email:'lim@clinic.my',organisation:'Clinic',consent:true}).ok === true);
check('it lands in the sheet as pending',
  REQ.rows.length === 2 && String(REQ.rows[1][4]) === 'pending');
check('asking twice does not make a second row',
  call({action:'request',name:'Dr Lim',email:'LIM@clinic.my',organisation:'',consent:true}).already === true
  && REQ.rows.length === 2);

console.log('\nwhat it refuses to accept');
check('no name',      call({action:'request',name:'',email:'a@b.com',consent:true}).ok === false);
check('bad email',    call({action:'request',name:'X',email:'not-an-email',consent:true}).ok === false);
check('no consent',   call({action:'request',name:'X',email:'x@y.com',consent:false}).ok === false);
check('unknown action', call({action:'whatever'}).ok === false);

console.log('\nbefore approval, nothing is readable');
check('no token at all',        call({action:'data',token:''}).reason === 'unknown');
check('a made-up token',        call({action:'data',token:'tok-999'}).reason === 'unknown');
check('status says pending',    call({action:'status',email:'lim@clinic.my'}).status === 'pending');
check('an address nobody knows',call({action:'status',email:'who@nowhere.com'}).status === 'none');

console.log('\napproving in the sheet, then sending');
statusCell('lim@clinic.my','approved');
check('nothing sent until sendApprovals runs', links().length === 0);
const r1 = m.sendApprovals();
check('one mail went out',      links().length === 1);
check('to the right person',    links()[0].to === 'lim@clinic.my');
check('the link carries a token in the fragment',
      /#vault=tok-\d+$/.test(links()[0].htmlBody.match(/href="([^"]+)"/)[1]));
check('running it again sends nothing more', (m.sendApprovals(), links().length === 1));

const TOKEN = REQ.rows[1][5];

console.log('\nwith the token, the reports arrive');
const d = call({action:'data',token:TOKEN});
check('ok',            d.ok === true);
check('reports read',  d.reports.length === 2);
check('the spacer row was dropped', d.reports.every(r => r.no > 0));
check('"none" became empty, as the build does', d.reports[0].claimsInstrument === '');
check('series read',   d.series.length === 1);
check('skus read',     d.skus.length === 1 && d.skus[0].reportCount === 4);
check('thumbs read',   d.thumbs.length === 1);
check('a Drive file link became a thumbnail link',
      d.thumbs[0].img === 'https://drive.google.com/thumbnail?id=ABC123xyz&sz=w800');
check('the internal Test Report URL is NOT returned',
     !JSON.stringify(d).includes('SECRET'));
check('it says who it let in', d.who === 'Dr Lim');

console.log('\nrevoking is one cell');
statusCell('lim@clinic.my','revoked');
check('the same token now fails', call({action:'data',token:TOKEN}).reason === 'revoked');
statusCell('lim@clinic.my','approved');
check('and putting it back works', call({action:'data',token:TOKEN}).ok === true);

console.log('\nexpiry');
REQ.rows[1][6] = new Date(Date.now() - 86400000);
check('an expired link says so, not "unknown"', call({action:'data',token:TOKEN}).reason === 'expired');
REQ.rows[1][6] = new Date(Date.now() + 86400000);
check('a live one still works', call({action:'data',token:TOKEN}).ok === true);

console.log('\na send that bounces does not mark the row as sent');
call({action:'request',name:'Bad',email:'bounce@nowhere.com',organisation:'',consent:true});
statusCell('bounce@nowhere.com','approved');
const before = links().length;
const r2 = m.sendApprovals();
check('no mail recorded',        links().length === before);
check('no token written, so the next run retries',
      String(REQ.rows.find(x=>x[2]==='bounce@nowhere.com')[5] || '') === '');
check('and it says which address failed', /bounce@nowhere\.com/.test(r2));

console.log('\nGET tells you the deployment is alive without revealing anything');
const g = JSON.parse(m.doGet());
check('ok', g.ok === true);
check('carries no report data', !JSON.stringify(g).includes('INB/'));

console.log('\nyou are told when somebody asks');
const nBefore = notices().length;
call({action:'request',name:'Nurul A',email:'nurul@hosp.my',organisation:'Hosp KL',consent:true});
check('a notice goes out',        notices().length === nBefore + 1);
const notice = notices()[notices().length-1];
check('it names the person',      /Nurul A/.test(notice.htmlBody));
check('and their address',        /nurul@hosp\.my/.test(notice.htmlBody));
check('and their organisation',   /Hosp KL/.test(notice.htmlBody));
check('it links to the workbook', notice.htmlBody.includes('docs.google.com/spreadsheets/d/'));
check('it carries no token',      !/#vault=/.test(notice.htmlBody));
check('asking again does not notify again',
      (call({action:'request',name:'Nurul A',email:'nurul@hosp.my',consent:true}),
       notices().length === nBefore + 1));

console.log('\na notice that will not send must not lose the request');
MAIL_BREAK = OWNER;
const rowsBefore = REQ.rows.length;
const rq = call({action:'request',name:'Tan',email:'tan@x.my',organisation:'',consent:true});
MAIL_BREAK = null;
check('the visitor still gets ok',  rq.ok === true);
check('and the row is still written', REQ.rows.length === rowsBefore + 1);

console.log('\napproving is one cell: the edit trigger');
statusCell('tan@x.my','approved');
const editOn = (sheet,col,row,val) => m.onSheetEdit({ value: val, range: {
  getSheet: () => ({ getName: () => sheet }), getColumn: () => col, getRow: () => row } });
let L = links().length;
editOn('Scores', 5, 4, 'approved');
check('an edit on another tab does nothing', links().length === L);
editOn('Vault requests', 4, 4, 'approved');
check('an edit on another column does nothing', links().length === L);
editOn('Vault requests', 5, 1, 'approved');
check('an edit on the header row does nothing', links().length === L);
editOn('Vault requests', 5, 4, 'pending');
check('any other status does nothing', links().length === L);
editOn('Vault requests', 5, 4, ' Approved ');
check('approving sends the link, spacing and case aside', links().length === L + 1);
check('it went to the person approved', links()[links().length-1].to === 'tan@x.my');
check('a malformed event is survived, not thrown',
      (m.onSheetEdit(undefined), m.onSheetEdit({}), true));

console.log('\ntwo runs at once must not issue two keys');
call({action:'request',name:'Race',email:'race@x.my',organisation:'',consent:true});
statusCell('race@x.my','approved');
const held = LockService.getScriptLock(); held.tryLock(1);   /* another run has it */
L = links().length;
const busy = m.sendApprovals();
check('the second run declines', links().length === L && /already sending/.test(busy));
held.releaseLock();
check('and once free the link goes', (m.sendApprovals(), links().length === L + 1));

console.log('\ntriggers install once, not once per run');
check('two triggers',   (m.installTriggers(), TRIGGERS.length === 2));
check('one edit, one timer',
      TRIGGERS.filter(t=>t.kind==='edit-book').length === 1 &&
      TRIGGERS.filter(t=>t.kind==='timer' && t.mins === 5).length === 1);
check('installing again does not stack them',
      (m.installTriggers(), TRIGGERS.length === 2));
check('and they can be taken away', (m.removeTriggers(), TRIGGERS.length === 0));

console.log(ok ? '\nall good' : '\nSOMETHING IS WRONG');
process.exit(ok ? 0 : 1);
