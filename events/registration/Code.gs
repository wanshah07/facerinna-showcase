/**
 * FACERINNA — event registration tickets
 * ======================================
 * Bound to the Google Sheet that collects a Google Form's responses. On each
 * submission it issues a ticket code, draws a QR for it, and emails the
 * registrant. Scanning that QR at the door marks them present.
 *
 * WHAT LEAVES GOOGLE
 * The QR image is drawn by quickchart.io, and the ONLY thing sent there is the
 * opaque ticket code (FCR-7K2M-9XQ4). No name, phone or email is ever sent to
 * it. If you would rather nothing at all left Google, set QR_PROVIDER to
 * "none" and the email goes out with the code in text; the door can type it
 * into the check-in sheet instead of scanning.
 *
 * QUOTA
 * A free gmail.com account sends 100 emails a day; a Workspace account sends
 * 1500. Check MailApp.getRemainingDailyQuota() if you expect a rush.
 *
 * SET UP: see README.md next to this file.
 */

// ---------------------------------------------------------------- settings

var CONFIG = {
  /* Shown as the sender name. The address is whichever account owns this
     script -- Apps Script cannot send as somebody else without a Workspace
     delegation, so install this under the mailbox you want on the ticket. */
  FROM_NAME: 'Facerinna Events',

  /* Answered by the reply-to on the ticket. Leave blank to use the owner. */
  REPLY_TO: '',

  SUBJECT: 'Your ticket — {{event}}',

  /* Column headers in the response sheet. Left side is what this script
     needs; right side is the exact question text from your form. Change the
     right side to match your form, not the left. */
  FIELDS: {
    name:  'Name',
    email: 'Email',
    phone: 'Phone',
    event: 'Which event are you attending?'
  },

  /* Only used when the page posts directly (doPost). A sheet created for that
     needs these exact headers in row 1; setup() writes them if the sheet is
     empty. */

  /* Columns this script writes back. They are created if missing. */
  OUT: {
    ticket:   'Ticket code',
    sentAt:   'Ticket sent',
    checkedIn:'Checked in'
  },

  /* How long before a repeat registration will re-send the ticket. Short
     enough to help somebody who did not get theirs, long enough that the
     public endpoint cannot be used to flood an inbox. */
  RESEND_COOLDOWN_MIN: 10,

  QR_PROVIDER: 'quickchart',   // 'quickchart' | 'none'
  QR_SIZE: 320,

  /* Prefix on every code, so a scanned string is obviously ours. */
  CODE_PREFIX: 'FCR'
};

// ------------------------------------------------------------------ set up

/**
 * Run once, by hand, from the Apps Script editor. Installs the trigger and
 * adds the output columns. Safe to run again: it removes its own duplicate
 * triggers first, so a second run does not double-send every ticket.
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets()[0];

  /* An empty sheet means this is the web-app setup, not a form's response
     sheet, so lay out the columns the page will post into. */
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 5).setValues([[
      'Timestamp', CONFIG.FIELDS.name, CONFIG.FIELDS.email,
      CONFIG.FIELDS.phone, CONFIG.FIELDS.event
    ]]);
    sheet.setFrozenRows(1);
  }

  /* A phone number is a label, not a quantity. Left alone, Sheets reads
     "0185708401" as the number 185708401 and the leading zero is gone for
     good -- you cannot ring the person back. Pinning the column to plain text
     stops the conversion for every row that follows. Timestamps get an
     explicit format too, so "Ticket sent" shows the time rather than only the
     date it happened to fall on. */
  var head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var colOf = function (h) { return head.indexOf(h) + 1; };
  var rows = Math.max(1, sheet.getMaxRows() - 1);
  var phoneAt = colOf(CONFIG.FIELDS.phone);
  if (phoneAt > 0) sheet.getRange(2, phoneAt, rows, 1).setNumberFormat('@');
  ['Timestamp', CONFIG.OUT.sentAt, CONFIG.OUT.checkedIn].forEach(function (h) {
    var c = colOf(h);
    if (c > 0) sheet.getRange(2, c, rows, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  });

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onFormSubmitHandler') ScriptApp.deleteTrigger(t);
  });
  /* Only useful when a Google Form feeds this sheet. Harmless otherwise: it
     simply never fires when the page posts through doPost instead. */
  try {
    ScriptApp.newTrigger('onFormSubmitHandler').forSpreadsheet(ss).onFormSubmit().create();
  } catch (err) {
    console.warn('No form attached; doPost is the way in. ' + err);
  }

  var headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
                     .getValues()[0].map(String);
  Object.keys(CONFIG.OUT).forEach(function (k) {
    if (headers.indexOf(CONFIG.OUT[k]) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(CONFIG.OUT[k]);
      headers.push(CONFIG.OUT[k]);
    }
  });

  var missing = [];
  Object.keys(CONFIG.FIELDS).forEach(function (k) {
    if (headers.indexOf(CONFIG.FIELDS[k]) === -1) missing.push(CONFIG.FIELDS[k]);
  });

  /* Reading the formats back turns "did setup run?" into something this
     alert answers. Pasting without saving, or an error partway, both leave
     the editor looking correct while nothing was applied -- and the only
     symptom is a phone number quietly losing its leading zero weeks later. */
  var checks = [];
  var phoneNow = phoneAt > 0
    ? sheet.getRange(2, phoneAt).getNumberFormat() : null;
  checks.push('Phone column format: ' +
    (phoneNow === '@' ? 'TEXT  (correct)' : String(phoneNow) + '  <-- NOT TEXT'));
  var sentAt = colOf(CONFIG.OUT.sentAt);
  if (sentAt > 0) {
    var f = sheet.getRange(2, sentAt).getNumberFormat();
    checks.push('Ticket sent format: ' + f +
      (f.indexOf('hh') > -1 ? '  (correct)' : '  <-- no time shown'));
  }

  var msg = 'Trigger installed. Output columns ready.\n\n' + checks.join('\n');
  if (missing.length) {
    /* Loud on purpose. A mismatched header is the failure that looks like
       nothing is wrong until the first ticket goes out addressed to nobody. */
    msg += '\n\nNOT FOUND in this sheet: ' + missing.join(', ') +
           '\nEdit CONFIG.FIELDS so the right-hand side matches your form ' +
           'questions exactly, then run setup() again.';
  }
  SpreadsheetApp.getUi().alert(msg);
}

// ---------------------------------------------------------------- the work

function onFormSubmitHandler(e) {
  var lock = LockService.getScriptLock();
  /* Two submissions landing together would otherwise both read the same last
     row and one ticket would overwrite the other. */
  try { lock.waitLock(30000); } catch (err) { return; }

  try {
    var sheet = e.range.getSheet();
    var row = e.range.getRow();
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];

    var col = function (header) {
      var i = headers.indexOf(header);
      return i === -1 ? null : i;
    };
    var get = function (key) {
      var i = col(CONFIG.FIELDS[key]);
      return i === null ? '' : String(values[i] || '').trim();
    };

    var ticketCol = col(CONFIG.OUT.ticket);
    var sentCol   = col(CONFIG.OUT.sentAt);
    if (ticketCol === null || sentCol === null) {
      throw new Error('Output columns missing. Run setup() first.');
    }

    /* Already handled. A re-run of the trigger, or a manual replay, must not
       send a second ticket to someone who has one. */
    if (String(values[sentCol] || '').trim()) return;

    var email = get('email');
    if (!isEmail(email)) {
      sheet.getRange(row, sentCol + 1).setValue('NOT SENT: no valid email');
      return;
    }

    var code = String(values[ticketCol] || '').trim() || makeCode();
    sheet.getRange(row, ticketCol + 1).setValue(code);

    var pCol = col(CONFIG.FIELDS.phone);
    if (pCol !== null) {
      var raw = String(values[pCol] == null ? '' : values[pCol]);
      sheet.getRange(row, pCol + 1).setNumberFormat('@').setValue(raw);
    }

    sendTicket({
      to:    email,
      name:  get('name') || 'there',
      event: get('event') || 'Facerinna event',
      code:  code
    });

    sheet.getRange(row, sentCol + 1).setValue(new Date());
  } catch (err) {
    /* Never swallow it. A ticket that silently fails to send is a person
       turned away at the door. */
    console.error(err);
    try {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
        'Facerinna ticket script failed',
        'Row ' + (e && e.range ? e.range.getRow() : '?') + '\n\n' + err.stack);
    } catch (ignored) {}
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function sendTicket(t) {
  var qr = null;
  if (CONFIG.QR_PROVIDER === 'quickchart') {
    qr = fetchQr(t.code);
  }

  var subject = CONFIG.SUBJECT.replace('{{event}}', t.event);
  var html = ticketHtml(t, !!qr);

  var options = {
    name: CONFIG.FROM_NAME,
    htmlBody: html
  };
  if (CONFIG.REPLY_TO) options.replyTo = CONFIG.REPLY_TO;
  if (qr) options.inlineImages = { ticketqr: qr };

  MailApp.sendEmail(t.to, subject, plainText(t), options);
}

/**
 * Only the ticket code is sent to the QR service. Returns null rather than
 * throwing: a QR service having a bad day must not stop the ticket, because
 * the code in the email body is enough to check someone in.
 */
function fetchQr(code) {
  try {
    var url = 'https://quickchart.io/qr'
            + '?text=' + encodeURIComponent(code)
            + '&size=' + CONFIG.QR_SIZE
            + '&margin=2&ecLevel=M&format=png';
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    return res.getBlob().setName('ticket.png');
  } catch (err) {
    console.warn('QR unavailable: ' + err);
    return null;
  }
}

function ticketHtml(t, hasQr) {
  var qrBlock = hasQr
    ? '<img src="cid:ticketqr" alt="Ticket QR code" width="200" height="200" ' +
      'style="display:block;margin:0 auto 14px">'
    : '';
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;',
    'max-width:520px;margin:0 auto;color:#1D344E;line-height:1.6">',
      '<p style="font-size:1.05rem;margin:0 0 4px">Hi ', escapeHtml(t.name), ',</p>',
      '<p style="margin:0 0 22px">You are registered for <b>', escapeHtml(t.event), '</b>. ',
      'Show this at the door.</p>',
      '<div style="border:1px solid #D9E5F1;border-radius:14px;padding:22px;text-align:center;',
      'background:#F7FAFD">',
        qrBlock,
        '<div style="font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;',
        'color:#8299AD">Ticket code</div>',
        '<div style="font-size:1.5rem;font-weight:700;letter-spacing:.06em;margin-top:4px">',
        escapeHtml(t.code), '</div>',
      '</div>',
      '<p style="margin:22px 0 0;font-size:.86rem;color:#52697F">',
      'Cannot see the code? Reply to this email and we will look you up by name.</p>',
      '<p style="margin:18px 0 0;font-size:.76rem;color:#8299AD">',
      'Facerinna &middot; sent because you registered for this event.</p>',
    '</div>'
  ].join('');
}

function plainText(t) {
  return 'Hi ' + t.name + ',\n\n' +
         'You are registered for ' + t.event + '.\n\n' +
         'Ticket code: ' + t.code + '\n\n' +
         'Show this at the door.\n\nFacerinna';
}

// ------------------------------------------------- the web app endpoint

/**
 * The events page posts here. Deploy: Deploy > New deployment > Web app,
 * "Execute as: Me", "Who has access: Anyone". Paste the /exec URL into
 * REGISTER_ENDPOINT in events/index.html.
 *
 * "Anyone" means anyone: this URL is in the page source, so treat it as
 * public. It only ever appends a row and sends one email, it returns nothing
 * about anybody else, and the guards below cap what a flood can cost.
 */
function doPost(e) {
  var email = '', event = '';
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    var name  = String(body.name  || '').trim();
    email     = String(body.email || '').trim();
    var phone = String(body.phone || '').trim();
    event     = String(body.event || '').trim();

    /* Every attempt is logged, not just the ones that succeed. A rejected
       submission used to return an error to the browser and leave no trace
       anywhere, so "somebody says they registered and there is no row" had no
       answer. Now there is one. */
    if (!name || name.length > 120)      return logged('REJECTED', email, event, 'bad name');
    if (!isEmail(email))                 return logged('REJECTED', email, event, 'bad email');
    if (phone.replace(/\D/g, '').length < 9) return logged('REJECTED', email, event, 'bad phone');
    if (body.consent !== true)           return logged('REJECTED', email, event, 'consent not ticked');

    /* Client-side validation is a courtesy to the visitor, not a control:
       anyone can post here directly. Everything above is checked again. */

    var lock = LockService.getScriptLock();
    try { lock.waitLock(30000); } catch (err) {
      return logged('REJECTED', email, event, 'busy, could not get the lock');
    }

    try {
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
      var at = function (h) { return headers.indexOf(h); };

      if (at(CONFIG.OUT.ticket) === -1) {
        return logged('REJECTED', email, event, 'sheet not set up, run setup()');
      }

      /* The same person tapping Complete twice, or a double submit, must not
         produce two tickets. Match on email plus event. */
      var last = sheet.getLastRow();
      if (last > 1) {
        var emailCol = at(CONFIG.FIELDS.email), eventCol = at(CONFIG.FIELDS.event);
        var rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
        for (var i = 0; i < rows.length; i++) {
          if (emailCol > -1 &&
              String(rows[i][emailCol] || '').trim().toLowerCase() === email.toLowerCase() &&
              (eventCol === -1 || String(rows[i][eventCol] || '').trim() === event)) {
            var existing = String(rows[i][at(CONFIG.OUT.ticket)] || '');
            var sentCol2 = at(CONFIG.OUT.sentAt);
            var lastSent = sentCol2 > -1 ? rows[i][sentCol2] : '';

            /* Somebody registering a second time for the same event is almost
               always saying "my ticket never arrived". Returning the code
               silently and sending nothing answered the wrong question: they
               asked for an email. So send it again.

               Rate-limited to once every RESEND_COOLDOWN_MIN, because this
               endpoint is public and without a limit anyone could use it to
               post the same address repeatedly and fill a stranger's inbox.
               Under the limit they still get the code on screen. */
            var mins = (lastSent instanceof Date)
              ? (Date.now() - lastSent.getTime()) / 60000 : 1e9;

            if (mins >= CONFIG.RESEND_COOLDOWN_MIN) {
              try {
                sendTicket({ to: email,
                             name: String(rows[i][at(CONFIG.FIELDS.name)] || 'there'),
                             event: event || 'Facerinna event', code: existing });
                if (sentCol2 > -1) {
                  sheet.getRange(i + 2, sentCol2 + 1).setValue(new Date());
                }
                logRow('DUPLICATE-RESENT', email, event, 'sent ' + existing + ' again');
                return reply({ ok: true, code: existing, duplicate: true, resent: true });
              } catch (mailErr) {
                console.error(mailErr);
                logRow('DUPLICATE', email, event,
                       'resend failed: ' + mailErr + ' (code ' + existing + ')');
                return reply({ ok: true, code: existing, duplicate: true, resent: false });
              }
            }

            logRow('DUPLICATE', email, event,
                   'already had ' + existing + ', resent ' + Math.round(mins) +
                   ' min ago so not sending again');
            return reply({ ok: true, code: existing, duplicate: true, resent: false });
          }
        }
      }

      var code = makeCode();
      var row = new Array(headers.length).fill('');
      var put = function (header, value) { var c = at(header); if (c > -1) row[c] = value; };
      put('Timestamp', new Date());
      put(CONFIG.FIELDS.name,  name);
      put(CONFIG.FIELDS.email, email);
      put(CONFIG.FIELDS.phone, phone);
      put(CONFIG.FIELDS.event, event);
      put(CONFIG.OUT.ticket,   code);
      /* NOT appendRow. It writes below getLastRow(), which is the last row
         used ANYWHERE on the sheet -- a note somebody types in row 500, or a
         stray value left by a check, and the next registration lands at 501
         with 498 blank rows above it. The registrations are what define the
         end of the data, so the first free row is found from the Timestamp
         column alone. */
      var written = firstFreeRow(sheet, at('Timestamp'));
      sheet.getRange(written, 1, 1, row.length).setValues([row]);

      /* Belt as well as braces. The column format above covers rows added
         later, but a sheet set up before that change, or a column somebody
         reformatted, would still swallow the leading zero. Writing the cell
         as text here does not depend on either. */
      var phoneCol = at(CONFIG.FIELDS.phone);
      if (phoneCol > -1) {
        sheet.getRange(written, phoneCol + 1).setNumberFormat('@').setValue(phone);
      }

      /* The ticket code goes back either way. If the email fails the visitor
         still has something to show at the door, and the sheet records that
         the email did not go. */
      try {
        sendTicket({ to: email, name: name, event: event || 'Facerinna event', code: code });
        var sentCol = at(CONFIG.OUT.sentAt);
        if (sentCol > -1) sheet.getRange(written, sentCol + 1).setValue(new Date());
      } catch (mailErr) {
        console.error(mailErr);
        var sc = at(CONFIG.OUT.sentAt);
        if (sc > -1) sheet.getRange(written, sc + 1).setValue('EMAIL FAILED: ' + mailErr);
      }

      logRow('OK', email, event, 'row ' + written + ', ' + code);
      return reply({ ok: true, code: code });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    console.error(err);
    return logged('ERROR', email, event, String(err && err.message ? err.message : err));
  }
}

/**
 * One line per attempt on a Log tab, created on first use. Kept to the last
 * 2000 lines so it cannot grow without bound on a sheet nobody prunes.
 * Never throws: a logging failure must not swallow a registration.
 */
function logRow(outcome, email, event, note) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var log = ss.getSheetByName('Log');
    if (!log) {
      log = ss.insertSheet('Log');
      log.getRange(1, 1, 1, 5)
         .setValues([['When', 'Outcome', 'Email', 'Event', 'Note']]);
      log.setFrozenRows(1);
    }
    log.appendRow([new Date(), outcome, email, event, note]);
    var n = log.getLastRow();
    if (n > 2001) log.deleteRows(2, n - 2001);
  } catch (err) {
    console.error('log failed: ' + err);
  }
}

/** Log it and reply in one move, so no path can log without replying. */
function logged(outcome, email, event, note) {
  logRow(outcome, email, event, note);
  return reply({ ok: false, error: note });
}

/**
 * Apps Script cannot answer a CORS preflight, so the page posts with the
 * default content type to keep the request "simple". JSON out is fine.
 */
function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** So opening the /exec URL in a browser says something useful. */
function doGet() {
  return reply({ ok: true, service: 'Facerinna event registration' });
}

// ------------------------------------------------------------- check-in

/**
 * Call with a scanned code to mark someone present. Returns a short result
 * you can show on the scanning device.
 *
 * Deliberately refuses a second check-in rather than silently allowing it:
 * a code being presented twice is the thing the door needs to know about.
 */
function checkIn(code) {
  code = String(code || '').trim().toUpperCase();
  if (!code) return { ok: false, message: 'No code' };

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var ticketCol = headers.indexOf(CONFIG.OUT.ticket);
  var inCol     = headers.indexOf(CONFIG.OUT.checkedIn);
  var nameCol   = headers.indexOf(CONFIG.FIELDS.name);
  if (ticketCol === -1 || inCol === -1) return { ok: false, message: 'Run setup() first' };

  var last = sheet.getLastRow();
  if (last < 2) return { ok: false, message: 'No registrations yet' };

  var rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][ticketCol] || '').trim().toUpperCase() !== code) continue;
    var who = nameCol === -1 ? '' : String(rows[i][nameCol] || '');
    if (String(rows[i][inCol] || '').trim()) {
      return { ok: false, message: 'Already checked in', name: who, at: rows[i][inCol] };
    }
    sheet.getRange(i + 2, inCol + 1).setValue(new Date());
    return { ok: true, message: 'Welcome', name: who };
  }
  return { ok: false, message: 'Code not found' };
}

// ------------------------------------------------------------------ bits

/**
 * Two groups of four from an alphabet with no O/0 or I/1, because these get
 * read aloud and typed in by hand at a busy door.
 */
function makeCode() {
  var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var out = '';
  for (var i = 0; i < 8; i++) {
    if (i === 4) out += '-';
    out += abc.charAt(Math.floor(Math.random() * abc.length));
  }
  return CONFIG.CODE_PREFIX + '-' + out;
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
}

function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The row after the last filled cell in one column, ignoring anything else on
 * the sheet. Reads the column in one call rather than probing row by row.
 */
function firstFreeRow(sheet, colIndex) {
  if (colIndex < 0) return sheet.getLastRow() + 1;   /* no Timestamp column */
  var max = sheet.getMaxRows();
  if (max < 2) return 2;
  var col = sheet.getRange(2, colIndex + 1, max - 1, 1).getValues();
  for (var i = col.length - 1; i >= 0; i--) {
    if (String(col[i][0]).trim() !== '') return i + 3;   /* +2 offset, +1 next */
  }
  return 2;
}

/**
 * Moves registrations back up when something below them has scattered the
 * rows. Reads every row that has a ticket code, in order, and rewrites them
 * from row 2 with no gaps. Anything without a ticket code is left where it is
 * and reported, because this must never quietly delete something it does not
 * recognise.
 */
function compactRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var codeCol = head.indexOf(CONFIG.OUT.ticket);
  if (codeCol === -1) return 'No ticket column. Run setup() first.';

  var last = sheet.getLastRow();
  if (last < 2) return 'Nothing to compact.';

  var all = sheet.getRange(2, 1, last - 1, head.length).getValues();
  var keep = [], strays = [];
  for (var i = 0; i < all.length; i++) {
    var hasCode = String(all[i][codeCol] || '').trim() !== '';
    var hasAnything = all[i].some(function (v) { return String(v).trim() !== ''; });
    if (hasCode) keep.push(all[i]);
    else if (hasAnything) strays.push('row ' + (i + 2));
  }

  sheet.getRange(2, 1, last - 1, head.length).clearContent();
  if (keep.length) sheet.getRange(2, 1, keep.length, head.length).setValues(keep);

  return 'Compacted ' + keep.length + ' registration(s) to rows 2-' + (keep.length + 1) + '.' +
         (strays.length
           ? ' NOT moved, no ticket code, please check before deleting: ' + strays.join(', ')
           : '');
}

/**
 * Just the column formats, on their own. Run this if setup() reported the
 * phone column as anything other than TEXT, or if somebody reformatted the
 * column later. Returns what it found afterwards, so the result is evidence
 * rather than a claim.
 */
function fixFormats() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var rows = Math.max(1, sheet.getMaxRows() - 1);
  var out = [];

  var p = head.indexOf(CONFIG.FIELDS.phone) + 1;
  if (p > 0) {
    sheet.getRange(2, p, rows, 1).setNumberFormat('@');
    out.push('Phone -> ' + sheet.getRange(2, p).getNumberFormat());
  } else {
    out.push('Phone column NOT FOUND -- check CONFIG.FIELDS.phone against the header.');
  }

  ['Timestamp', CONFIG.OUT.sentAt, CONFIG.OUT.checkedIn].forEach(function (h) {
    var c = head.indexOf(h) + 1;
    if (c > 0) {
      sheet.getRange(2, c, rows, 1).setNumberFormat('yyyy-mm-dd hh:mm');
      out.push(h + ' -> ' + sheet.getRange(2, c).getNumberFormat());
    }
  });

  SpreadsheetApp.flush();
  var msg = out.join('\n');
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

/**
 * Run once if any phone was written before the column was pinned to text.
 * A Malaysian mobile stored as a number lost its leading zero, so this puts
 * it back: 9 or 10 digits starting 1 is a mobile missing its 0. Anything it
 * is not sure about it leaves alone and reports, rather than guessing.
 */
function repairPhones() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var c = head.indexOf(CONFIG.FIELDS.phone);
  if (c === -1) return 'No phone column.';
  var last = sheet.getLastRow();
  if (last < 2) return 'Nothing to repair.';

  var fixed = 0, left = [];
  var cells = sheet.getRange(2, c + 1, last - 1, 1);
  cells.setNumberFormat('@');
  var vals = cells.getValues();
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i][0];
    if (typeof v !== 'number') continue;
    var d = String(v);
    if (/^1\d{8,9}$/.test(d)) { vals[i][0] = '0' + d; fixed++; }   /* lost its 0 */
    else if (/^60\d{9,10}$/.test(d)) { vals[i][0] = '+' + d; fixed++; } /* lost its + */
    else { vals[i][0] = d; left.push('row ' + (i + 2) + ': ' + d); }
  }
  cells.setValues(vals);
  return 'Repaired ' + fixed + '.' +
         (left.length ? ' Left as-is, please check: ' + left.join('; ') : '');
}

/**
 * Answers "was the email actually sent?" without guessing.
 *
 * MailApp.sendEmail only throws when Google REFUSES the message -- a bad
 * address, an exhausted quota, a missing scope. It returns quietly when Google
 * accepts it, so a "Ticket sent" timestamp in the sheet means accepted, not
 * delivered, and certainly not read. Those are three different things and the
 * sheet can only ever know the first.
 *
 * The daily quota is the honest counter. It drops by one per recipient, so
 * running this before and after a registration says whether anything left.
 */
function mailCheck() {
  var lines = [];
  lines.push('Script runs as: ' + Session.getEffectiveUser().getEmail());
  lines.push('Emails left today: ' + MailApp.getRemainingDailyQuota());
  lines.push('');
  lines.push('That address is the SENDER. Tickets go to whatever address the');
  lines.push('visitor typed into the form, which is the Email column.');
  lines.push('');

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var eCol = head.indexOf(CONFIG.FIELDS.email);
  var sCol = head.indexOf(CONFIG.OUT.sentAt);
  var last = sheet.getLastRow();

  if (eCol > -1 && last > 1) {
    var rows = sheet.getRange(2, 1, last - 1, head.length).getValues();
    lines.push('Tickets were addressed to:');
    for (var i = 0; i < rows.length; i++) {
      var to = String(rows[i][eCol] || '').trim();
      if (!to) continue;
      var st = sCol > -1 ? String(rows[i][sCol] || '') : '(no column)';
      lines.push('  row ' + (i + 2) + ': ' + to + '   [' + (st || 'NOT SENT') + ']');
    }
  }

  var msg = lines.join('\n');
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  console.log(msg);
  return msg;
}

/**
 * Re-sends the ticket for one row, to the address in that row. Use when
 * somebody says theirs never arrived and you have checked their spam folder.
 * Does NOT issue a new code: the ticket they were promised is the one they get.
 */
function resendTicket(rowNumber) {
  if (!rowNumber || rowNumber < 2) return 'Give the row number, e.g. resendTicket(2).';
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var row = sheet.getRange(rowNumber, 1, 1, head.length).getValues()[0];
  var get = function (h) { var i = head.indexOf(h); return i === -1 ? '' : String(row[i] || '').trim(); };

  var to = get(CONFIG.FIELDS.email), code = get(CONFIG.OUT.ticket);
  if (!isEmail(to)) return 'Row ' + rowNumber + ' has no valid email.';
  if (!code) return 'Row ' + rowNumber + ' has no ticket code.';

  sendTicket({ to: to, name: get(CONFIG.FIELDS.name) || 'there',
               event: get(CONFIG.FIELDS.event) || 'Facerinna event', code: code });

  var sCol = head.indexOf(CONFIG.OUT.sentAt);
  if (sCol > -1) sheet.getRange(rowNumber, sCol + 1).setValue(new Date());
  return 'Re-sent ' + code + ' to ' + to + '. Quota left: ' + MailApp.getRemainingDailyQuota();
}

/** Sends one ticket to yourself so you can see it before the event does. */
function sendTestTicket() {
  sendTicket({
    to: Session.getEffectiveUser().getEmail(),
    name: 'Test',
    event: 'PDM AGM',
    code: makeCode()
  });
}
