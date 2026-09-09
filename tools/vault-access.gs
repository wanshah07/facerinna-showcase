/* FACERINNA vault access — request, approve in the sheet, read the reports.
 *
 * WHAT IT IS FOR
 *   The test-reports vault is open: anyone holding its address reads 155 rows
 *   of report numbers, laboratories, dates, parameters and claim text. This
 *   closes it the way the events form already works — a visitor asks, you
 *   approve in a sheet, and only then do the rows exist for them.
 *
 *   The rows are served BY THIS SCRIPT, from the workbooks, after the token is
 *   checked. They stop being baked into the published page. That distinction
 *   is the whole thing: a gate over a page that still carries its data is a
 *   lock on a door standing beside an open window, and this project has
 *   already shipped that mistake once.
 *
 *   The sheet is the admin panel. Approving is typing `approved` in a cell.
 *   Revoking is typing anything else. There is no admin API and no admin
 *   password, because either would have to live somewhere, and the only
 *   somewhere on a static site is the page.
 *
 * =====================================================================
 *  THIS IS YOUR THIRD APPS SCRIPT PROJECT. IT NEEDS ITS OWN.
 * =====================================================================
 *
 *      1. events registration   AKfycbzYlL4-6rWb...
 *      2. booth scores          AKfycbx4zwbrto2iEUu...
 *      3. vault access          <- this one, and it must be a NEW project
 *
 *   A project has exactly one doPost. Pasting this into either of the two
 *   above REPLACES theirs and takes that feature off the air at the URL it has
 *   always answered on. That happened on 9 Sept: this pattern went into the
 *   registration project and broke event sign-ups the night before the AGM.
 *
 *   Before you hand me the /exec URL, check it starts with neither
 *   "AKfycbzYlL4" nor "AKfycbx4zwb". If it does, the new-project step went
 *   wrong and nothing else here matters.
 *
 * SET UP
 *   1. script.google.com -> New project.  Not Extensions -> Apps Script.
 *   2. Paste this whole file. Fill in VAULT_URL below.
 *   3. Run -> setUp once. Grant the permissions, including the one for
 *      sending mail — that is what delivers the approval links.
 *   4. Deploy -> New deployment -> Web app.
 *        Execute as:      Me
 *        Who has access:  Anyone      <- not "Anyone with Google account"
 *   5. Send me the /exec URL and I will wire the page to it.
 *
 *   Re-deploy after ANY edit: Deploy -> Manage deployments -> pencil ->
 *   Version: New version. Editing alone changes nothing that is live.
 *
 * WHY THIS AND NOT FIREBASE
 *   The one thing that killed the Supabase attempt was mail: its built-in
 *   sender only delivers to members of your Supabase organisation, and a
 *   dermatologist at an AGM is not one. Apps Script sends from your own Gmail
 *   — 100 recipients a day on a consumer account, 1500 on Workspace — with no
 *   such restriction and no domain to verify. setUp reports your remaining
 *   quota so the number is never a guess.
 *
 * WHAT THIS DOES NOT DO
 *   It does not encrypt anything, and a person who is approved can pass their
 *   link to somebody else. The token is a key, and keys can be handed on. What
 *   it gives you is a list of who asked, who you let in, and the ability to
 *   revoke any of them in one cell — which is what "controlled access" means
 *   in practice for a booth. If a link is being shared, blank its token.
 */

/* ------------------------------------------------------------------ config */

/* The workbook that holds the request list. The scores workbook is fine —
   a separate TAB in the same book, not a separate book. */
var SHEET_ID = '1J9QAO7PUO4caLhDBsKMGZ5tofv4Gqy5-QSVlo_hBEso';
var REQ_TAB  = 'Vault requests';

/* Where an approved link should land. Must be the vault page's real address,
   because the link in the email is built from it. */
var VAULT_URL = 'https://my.facerinna.com/facerinna-test-reports-claims/';

/* The workbooks the reports actually live in, and the tabs inside them. These
   are the same ids and gids build-public.js reads, moved server-side: the
   page stops carrying them, so view-source stops being a way in. */
var REPORTS_BOOK = '15eD6XtMVN1BRm41cD9wm33QMwW16R5sS';
var THUMBS_BOOK  = '1F1zDeTnSrfZ7j7bIu7FfiHRW0eoXu3_n4NjFAmnWBfE';
var GIDS = { reports: 378921450, series: 610219740, skus: 1440505952, thumbs: 524451717 };

var TOKEN_DAYS = 14;     /* a link stops working after this long */
var FROM_NAME  = 'FACERINNA Regulatory Affairs';

/* Who is told when somebody asks. Nobody watches a spreadsheet at a booth, so
   without this a request can sit unseen all day. Leave it empty and the mail
   goes to whoever owns the script; set an address to send it elsewhere, or set
   it to '-' to switch the notice off entirely. */
var NOTIFY_TO = '';

var REQ_HEADERS = ['asked', 'name', 'email', 'organisation', 'status',
                   'token', 'expires', 'link sent', 'note'];

/* status column values, and what each one means:
     (blank) / pending   asked, not decided        -> no access
     approved            let in                    -> token issued, link mailed
     anything else       refused, or revoked later -> access dies immediately  */

/* ------------------------------------------------------------------- setup */

function setUp() {
  var sh = reqTab_();
  if (sh.getLastRow() === 0) {
    sh.appendRow(REQ_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, REQ_HEADERS.length).setFontWeight('bold');
    sh.setColumnWidth(1, 150);
    sh.setColumnWidth(3, 220);
    sh.hideColumns(6);                    /* the token: a key, not a thing to read */
  }
  var quota = MailApp.getRemainingDailyQuota();
  return 'Ready. Tab "' + REQ_TAB + '" has ' + Math.max(0, sh.getLastRow() - 1) +
         ' request(s). Mail quota left today: ' + quota + '.';
}

function reqTab_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  return ss.getSheetByName(REQ_TAB) || ss.insertSheet(REQ_TAB);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

/* --------------------------------------------------------------- requests */

/* Body: {action:'request', name, email, organisation, consent:true}
 * Back: {ok:true, already:false}
 *
 * An address that has already asked does not get a second row. Otherwise a
 * visitor tapping the button twice leaves you two rows to decide about, and
 * approving one while the other says pending is a state nobody can read.
 */
function requestAccess_(b) {
  var name  = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  var email = String(b.email || '').trim().toLowerCase().slice(0, 120);
  var org   = String(b.organisation || '').trim().replace(/\s+/g, ' ').slice(0, 120);

  if (!name) return json_({ ok: false, error: 'Please give your name.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json_({ ok: false, error: 'That does not look like an email address.' });
  if (b.consent !== true)
    return json_({ ok: false, error: 'Please agree to the note about your details.' });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = reqTab_();
    var found = findRow_(sh, email);
    if (found) return json_({ ok: true, already: true, status: found.status });
    sh.appendRow([new Date(), name, email, org, 'pending', '', '', '', '']);
  } finally {
    lock.releaseLock();
  }

  /* After the row is safely written, and never in a way that can undo it: a
     mail server having a bad minute must not turn a visitor's accepted
     request into an error on their screen. The row is the record; the notice
     is a convenience. */
  notifyNewRequest_(name, email, org);

  return json_({ ok: true, already: false });
}

/* Tells you a request has come in, so you do not have to keep the workbook
   open. Silent on failure by design -- see the call site. */
function notifyNewRequest_(name, email, org) {
  try {
    if (NOTIFY_TO === '-') return;
    var to = NOTIFY_TO || Session.getEffectiveUser().getEmail();
    if (!to) return;
    MailApp.sendEmail({
      to: to,
      name: FROM_NAME,
      subject: 'Vault access requested: ' + name,
      htmlBody:
        '<p><b>' + esc_(name) + '</b> asked to read the FACERINNA test reports.</p>' +
        '<p>' + esc_(email) + (org ? '<br>' + esc_(org) : '') + '</p>' +
        '<p>To let them in, set that row\'s <b>status</b> to <b>approved</b> in the ' +
        '"' + esc_(REQ_TAB) + '" tab. The link is mailed to them on its own.</p>' +
        '<p><a href="https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit">' +
        'Open the request list</a></p>'
    });
  } catch (e) {
    Logger.log('notify failed: ' + (e && e.message || e));
  }
}

function findRow_(sh, email) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var v = sh.getRange(2, 1, last - 1, REQ_HEADERS.length).getValues();
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][2]).trim().toLowerCase() === email) {
      return { row: i + 2, name: v[i][1], email: email,
               status: String(v[i][4] || '').trim().toLowerCase(),
               token: String(v[i][5] || '').trim(),
               expires: v[i][6] ? new Date(v[i][6]).getTime() : 0,
               sent: v[i][7] };
    }
  }
  return null;
}

/* -------------------------------------------------------------- approvals */

/* Sends a link to every row that is approved and has no token yet. Run it by
 * hand from the editor if you like, but installTriggers() below means you do
 * not have to: it fires on the edit that approves a row, and again every five
 * minutes as a net. Safe to run at any moment, from anywhere, as often as you
 * like -- an already-tokened row is never touched twice.
 */
function sendApprovals() {
  /* Two callers can now land at the same moment: the edit trigger and the
     timer. Without the lock both would see the same tokenless row and both
     would mail a link -- two keys to a door meant to have one. tryLock, not
     waitLock: if another run holds it, that run is already doing this. */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return 'Another run is already sending.';
  try {
    return sendApprovals_();
  } finally {
    lock.releaseLock();
  }
}

function sendApprovals_() {
  var sh = reqTab_();
  var last = sh.getLastRow();
  if (last < 2) return 'No requests yet.';

  var v = sh.getRange(2, 1, last - 1, REQ_HEADERS.length).getValues();
  var sent = 0, skipped = 0, failed = [];

  for (var i = 0; i < v.length; i++) {
    var status = String(v[i][4] || '').trim().toLowerCase();
    var token  = String(v[i][5] || '').trim();
    if (status !== 'approved' || token) { skipped++; continue; }

    var email = String(v[i][2]).trim();
    var name  = String(v[i][1]).trim();
    var tok   = Utilities.getUuid();
    var exp   = new Date(Date.now() + TOKEN_DAYS * 86400000);
    var link  = VAULT_URL + '#vault=' + encodeURIComponent(tok);

    try {
      MailApp.sendEmail({
        to: email,
        name: FROM_NAME,
        subject: 'Your access to the FACERINNA test report vault',
        htmlBody:
          '<p>Hello ' + esc_(name) + ',</p>' +
          '<p>Your request to read the FACERINNA test reports and claims has been ' +
          'approved. Open this link on the device you want to read them on:</p>' +
          '<p><a href="' + link + '">Open the vault</a></p>' +
          '<p style="color:#667;font-size:13px">The link is yours alone and stops ' +
          'working on ' + Utilities.formatDate(exp, Session.getScriptTimeZone(), 'd MMMM yyyy') +
          '. Please do not forward it — access is granted per person and can be ' +
          'withdrawn.</p>' +
          '<p style="color:#667;font-size:13px">FACERINNA Regulatory Affairs</p>'
      });
      /* Written only after the mail is away. Crash before this and the row is
         still tokenless, so the next run tries again rather than leaving
         somebody approved on paper and never told. */
      sh.getRange(i + 2, 6).setValue(tok);
      sh.getRange(i + 2, 7).setValue(exp);
      sh.getRange(i + 2, 8).setValue(new Date());
      sent++;
    } catch (e) {
      failed.push(email + ' (' + (e && e.message || e) + ')');
    }
  }

  var msg = 'Sent ' + sent + ', skipped ' + skipped +
            '. Mail quota left: ' + MailApp.getRemainingDailyQuota() + '.';
  if (failed.length) msg += ' FAILED: ' + failed.join('; ');
  return msg;
}

var esc_ = function (s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};

/* ------------------------------------------------------------ the reports */

/* Body: {action:'data', token}
 * Back: {ok:true, reports:[...], series:[...], skus:[...], thumbs:[...]}
 *       {ok:false, reason:'unknown'|'pending'|'revoked'|'expired'}
 *
 * The reasons are separate on purpose. "Your request is still with us" and
 * "that link has expired" send a person to different places, and a single
 * "denied" sends them to neither.
 */
function vaultData_(b) {
  var token = String(b.token || '').trim();
  if (!token) return json_({ ok: false, reason: 'unknown' });

  var sh = reqTab_();
  var last = sh.getLastRow();
  if (last < 2) return json_({ ok: false, reason: 'unknown' });

  var v = sh.getRange(2, 1, last - 1, REQ_HEADERS.length).getValues();
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][5] || '').trim() !== token) continue;

    var status = String(v[i][4] || '').trim().toLowerCase();
    if (status !== 'approved') return json_({ ok: false, reason: 'revoked' });

    var exp = v[i][6] ? new Date(v[i][6]).getTime() : 0;
    if (exp && Date.now() > exp) return json_({ ok: false, reason: 'expired' });

    var d = readVault_();
    d.ok = true;
    d.who = String(v[i][1] || '');
    return json_(d);
  }
  return json_({ ok: false, reason: 'unknown' });
}

/* Where a visitor checks on a request that has not been decided yet, without
   needing a token they do not have. Says only whether it is pending, which is
   what they asked and nothing more. */
function checkStatus_(b) {
  var email = String(b.email || '').trim().toLowerCase();
  if (!email) return json_({ ok: false, reason: 'unknown' });
  var found = findRow_(reqTab_(), email);
  if (!found) return json_({ ok: true, status: 'none' });
  if (found.status === 'approved')
    return json_({ ok: true, status: found.token ? 'approved' : 'approving' });
  return json_({ ok: true, status: found.status === 'pending' ? 'pending' : 'refused' });
}

/* ---------------------------------------------------- reading the workbooks

   These mirror build-public.js exactly — same header hunt, same column order,
   same `none` -> empty rule. If the two ever disagree the page shows one thing
   before the lock and another after it, which reads as data loss.

   getDisplayValues, not getValues: the CSV export the build reads gives
   strings, and getValues would hand back Dates and numbers that stringify
   differently. Same grid, same text.                                        */

function tabByGid_(book, gid) {
  var sheets = SpreadsheetApp.openById(book).getSheets();
  for (var i = 0; i < sheets.length; i++)
    if (sheets[i].getSheetId() === gid) return sheets[i];
  throw new Error('no tab with gid ' + gid + ' in ' + book);
}

function grid_(book, gid) {
  var sh = tabByGid_(book, gid);
  return sh.getLastRow() ? sh.getDataRange().getDisplayValues() : [];
}

var clean_ = function (v) {
  var t = (v == null ? '' : String(v)).trim();
  return t.toLowerCase() === 'none' ? '' : t;
};
var num_ = function (v) { var n = parseFloat(v); return isFinite(n) ? n : 0; };

/* Rows after the one whose first cell is "No.", keeping only those that start
   with a number — the sheets carry notes and spacer rows below the data. */
function bodyRows_(rows) {
  var h = -1;
  for (var i = 0; i < rows.length; i++)
    if (String(rows[i][0] || '').trim() === 'No.') { h = i; break; }
  if (h === -1) throw new Error('header row "No." not found');
  return rows.slice(h + 1).filter(function (r) {
    return /^\d+(\.\d+)?$/.test(String(r[0] || '').trim());
  });
}

function readVault_() {
  var rep = bodyRows_(grid_(REPORTS_BOOK, GIDS.reports)).map(function (r) {
    return { no: num_(r[0]), code: clean_(r[1]), sku: clean_(r[2]), reportNo: clean_(r[3]),
             lab: clean_(r[4]), date: clean_(r[5]), subject: clean_(r[6]), param: clean_(r[7]),
             claimsInstrument: clean_(r[8]), claimsPanel: clean_(r[9]), claimsOther: clean_(r[10]),
             genericClaims: clean_(r[11]), disclaimer: clean_(r[12]) };
  });
  var ser = bodyRows_(grid_(REPORTS_BOOK, GIDS.series)).map(function (r) {
    return { no: num_(r[0]), series: clean_(r[1]), skus: clean_(r[2]),
             genericClaims: clean_(r[3]), disclaimer: clean_(r[4]) };
  });
  var sku = bodyRows_(grid_(REPORTS_BOOK, GIDS.skus)).map(function (r) {
    return { no: num_(r[0]), code: clean_(r[1]), sku: clean_(r[2]), series: clean_(r[3]),
             aliases: clean_(r[4]), reportCount: num_(r[5]) };
  });
  return { reports: rep, series: ser, skus: sku, thumbs: readThumbs_() };
}

/* Pack-shot addresses only. The same tab also carries Test Report URL and
   Claims URL, pointing at internal Drive and Canva documents; those are not
   read here and must never be. */
function readThumbs_() {
  var rows = grid_(THUMBS_BOOK, GIDS.thumbs);
  var hi = -1;
  for (var i = 0; i < rows.length; i++) {
    for (var j = 0; j < rows[i].length; j++) {
      if (String(rows[i][j] || '').trim() === 'Image URL') { hi = i; break; }
    }
    if (hi !== -1) break;
  }
  if (hi === -1) throw new Error('"Image URL" header not found');

  var ix = {};
  rows[hi].forEach(function (h, i) { ix[String(h || '').trim()] = i; });

  var out = [];
  rows.slice(hi + 1).forEach(function (r) {
    var name = String(r[ix['Product Name']] || '').trim();
    if (!name) return;
    var u = String(r[ix['Image URL']] || '').trim();
    var m = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
    out.push({ name: name,
               code: String(r[ix['SKU Code']] || '').trim(),
               img: m ? 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w800' : u,
               reportUrl: '', claimsUrl: '' });
  });
  return out;
}

/* ------------------------------------------------------------- the web app */

function doPost(e) {
  try {
    var b = {};
    try { b = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
    catch (bad) { return json_({ ok: false, error: 'bad json' }); }

    switch (String(b.action || '')) {
      case 'request': return requestAccess_(b);
      case 'data':    return vaultData_(b);
      case 'status':  return checkStatus_(b);
      default:        return json_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* Nothing readable without a token, so a GET only ever says the script is
   alive. Handy for checking a deployment from the address bar without having
   to run anything. */
function doGet() {
  return json_({ ok: true, service: 'facerinna vault access', at: Date.now() });
}

/* ------------------------------------------------------------ maintenance */

/* What the request list looks like, printed in the editor. */
function preview() {
  var sh = reqTab_(), last = sh.getLastRow();
  if (last < 2) return 'No requests yet.';
  var v = sh.getRange(2, 1, last - 1, REQ_HEADERS.length).getValues();
  var out = v.map(function (r) {
    return [String(r[4] || 'pending').toUpperCase().padEnd(9),
            String(r[2]), String(r[1]),
            r[5] ? 'link sent' : ''].join('  ');
  });
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/* Reads the workbooks and reports what came back, without needing a token.
   Run this after setUp: if it cannot see the reports, nothing else will. */
function checkWorkbooks() {
  var d = readVault_();
  var msg = 'reports ' + d.reports.length + ', series ' + d.series.length +
            ', skus ' + d.skus.length + ', thumbs ' + d.thumbs.length;
  Logger.log(msg);
  return msg;
}

/* ------------------------------------------------------------- triggers */

/* Run this ONCE, from the editor. After it, approving somebody is a single
   cell edit in the workbook and nothing else: no editor, no Run button.
 *
 * Two triggers, on purpose:
 *
 *   the edit trigger   fires the moment a status cell becomes "approved",
 *                      so the link goes out in seconds while the person is
 *                      still standing at the booth.
 *   the five-minute    a net under it. An edit trigger does not fire for
 *   timer              every way a cell can change -- a paste over a block,
 *                      a fill-down, an edit made from the mobile app or
 *                      while offline and synced later. Any of those would
 *                      leave somebody approved and never told. The timer
 *                      catches them, at the cost of a few minutes.
 *
 * Both call the same locked sendApprovals, so the overlap is harmless.
 *
 * These must be INSTALLABLE triggers. A simple onEdit(e) runs without
 * authorisation and cannot send mail at all, which would look like the
 * feature silently not working.
 */
function installTriggers() {
  removeTriggers();
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(SHEET_ID).onEdit().create();
  ScriptApp.newTrigger('sendApprovals').timeBased().everyMinutes(5).create();
  return 'Installed. Set a status cell to "approved" and the link goes out by itself.';
}

/* Re-running installTriggers must not leave two of each: triggers stack
   silently, and four copies means four runs racing for the same row. */
function removeTriggers() {
  var all = ScriptApp.getProjectTriggers(), n = 0;
  for (var i = 0; i < all.length; i++) {
    var fn = all[i].getHandlerFunction();
    if (fn === 'onSheetEdit' || fn === 'sendApprovals') {
      ScriptApp.deleteTrigger(all[i]);
      n++;
    }
  }
  return 'Removed ' + n + ' trigger(s).';
}

/* Fires on every edit anywhere in the workbook, the Scores tab included, so
   it has to be narrow: the request tab, the status column, and a value that
   actually says approved. Anything else returns without touching a thing. */
function onSheetEdit(e) {
  try {
    if (!e || !e.range) return;
    if (e.range.getSheet().getName() !== REQ_TAB) return;
    if (e.range.getColumn() !== 5) return;                   /* status */
    if (e.range.getRow() < 2) return;                        /* the header */
    if (String(e.value || '').trim().toLowerCase() !== 'approved') return;
    sendApprovals();
  } catch (err) {
    Logger.log('onSheetEdit: ' + (err && err.message || err));
  }
}
