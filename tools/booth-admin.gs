/* FACERINNA booth admin — sign in by email link, settings, extra segments.
 *
 * WHAT IT IS FOR
 *   The booth page is a static file. Anything an admin changes without a
 *   code change has to live somewhere else, and the only somewhere this
 *   project already trusts is a Google Sheet behind an Apps Script. So:
 *
 *     - WHO is an admin is a list of e-mail addresses in the sheet. There is
 *       no password. Signing in is asking for a link; the link is mailed only
 *       to an address on that list; opening it makes a session that lasts
 *       SESSION_DAYS. Take an address off the list (or set active to no) and
 *       every session it holds stops working on the next call.
 *     - SETTINGS are key/value rows: whether the page is open, locked behind
 *       a passcode, or hidden behind a notice; whether the WELCOME TO
 *       FACERINNA BOOTH strip shows.
 *     - SEGMENTS are extra sections for the page -- a title, a description, a
 *       thumbnail and an embed or a link -- placed after any existing section.
 *       The page draws them itself on load; nothing else in the page changes.
 *
 *   The page reads all of this through the public `config` action, which
 *   never includes the passcode, the admin list or hidden segments.
 *
 * =====================================================================
 *  THIS IS YOUR FOURTH APPS SCRIPT PROJECT. IT NEEDS ITS OWN.
 * =====================================================================
 *
 *      1. events registration   AKfycbzYlL4-6rWb...
 *      2. booth scores          AKfycbx4zwbrto2iEUu...
 *      3. vault access          AKfycbxSfLoqRohd...
 *      4. booth admin           AKfycbyXD0qJ_a...   <- this one
 *
 *   Deployed 16 Sept 2026; that /exec address is in admin.html and
 *   index.html. Re-deploying as a NEW DEPLOYMENT (rather than a new version
 *   of the existing one) mints a different address and both pages would
 *   still be pointing at this one.
 *
 *   A project has exactly one doPost. Pasting this into any of the three
 *   above replaces theirs and takes that feature off the air.
 *
 * SET UP
 *   1. script.google.com -> New project. Paste this whole file.
 *   2. Run -> setUp once. Grant the permissions, including mail.
 *      It adds four tabs to the scores workbook (Admins, Settings, Segments,
 *      Admin sessions) and puts YOUR address in Admins.
 *   3. Deploy -> New deployment -> Web app.
 *        Execute as:      Me
 *        Who has access:  Anyone
 *   4. Send me the /exec URL. It goes into admin.html and index.html.
 *   5. To add an admin: type their address in the Admins tab, active = yes.
 *
 *   Re-deploy after ANY edit: Deploy -> Manage deployments -> pencil ->
 *   Version: New version.
 *
 * WHAT "LOCKED" AND "HIDDEN" MEAN
 *   The page is a public file. Locking it draws a passcode screen over it and
 *   hiding it draws a notice over it; neither removes the file from the
 *   server, and a person reading the page source can still read it. That is
 *   the right tool for a booth -- keep the screen closed between events, or
 *   for the eyes of people you gave the passcode -- and the wrong tool for a
 *   secret, which this page does not hold. The reports vault is gated
 *   server-side by its own script and is not affected by any of this.
 */

/* ------------------------------------------------------------------ config */

/* The scores workbook: separate TABS in the same book, not another book. */
var SHEET_ID = '1J9QAO7PUO4caLhDBsKMGZ5tofv4Gqy5-QSVlo_hBEso';

/* Where the sign-in link lands. Must be the admin page's real address. */
var ADMIN_URL = 'https://my.facerinna.com/admin.html';

var LINK_MINUTES = 20;    /* a sign-in link is good for this long */
var SESSION_DAYS = 30;    /* a session lasts this long after signing in */
var FROM_NAME    = 'FACERINNA Booth';

var T_ADMINS = 'Admins', T_SETTINGS = 'Settings', T_SEGMENTS = 'Segments',
    T_SESSIONS = 'Admin sessions', T_SECTIONS = 'Sections';

var ADMIN_HEADERS    = ['email', 'active', 'name', 'added'];
var SETTING_HEADERS  = ['key', 'value', 'updated', 'by'];
var SEGMENT_HEADERS  = ['id', 'order', 'after', 'eyebrow', 'title', 'description',
                        'thumbnail_url', 'embed_url', 'link_url', 'link_label', 'visible', 'updated', 'by'];
var SESSION_HEADERS  = ['key', 'kind', 'email', 'created', 'expires', 'used', 'last_seen'];
/* One row per section of the booth page. passcode is optional: a locked
   section with none falls back to the site passcode. */
var SECTION_HEADERS  = ['id', 'label', 'mode', 'passcode', 'message', 'updated', 'by'];

/* The settings the page understands, and what they are until somebody sets
   them. Anything else posted to admin.settings is dropped, so a typo cannot
   grow the sheet. */
var SETTING_KEYS = {
  page_mode:      'open',     /* open | locked | hidden */
  passcode:       '',         /* what "locked" asks for; never sent to the page */
  lock_message:   'This page is locked. Enter the passcode from the FACERINNA team.',
  hidden_message: 'The FACERINNA booth page is not open right now.',
  welcome:        'show',     /* show | hide -- the WELCOME TO FACERINNA BOOTH strip */
  /* The privacy page reads these. They are public by design -- a privacy
     notice with no named entity and no address to write to is not a notice. */
  privacy_entity:    '',
  privacy_email:     '',
  privacy_address:   '',
  privacy_retention: ''
};
var PRIVATE_SETTINGS = { passcode: true };

/* Where a segment may be placed: after one of these sections, or at the end.
   Sent to the admin page so its menu cannot drift from the real page. */
var SECTIONS = [
  ['range',   'The Range'],
  ['heroes',  'Hero Products'],
  ['evidence','Clinical Study'],
  ['gallery', 'Gallery'],
  ['clinic',  'Clinic Activation'],
  ['qrcore',  'QR Code'],
  ['talk',    "Dr. Peter's Talk"],
  ['game',    'Games'],
  ['end',     'End of page']
];

/* ------------------------------------------------------------------- setup */

function setUp() {
  var book = SpreadsheetApp.openById(SHEET_ID);
  tab_(book, T_ADMINS,   ADMIN_HEADERS);
  tab_(book, T_SETTINGS, SETTING_HEADERS);
  tab_(book, T_SEGMENTS, SEGMENT_HEADERS);
  tab_(book, T_SESSIONS, SESSION_HEADERS);
  tab_(book, T_SECTIONS, SECTION_HEADERS);

  /* A row per section, so the sheet shows every one there is and the admin
     page has something to list before anything has been changed. */
  var known = {};
  rows_(T_SECTIONS, SECTION_HEADERS).forEach(function (r) { known[String(r.id).trim()] = true; });
  SECTIONS.forEach(function (sec) {
    if (sec[0] === 'end' || known[sec[0]]) return;
    sheet_(T_SECTIONS).appendRow([sec[0], sec[1], 'show', '', '', now_(), 'setUp']);
  });

  /* You are the first admin, so you can sign in the moment this is deployed. */
  var me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (me && !adminRow_(me)) sheet_(T_ADMINS).appendRow([me, 'yes', 'owner', now_()]);

  /* Defaults are written as rows, so the sheet shows every key there is. */
  var have = settings_();
  Object.keys(SETTING_KEYS).forEach(function (k) {
    if (!(k in have)) sheet_(T_SETTINGS).appendRow([k, SETTING_KEYS[k], now_(), 'setUp']);
  });

  Logger.log('ok. admin: ' + me + '. mail quota left today: ' + MailApp.getRemainingDailyQuota());
  return 'ok';
}

function tab_(book, name, headers) {
  var sh = book.getSheetByName(name);
  if (!sh) sh = book.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sh;
}
function sheet_(name) {
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
  if (!sh) throw new Error('run setUp first: no tab ' + name);
  return sh;
}
function now_() { return new Date(); }
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
var esc_ = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};
function validKey_(k) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(k || '')); }
/* Must start with a letter or a digit: an address is compared by its exact
   value, so unlike a name it cannot be made safe with a leading apostrophe,
   and one beginning with = would be a formula in the sheet that holds it. */
function email_(s) { s = String(s || '').trim().toLowerCase(); return /^[A-Za-z0-9][^\s@]*@[^\s@]+\.[^\s@]+$/.test(s) ? s : ''; }

/* rows of a tab as objects keyed by header, with their 1-based sheet row */
function rows_(name, headers) {
  var sh = sheet_(name);
  var n = sh.getLastRow();
  if (n < 2) return [];
  var vals = sh.getRange(2, 1, n - 1, headers.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var o = { _row: i + 2 };
    for (var j = 0; j < headers.length; j++) o[headers[j]] = vals[i][j];
    out.push(o);
  }
  return out;
}
function yes_(v) { return /^(yes|y|true|1|show|on)$/i.test(String(v || '').trim()); }

/* ------------------------------------------------------------------ admins */

function adminRow_(email) {
  email = String(email || '').toLowerCase();
  var rows = rows_(T_ADMINS, ADMIN_HEADERS);
  for (var i = 0; i < rows.length; i++)
    if (String(rows[i].email || '').trim().toLowerCase() === email) return rows[i];
  return null;
}
function isAdmin_(email) {
  var r = adminRow_(email);
  return !!(r && yes_(r.active));
}

/* ---------------------------------------------------------------- sessions */

function addSession_(kind, email, minutes) {
  var key = Utilities.getUuid();
  var t = now_();
  sheet_(T_SESSIONS).appendRow([key, kind, email, t, new Date(t.getTime() + minutes * 60000), '', '']);
  return key;
}
function findSession_(key) {
  if (!validKey_(key)) return null;
  var rows = rows_(T_SESSIONS, SESSION_HEADERS);
  for (var i = 0; i < rows.length; i++) if (String(rows[i].key) === String(key)) return rows[i];
  return null;
}
function live_(s) {
  if (!s) return false;
  var exp = new Date(s.expires);
  return isFinite(exp.getTime()) && exp.getTime() > Date.now();
}
/* A session is only as good as the address behind it: revoke the admin in
   the sheet and the token dies with them. */
function auth_(b) {
  var s = findSession_(b && b.token);
  if (!s || s.kind !== 'session' || !live_(s)) return null;
  if (!isAdmin_(s.email)) return null;
  sheet_(T_SESSIONS).getRange(s._row, 7).setValue(now_());
  return String(s.email).toLowerCase();
}

/* Ask for a link. The answer is the same whether or not the address is an
   admin -- otherwise this is a free way to list who is. */
function login_(b) {
  var email = email_(b.email);
  if (!email) return json_({ ok: false, error: 'enter your e-mail address' });
  if (isAdmin_(email)) {
    var key = addSession_('link', email, LINK_MINUTES);
    var link = ADMIN_URL + '#k=' + key;
    MailApp.sendEmail({
      to: email,
      name: FROM_NAME,
      subject: 'Your FACERINNA booth admin sign-in link',
      htmlBody:
        '<p>Open this link to sign in to the booth admin. It works once, for ' + LINK_MINUTES + ' minutes.</p>' +
        '<p><a href="' + esc_(link) + '" style="display:inline-block;padding:12px 22px;background:#0A5480;' +
        'color:#fff;border-radius:999px;text-decoration:none;font-weight:700">Sign in</a></p>' +
        '<p style="color:#667">If the button does not open, copy this address into your browser:<br>' +
        esc_(link) + '</p><p style="color:#667">If you did not ask for this, ignore it; nothing changes.</p>',
      body: 'Open this link to sign in to the booth admin (works once, ' + LINK_MINUTES + ' minutes): ' + link
    });
  }
  return json_({ ok: true, sent: true, note: 'If that address is an admin, a sign-in link is on its way.' });
}

/* Turn the link's key into a session. Once. */
function exchange_(b) {
  var s = findSession_(b && b.key);
  if (!s || s.kind !== 'link') return json_({ ok: false, error: 'that link is not valid' });
  if (s.used) return json_({ ok: false, error: 'that link has already been used' });
  if (!live_(s)) return json_({ ok: false, error: 'that link has expired; ask for a new one' });
  if (!isAdmin_(s.email)) return json_({ ok: false, error: 'that address is no longer an admin' });
  sheet_(T_SESSIONS).getRange(s._row, 6).setValue(now_());
  var token = addSession_('session', String(s.email).toLowerCase(), SESSION_DAYS * 24 * 60);
  return json_({ ok: true, token: token, email: String(s.email).toLowerCase(),
                 expires: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString() });
}
function whoami_(b) {
  var email = auth_(b);
  if (!email) return json_({ ok: false, error: 'signed out' });
  var s = findSession_(b.token);
  return json_({ ok: true, email: email, expires: new Date(s.expires).toISOString() });
}
function logout_(b) {
  var s = findSession_(b && b.token);
  if (s) sheet_(T_SESSIONS).getRange(s._row, 5).setValue(new Date(0));
  return json_({ ok: true });
}

/* ---------------------------------------------------------------- settings */

function settings_() {
  var out = {};
  rows_(T_SETTINGS, SETTING_HEADERS).forEach(function (r) {
    var k = String(r.key || '').trim();
    if (k) out[k] = r.value == null ? '' : String(r.value);
  });
  return out;
}
function setSetting_(key, value, by) {
  var sh = sheet_(T_SETTINGS);
  var rows = rows_(T_SETTINGS, SETTING_HEADERS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].key).trim() === key) {
      sh.getRange(rows[i]._row, 2, 1, 3).setValues([[value, now_(), by]]);
      return;
    }
  }
  sh.appendRow([key, value, now_(), by]);
}
function publicSettings_() {
  var all = settings_(), out = {};
  Object.keys(SETTING_KEYS).forEach(function (k) {
    if (PRIVATE_SETTINGS[k]) return;
    out[k] = (k in all) ? all[k] : SETTING_KEYS[k];
  });
  if (out.page_mode !== 'locked' && out.page_mode !== 'hidden') out.page_mode = 'open';
  /* a lock with no passcode would lock everyone out, the admin included */
  if (out.page_mode === 'locked' && !String(all.passcode || '').trim()) out.page_mode = 'open';
  out.welcome = yes_(out.welcome) || out.welcome === '' ? 'show' : 'hide';
  return out;
}

/* ---------------------------------------------------------------- sections

   A section of the booth page can be shown, locked behind a passcode, or
   hidden. Locking a built-in section draws a card over it; the section's own
   markup is in the published file either way, so this is a closed door and
   not a safe -- the same caveat as the whole-page lock. */

function sectionMode_(v) {
  v = String(v == null ? '' : v).trim().toLowerCase();
  if (v === 'locked' || v === 'lock') return 'locked';
  if (v === 'hidden' || v === 'hide' || v === 'no' || v === 'false' || v === '0') return 'hidden';
  return 'show';
}
function sectionRows_() {
  var byId = {};
  rows_(T_SECTIONS, SECTION_HEADERS).forEach(function (r) {
    var id = String(r.id || '').trim();
    if (id) byId[id] = r;
  });
  /* Ordered by the page, not by the sheet: the list an admin reads should be
     the order they will walk past at the booth. */
  var out = [];
  SECTIONS.forEach(function (sec) {
    if (sec[0] === 'end') return;
    var r = byId[sec[0]] || {};
    out.push({ id: sec[0], label: sec[1], mode: sectionMode_(r.mode),
               passcode: String(r.passcode == null ? '' : r.passcode),
               message: String(r.message == null ? '' : r.message) });
  });
  return out;
}
/* Only the ones that are not plainly shown, and never their passcodes. */
function publicSections_() {
  return sectionRows_().filter(function (s) { return s.mode !== 'show'; })
    .map(function (s) { return { id: s.id, label: s.label, mode: s.mode, message: s.message }; });
}
function setSection_(b, by) {
  var id = String((b && b.id) || '').trim();
  if (!SECTIONS.some(function (x) { return x[0] === id && x[0] !== 'end'; }))
    return json_({ ok: false, error: 'no such section' });
  var mode = sectionMode_(b.mode);
  var pass = String(b.passcode == null ? '' : b.passcode).trim().slice(0, 64);
  var msg  = String(b.message == null ? '' : b.message).trim().slice(0, 400);
  /* A locked section with no passcode of its own falls back to the site
     passcode; with neither, locking it would shut everyone out for good. */
  if (mode === 'locked' && !pass && !String(settings_().passcode || '').trim())
    return json_({ ok: false, error: 'set a passcode for this section, or a site passcode, before locking it' });

  var label = '';
  SECTIONS.forEach(function (x) { if (x[0] === id) label = x[1]; });
  var sh = sheet_(T_SECTIONS);
  var rows = rows_(T_SECTIONS, SECTION_HEADERS);
  var vals = [id, label, mode, pass, msg, now_(), by];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id).trim() === id) {
      sh.getRange(rows[i]._row, 1, 1, vals.length).setValues([vals]);
      return json_({ ok: true, sections: sectionRows_() });
    }
  }
  sh.appendRow(vals);
  return json_({ ok: true, sections: sectionRows_() });
}

/* ---------------------------------------------------------------- segments */

function segments_() {
  var rows = rows_(T_SEGMENTS, SEGMENT_HEADERS).filter(function (r) { return String(r.id || '').trim(); });
  rows.sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); });
  return rows.map(function (r) {
    var o = {};
    SEGMENT_HEADERS.forEach(function (h) { if (h !== 'updated' && h !== 'by') o[h] = r[h] == null ? '' : String(r[h]); });
    o.order = Number(r.order) || 0;
    o.mode = sectionMode_(r.visible);      /* show | locked | hidden */
    o.visible = o.mode === 'show';
    return o;
  });
}
/* A hidden segment is not sent at all. A LOCKED one is sent without the two
   things it exists to hand over -- the embed and the link -- so locking it
   withholds the content rather than merely covering it. The unlock call
   returns them once the passcode is right. */
function publicSegments_() {
  return segments_().filter(function (s) { return s.mode !== 'hidden' && s.title; })
    .map(function (s) {
      var o = { id: s.id, after: s.after, eyebrow: s.eyebrow, title: s.title,
                description: s.description, thumbnail_url: s.thumbnail_url };
      if (s.mode === 'locked') { o.locked = true; return o; }
      o.embed_url = s.embed_url; o.link_url = s.link_url; o.link_label = s.link_label;
      return o;
    });
}
function segmentById_(id) {
  var all = segments_();
  for (var i = 0; i < all.length; i++) if (String(all[i].id) === String(id)) return all[i];
  return null;
}
function url_(u) {
  u = String(u || '').trim();
  if (!u) return '';
  return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null;
}
function saveSegment_(b, by) {
  var s = (b && b.segment) || {};
  var title = String(s.title || '').trim().slice(0, 160);
  if (!title) return json_({ ok: false, error: 'a segment needs a title' });
  var after = String(s.after || 'end').trim();
  if (!SECTIONS.some(function (x) { return x[0] === after; })) after = 'end';
  var urls = { thumbnail_url: url_(s.thumbnail_url), embed_url: url_(s.embed_url), link_url: url_(s.link_url) };
  for (var k in urls) if (urls[k] === null) return json_({ ok: false, error: k.replace('_', ' ') + ' must start with https://' });

  var sh = sheet_(T_SEGMENTS);
  var rows = rows_(T_SEGMENTS, SEGMENT_HEADERS);
  var id = String(s.id || '').trim(), row = null, i;
  if (id) for (i = 0; i < rows.length; i++) if (String(rows[i].id) === id) row = rows[i];
  if (!row) {
    /* ten hex digits of a fresh uuid, and never one already in the sheet */
    do { id = 'seg-' + Utilities.getUuid().replace(/-/g, '').slice(-10); }
    while (rows.some(function (r) { return String(r.id) === id; }));
    var maxOrder = 0;
    rows.forEach(function (r) { maxOrder = Math.max(maxOrder, Number(r.order) || 0); });
    var order = maxOrder + 1;
  }
  var vals = [id, row ? (Number(row.order) || 0) : order, after,
    String(s.eyebrow || '').trim().slice(0, 80), title,
    String(s.description || '').trim().slice(0, 600),
    urls.thumbnail_url, urls.embed_url, urls.link_url,
    String(s.link_label || '').trim().slice(0, 40),
    /* 'yes' | 'locked' | 'no' -- the column keeps its name and its old values
       still read correctly through sectionMode_ */
    (s.mode ? sectionMode_(s.mode) === 'locked' ? 'locked' : sectionMode_(s.mode) === 'hidden' ? 'no' : 'yes'
            : (s.visible === false || /^(no|hide|false|0)$/i.test(String(s.visible))) ? 'no' : 'yes'),
    now_(), by];
  if (row) sh.getRange(row._row, 1, 1, vals.length).setValues([vals]);
  else sh.appendRow(vals);
  return json_({ ok: true, id: id, segments: segments_() });
}
function deleteSegment_(b, by) {
  var id = String((b && b.id) || '').trim();
  var sh = sheet_(T_SEGMENTS);
  var rows = rows_(T_SEGMENTS, SEGMENT_HEADERS);
  for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === id) {
    /* blank rather than delete: deleting shifts every later row while other
       calls may hold their numbers */
    sh.getRange(rows[i]._row, 1, 1, SEGMENT_HEADERS.length)
      .setValues([SEGMENT_HEADERS.map(function (h) { return h === 'updated' ? now_() : h === 'by' ? by + ' (deleted)' : ''; })]);
    return json_({ ok: true, segments: segments_() });
  }
  return json_({ ok: false, error: 'no such segment' });
}
function orderSegments_(b, by) {
  var ids = (b && b.ids) || [];
  if (!Array.isArray(ids)) return json_({ ok: false, error: 'ids must be a list' });
  var sh = sheet_(T_SEGMENTS);
  var rows = rows_(T_SEGMENTS, SEGMENT_HEADERS);
  rows.forEach(function (r) {
    var at = ids.indexOf(String(r.id));
    if (at >= 0) sh.getRange(r._row, 2, 1, 1).setValue(at + 1);
  });
  return json_({ ok: true, segments: segments_() });
}

/* ------------------------------------------------------------- the actions */

function config_() {
  return json_({ ok: true, settings: publicSettings_(), segments: publicSegments_(),
                 sections: SECTIONS, section_states: publicSections_(), at: Date.now() });
}
/* One door-opener for three kinds of door: the whole page, one section of it,
   or one segment. A section or segment with no passcode of its own falls back
   to the site passcode, so the usual case is one code for the booth. */
function unlock_(b) {
  b = b || {};
  var site = String(settings_().passcode || '').trim();
  var got = String(b.passcode || '').trim();
  var want = site, give = null;

  if (b.section) {
    var sec = null;
    sectionRows_().forEach(function (x) { if (x.id === String(b.section)) sec = x; });
    if (!sec) return json_({ ok: false, error: 'no such section' });
    if (sec.mode !== 'locked') return json_({ ok: true, open: true });
    want = String(sec.passcode || '').trim() || site;
  } else if (b.segment) {
    var seg = segmentById_(String(b.segment));
    if (!seg) return json_({ ok: false, error: 'no such segment' });
    if (seg.mode !== 'locked') return json_({ ok: true, open: true });
    /* A segment has no passcode column of its own -- it opens with the site
       passcode. One code per booth is what a person on a stand can remember;
       sections get their own only because a whole section is a bigger thing
       to hand out. */
    want = site;
    give = { embed_url: seg.embed_url, link_url: seg.link_url, link_label: seg.link_label };
  }

  if (!want) return json_({ ok: true, open: true });
  if (got && got === want) { missCount_(0); var out = { ok: true };
    if (give) out.segment = give;
    return json_(out);
  }
  /* Each wrong one costs longer than the last, and the cost drops to nothing
     the moment somebody gets it right. Deliberately NOT a lockout: locking
     the page after N wrong guesses would hand any stranger a way to shut the
     booth, which is a worse day than the guessing it would prevent.

     The cap cuts both ways, so it is a compromise and not a maximum. Every
     second of it also holds one of the script's simultaneous-execution slots,
     so a high cap makes it cheaper to starve the script of slots than to
     guess the passcode -- and a starved script is an admin who cannot sign
     in. Two seconds is the deal struck: around 1,800 tries an hour on one
     slot instead of tens of thousands unthrottled. That is slow enough to
     matter only if the passcode is long enough to matter; five or six
     characters of nothing in particular is not. */
  var missed = missCount_(1);
  Utilities.sleep(Math.min(600 * missed, 2000));
  return json_({ ok: false, error: 'wrong passcode' });
}
/* Consecutive wrong passcodes. Script properties rather than a sheet: this is
   written on every guess and a sheet write is far too slow for that. */
function missCount_(add) {
  try {
    var props = PropertiesService.getScriptProperties();
    if (!add) { props.deleteProperty('miss'); return 0; }
    var n = (parseInt(props.getProperty('miss'), 10) || 0) + 1;
    if (n > 50) n = 50;
    props.setProperty('miss', String(n));
    return n;
  } catch (e) { return 1; }
}

function adminGet_(email) {
  var all = settings_(), settings = {};
  Object.keys(SETTING_KEYS).forEach(function (k) { settings[k] = (k in all) ? all[k] : SETTING_KEYS[k]; });
  var admins = rows_(T_ADMINS, ADMIN_HEADERS).map(function (r) {
    return { email: String(r.email || ''), active: yes_(r.active), name: String(r.name || '') };
  }).filter(function (a) { return a.email; });
  var quota = 0; try { quota = MailApp.getRemainingDailyQuota(); } catch (e) {}
  return json_({ ok: true, email: email, settings: settings, segments: segments_(),
                 admins: admins, sections: SECTIONS, section_rows: sectionRows_(), quota: quota });
}
function adminSettings_(b, email) {
  var s = (b && b.settings) || {};
  var now = settings_();

  /* What the sheet WOULD hold, worked out in full before a cell is touched.
     The first cut wrote each key as it read it and only then checked the
     result, so a refusal left the sheet in the very state it had just said no
     to -- the page went on reading `locked` with no passcode, and the public
     view quietly coerced it back to open, which is what hid it. */
  var next = {}, changed = [];
  Object.keys(SETTING_KEYS).forEach(function (k) {
    next[k] = (k in now) ? String(now[k]) : String(SETTING_KEYS[k]);
  });
  Object.keys(SETTING_KEYS).forEach(function (k) {
    if (!(k in s)) return;
    var v = String(s[k] == null ? '' : s[k]).trim();
    if (k === 'page_mode' && ['open', 'locked', 'hidden'].indexOf(v) < 0) v = 'open';
    if (k === 'welcome') v = yes_(v) ? 'show' : 'hide';
    if (k === 'passcode') v = v.slice(0, 64);
    else v = v.slice(0, 400);
    next[k] = v; changed.push(k);
  });

  var pass = String(next.passcode || '').trim();
  if (next.page_mode === 'locked' && !pass)
    return json_({ ok: false, changed: [], error: 'set a passcode before locking the page' });
  /* Clearing the site passcode while something leans on it would leave that
     thing locked with no way in, so say which one rather than let it happen. */
  if (!pass) {
    var stranded = sectionRows_().filter(function (x) { return x.mode === 'locked' && !x.passcode; });
    var lockedSegs = segments_().filter(function (x) { return x.mode === 'locked'; });
    if (stranded.length || lockedSegs.length)
      return json_({ ok: false, changed: [],
        error: 'a site passcode is needed while ' +
          (stranded.length ? stranded[0].label : lockedSegs[0].title) + ' is locked' });
  }

  changed.forEach(function (k) { setSetting_(k, next[k], email); });
  return json_({ ok: true, changed: changed, settings: settings_(), public: publicSettings_() });
}

function doPost(e) {
  try {
    var b = {};
    try { b = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
    catch (bad) { return json_({ ok: false, error: 'bad json' }); }

    var action = String(b.action || '');
    /* the public ones */
    if (action === 'config')  return config_();
    if (action === 'unlock')  return unlock_(b);
    if (action === 'login')   return login_(b);
    if (action === 'exchange') return exchange_(b);
    if (action === 'whoami')  return whoami_(b);
    if (action === 'logout')  return logout_(b);

    /* the admin ones: every write takes the lock */
    if (action.indexOf('admin.') !== 0) return json_({ ok: false, error: 'unknown action' });
    var email = auth_(b);
    if (!email) return json_({ ok: false, error: 'signed out' });
    if (action === 'admin.get') return adminGet_(email);

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return json_({ ok: false, error: 'busy, try again' });
    try {
      switch (action) {
        case 'admin.settings':        return adminSettings_(b, email);
        case 'admin.segment.save':    return saveSegment_(b, email);
        case 'admin.segment.delete':  return deleteSegment_(b, email);
        case 'admin.segment.order':   return orderSegments_(b, email);
        case 'admin.section.set':     return setSection_(b, email);
        default: return json_({ ok: false, error: 'unknown action' });
      }
    } finally { lock.releaseLock(); }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* GET says the script is alive, and ?config=1 hands the page its config the
   cheap way (a simple request, no preflight). */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.config) return config_();
  return json_({ ok: true, service: 'facerinna booth admin', at: Date.now() });
}

/* Run this from the editor to see what the page will get. */
function preview() {
  Logger.log(JSON.stringify({ settings: publicSettings_(), segments: publicSegments_() }, null, 2));
}
