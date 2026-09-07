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

  var msg = 'Trigger installed. Output columns ready.';
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
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    var name  = String(body.name  || '').trim();
    var email = String(body.email || '').trim();
    var phone = String(body.phone || '').trim();
    var event = String(body.event || '').trim();

    if (!name || name.length > 120)      return reply({ ok: false, error: 'bad name' });
    if (!isEmail(email))                 return reply({ ok: false, error: 'bad email' });
    if (phone.replace(/\D/g, '').length < 9) return reply({ ok: false, error: 'bad phone' });
    if (body.consent !== true)           return reply({ ok: false, error: 'consent required' });

    /* Client-side validation is a courtesy to the visitor, not a control:
       anyone can post here directly. Everything above is checked again. */

    var lock = LockService.getScriptLock();
    try { lock.waitLock(30000); } catch (err) {
      return reply({ ok: false, error: 'busy' });
    }

    try {
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
      var at = function (h) { return headers.indexOf(h); };

      if (at(CONFIG.OUT.ticket) === -1) return reply({ ok: false, error: 'not set up' });

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
            return reply({ ok: true, code: String(rows[i][at(CONFIG.OUT.ticket)] || ''),
                           duplicate: true });
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
      sheet.appendRow(row);
      var written = sheet.getLastRow();

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

      return reply({ ok: true, code: code });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    console.error(err);
    return reply({ ok: false, error: 'server' });
  }
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

/** Sends one ticket to yourself so you can see it before the event does. */
function sendTestTicket() {
  sendTicket({
    to: Session.getEffectiveUser().getEmail(),
    name: 'Test',
    event: 'PDM AGM',
    code: makeCode()
  });
}
