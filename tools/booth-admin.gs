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
 *   5. To add someone: admin.html -> People, or a row in the Admins tab
 *      (email, active = yes). A row with no role is a full admin; set role
 *      to staff and list the areas under access to give less.
 *
 *   Re-deploy after ANY edit: Deploy -> Manage deployments -> pencil ->
 *   Version: New version.
 *
 *   QR codes and posters (5 Oct 2026) store their pictures in Drive, which is
 *   a new permission for this script. After pasting this version, run setUp
 *   once from the editor and allow Drive when Google asks (it also adds the
 *   Media tab), THEN deploy the new version. Without that, uploads fail with
 *   an authorisation error and everything else carries on as before.
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
    T_SESSIONS = 'Admin sessions', T_SECTIONS = 'Sections', T_GIFTS = 'Gifts',
    T_STOCK = 'Gift stock', T_MEDIA = 'Media';

/* One row per person who can sign in. role and access came later (30 Sept
   2026) and sit after the first four columns, so a sheet from before them
   still reads: a row with no role is an admin, which is what every row was. */
var ADMIN_HEADERS    = ['email', 'active', 'name', 'added', 'role', 'access', 'updated', 'by'];
var SETTING_HEADERS  = ['key', 'value', 'updated', 'by'];
var SEGMENT_HEADERS  = ['id', 'order', 'after', 'eyebrow', 'title', 'description',
                        'thumbnail_url', 'embed_url', 'link_url', 'link_label', 'visible', 'updated', 'by'];
var SESSION_HEADERS  = ['key', 'kind', 'email', 'created', 'expires', 'used', 'last_seen'];
/* One row per section of the booth page. passcode is optional: a locked
   section with none falls back to the site passcode. */
var SECTION_HEADERS  = ['id', 'label', 'mode', 'passcode', 'message', 'updated', 'by'];
/* One row per device that earned a gift. `claim` is the secret in the QR code;
   `redeemed` and `product` are written the moment an admin scans it, and never
   again -- that row IS the one-gift-per-device rule. */
var GIFT_HEADERS     = ['claim', 'device', 'game', 'score', 'name', 'created', 'redeemed', 'product', 'by',
                        'reset', 'reset_by', 'attempt'];
/* attempt is the id of the scan that spent the code. A counter phone that did not
   hear the answer asks again with the same id and is given the same result as a
   fresh spin; any other scan of that code is a second scan and is told so. */
/* The wheel. One row per product; quantity is how many are left. A product at
   0 is off the wheel and comes back when it is restocked. A blank quantity is
   "not counted" -- how the products from before stock arrive -- and stays on
   the wheel until somebody sets a count. */
var STOCK_HEADERS    = ['product', 'quantity', 'updated', 'by'];
/* QR codes and posters an admin uploaded. The picture itself lives in Drive
   (file_id); the row says what it is, which event it is for and whether it is
   on. `name` is made here, never typed: kind-event-label-number. */
var MEDIA_HEADERS    = ['id', 'kind', 'name', 'label', 'event', 'on', 'file_id', 'target', 'mime', 'bytes',
                        'created', 'by', 'updated', 'shared'];
/* shared is what Drive was last told for that file (link | private), so a change
   only calls Drive for the files whose answer actually changed. */
var MEDIA_SHARED_COL = 14;
var MEDIA_FOLDER     = 'FACERINNA booth media';
var MEDIA_MAX_BYTES  = 2500000;        /* one picture, after the page has shrunk it */
var MEDIA_MAX_ITEMS  = 120;
var STOCK_MAX        = 40;       /* products on the wheel at most */
var STOCK_MAX_QTY    = 100000;

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
  privacy_retention: '',
  /* The gift at the end of Facy Run. Off until an admin turns it on, so a
     visitor cannot earn a QR code on a day nobody is at the counter to scan
     it. gift_products is the wheel, one product per line, chosen at random ON
     THE SCRIPT when the admin scans, so the phone doing the spinning has no
     say in what it lands on.

     gift_points is one line per game -- "facy-run = 6000" -- because the
     games are scored on scales with nothing to do with each other: six
     thousand is a good run of Facy Run and unreachable in a quiz marked out
     of five. A game with no line offers no gift, which is the safe way round:
     a figure guessed too low hands one to everybody. Watch an hour of real
     scores on the board, then fill these in.

     A bare number with no lines is read as the figure for every game, so the
     single number this setting used to hold still means what it meant. */
  /* The games an admin has switched off, comma separated: "uv-card,deep-lab".
     Empty means every game is on, which is how the page has always been. An
     off game leaves the wheel on the booth page, and its own page shows a
     resting card to anybody who opens it from an old link or a QR code. */
  games_off:     '',
  /* The event the booth is running now. A QR code or poster tagged with another
     event is locked: private in Drive and left out of the page's config, so it is
     not merely hidden. Empty means no event is chosen and nothing is locked for
     that reason. qr_builtin is the old all-or-nothing switch for the three codes
     written into the page; they are listed one by one now (BUILTIN_MEDIA), and a
     "hide" left here only sets where they start. */
  active_event:  '',
  qr_builtin:    'show',
  gift_active:   'no',
  gift_points:   'facy-run = 6000',
  gift_products: 'Niacinamide Brightening Serum Sunscreen SPF50 PA++++\n' +
                 '2% Salicylic Acid Acne Serum\n' +
                 'Ceramide B5 Balancing Moisturizer\n' +
                 '5% B5 Centella Calming Gel Cream\n' +
                 'Low pH B5 Gel Cleanser\n' +
                 'Ceramide B5 Balancing Toner\n' +
                 '10% Niacinamide 3% TXA Bright Dark Spot Serum\n' +
                 '5% B5 Intensive Barrier Cream'
};
/* gift_products is only where the Gift stock tab takes its first list from;
   after that the tab is the wheel, so the setting would only mislead. */
var PRIVATE_SETTINGS = { passcode: true, gift_products: true };

/* ------------------------------------------------------------------ roles

   Two roles. An ADMIN can do everything, including the People tab: adding
   someone, choosing what they may touch, turning them off. A STAFF member can
   do only the areas an admin has ticked for them -- the counter phone needs
   the counter and nothing else, and a colleague editing segments has no
   business reading the passcode.

   Every check is made on the script, on every call, from the live row, so an
   untick in the People tab (or in the sheet) takes effect on that person's
   next request. The page hiding a tab is manners; this is the lock.

   The OWNER is the account this script runs as. The owner is always an admin
   and cannot be changed from the page, and nobody can change their own row
   there, so a stolen session cannot lock the owner out or promote itself. */
var PERMS = [
  ['counter',  'Counter',         'Scan gift codes at the counter and spin the wheel'],
  ['guide',    'Staff guide',     'Read the booth staff guide'],
  ['page',     'Page & passcode', 'Open, lock or hide the booth page, its passcode and the welcome strip'],
  ['games',    'Games',           'Turn each game on or off on the booth page'],
  ['gift',     'Gift rules',      'Turn the gift on or off and the points each game needs'],
  ['stock',    'Gift stock',      'The products on the wheel and how many of each are left'],
  ['claims',   'Gift claims',     'See who earned a gift, and let a device play for one again'],
  ['sections', 'Sections',        'Show, lock or hide each part of the booth page'],
  ['segments', 'Segments',        'Add, edit, order and delete extra segments'],
  ['media',    'QR & posters',    'Upload QR codes and posters, and lock the ones not used at the current event'],
  ['privacy',  'Privacy notice',  'The details the privacy page shows']
];
var PERM_KEYS = PERMS.map(function (p) { return p[0]; });
function permLabel_(k) { for (var i = 0; i < PERMS.length; i++) if (PERMS[i][0] === k) return PERMS[i][1]; return k; }

/* Which area each setting belongs to. A key missing here cannot be saved. */
var SETTING_AREA = {
  page_mode: 'page', passcode: 'page', lock_message: 'page', hidden_message: 'page', welcome: 'page',
  games_off: 'games', active_event: 'media', qr_builtin: 'media',
  gift_active: 'gift', gift_points: 'gift', gift_products: 'stock',
  privacy_entity: 'privacy', privacy_email: 'privacy', privacy_address: 'privacy', privacy_retention: 'privacy'
};

/* The admin actions that need one area. admin.settings is checked key by key,
   admin.get is filtered, and admin.team.* needs the admin role. */
var ACTION_AREA = {
  'admin.guide': 'guide',
  'admin.gift.redeem': 'counter',
  'admin.section.set': 'sections',
  'admin.segment.save': 'segments',
  'admin.segment.delete': 'segments',
  'admin.segment.order': 'segments',
  'admin.media.upload': 'media',
  'admin.media.set': 'media',
  'admin.media.delete': 'media',
  'admin.stock.set': 'stock',
  'admin.stock.remove': 'stock',
  'admin.claims.reset': 'claims'
};
var TEAM_MAX = 200;
var GIFT_MAX_SCORE = 100000;

/* The games that keep a score, so can have a bar to clear. UV Card is absent
   on purpose: it deals a random token rather than scoring a performance, and
   a gift for luck sits oddly beside one for a good run -- it hands out its
   own prize already. */
var GIFT_GAMES = ['match-lab', 'pack-match', 'shelf-shot', 'deep-lab',
                  'lab-run', 'facy-run', 'skin-iq'];   /* the same ceiling booth-scores.gs applies */

/* Every game on the booth page, in the order the wheel shows them. The id is
   what games_off holds, what the scores and gifts call the game, and what the
   page matches against; the label is what an admin reads. */
var GAMES = [
  ['match-lab',  'Match Lab'],
  ['pack-match', 'Pack Match'],
  ['shelf-shot', 'Shelf Shot'],
  ['deep-lab',   'Deep Lab'],
  ['lab-run',    'Lab Run'],
  ['uv-card',    'UV Card'],
  ['skin-iq',    'Skin IQ Challenge'],
  ['facy-run',   'Facy Run']
];
/* Read the setting the way a person might have typed it into the sheet:
   any separator, any case, unknown names dropped, each game once. */
function gamesOff_(raw) {
  var known = {}, seen = {}, out = [];
  GAMES.forEach(function (g) { known[g[0]] = true; });
  String(raw == null ? '' : raw).toLowerCase().split(/[\s,;]+/).forEach(function (id) {
    if (known[id] && !seen[id]) { seen[id] = true; out.push(id); }
  });
  return out;
}

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
  tab_(book, T_GIFTS,    GIFT_HEADERS);
  headers_(T_GIFTS, GIFT_HEADERS);

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
  teamHeaders_();
  if (me && !adminRow_(me)) sheet_(T_ADMINS).appendRow([me, 'yes', 'owner', now_(), 'admin', '', now_(), 'setUp']);

  /* Defaults are written as rows, so the sheet shows every key there is. */
  var have = settings_();
  Object.keys(SETTING_KEYS).forEach(function (k) {
    if (!(k in have)) sheet_(T_SETTINGS).appendRow([k, SETTING_KEYS[k], now_(), 'setUp']);
  });

  tab_(book, T_MEDIA, MEDIA_HEADERS);
  headers_(T_MEDIA, MEDIA_HEADERS);
  stockTab_();   /* after the settings rows: its first list is gift_products */
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
/* Before a lock is let go, everything written under it is pushed to the sheet. A
   write left pending can still be invisible to the next run that takes the lock,
   which then reads the old stock count -- two gifts off one unit -- or a code not
   yet marked spent. Google's own LockService example does exactly this. */
function flushSheets_() { try { SpreadsheetApp.flush(); } catch (e) {} }
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
/* A visitor's name goes into a cell. One that starts with = + - or @ would be
   a formula there, and a formula can read the row beside it. A leading
   apostrophe makes it text; the sheet shows it without the apostrophe. */
function cell_(v) {
  var s = String(v == null ? '' : v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

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
/* Anyone on the list and active can sign in; what they may then do is
   their role and access. The name is kept from when every row was an admin. */
function isAdmin_(email) {
  var r = adminRow_(email);
  return !!(r && yes_(r.active));
}
function owner_() {
  try { return String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase(); }
  catch (e) { return ''; }
}
/* A row as a person: role, the areas they hold, and whether they are the owner.
   A blank role is an admin (the rows from before roles); anything that is not
   plainly "admin" is staff, so a typo in the sheet grants less, not more. */
function person_(r) {
  var email = String(r.email || '').trim().toLowerCase();
  var own = !!email && email === owner_();
  var raw = String(r.role == null ? '' : r.role).trim().toLowerCase();
  var role = (own || raw === '' || raw === 'admin') ? 'admin' : 'staff';
  var access = [];
  if (role === 'admin') access = PERM_KEYS.slice();
  else String(r.access || '').toLowerCase().split(/[\s,;]+/).forEach(function (k) {
    if (PERM_KEYS.indexOf(k) >= 0 && access.indexOf(k) < 0) access.push(k);
  });
  return { email: email, name: String(r.name || ''), active: yes_(r.active), role: role,
           access: access, owner: own };
}
function can_(me, area) { return !!me && (me.role === 'admin' || me.access.indexOf(area) >= 0); }
function refuse_(area) {
  return json_({ ok: false, reason: 'forbidden', area: area,
                 error: 'Your access does not include ' + permLabel_(area) + '. Ask an admin to tick it for you.' });
}
function iso_(v) { var d = new Date(v); return (v && isFinite(d.getTime())) ? d.toISOString() : ''; }

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
  var row = adminRow_(s.email);
  if (!row || !yes_(row.active)) return null;
  sheet_(T_SESSIONS).getRange(s._row, 7).setValue(now_());
  return person_(row);
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
/* preview: whether the booth page should show this person what visitors
   cannot -- locked and hidden sections, with a ribbon. Counter staff do not
   get that: a locked section is locked for them too. */
function whoami_(b) {
  var me = auth_(b);
  if (!me) return json_({ ok: false, error: 'signed out' });
  var s = findSession_(b.token);
  return json_({ ok: true, email: me.email, role: me.role, access: me.access, owner: me.owner,
                 preview: can_(me, 'page') || can_(me, 'sections') || can_(me, 'games'),
                 expires: new Date(s.expires).toISOString() });
}
function logout_(b) {
  var s = findSession_(b && b.token);
  if (s) sheet_(T_SESSIONS).getRange(s._row, 5).setValue(new Date(0));
  return json_({ ok: true });
}

/* ------------------------------------------------- signing in with a code

   The link route above binds a sign-in to whichever device opened the mail.
   That is fine for one tablet and a nuisance for a booth: the counter phone,
   the iPad on the stand and whatever somebody has in their pocket each need
   their own link, and a link opened in a mail app's own browser signs THAT
   browser in rather than the one the booth is running.

   So: the same address, a six-digit code, typed into whatever is in front of
   you. It proves control of the address exactly as the link does, and buys
   exactly what the link buys -- a session of SESSION_DAYS -- so an admin can
   sign in anywhere without a link to chase.

   The stored copy is salted and hashed, so a look at the script's properties
   does not hand anybody a working code.                                     */

var CODE_MINS   = 10;     /* a code is worth nothing after this long */
var CODE_TRIES  = 5;      /* wrong guesses before that code is dead */
var CODE_GAP_MS = 60000;  /* one code a minute per address */

/* Body: {action:'code', email}
   Back: {ok:true, sent:true}

   The same answer for any address, admin or not -- the link route makes that
   promise and a code route that broke it would turn this form into a way of
   asking the booth who its admins are. */
function codeRequest_(b) {
  var email = email_(b && b.email);
  if (!email) return json_({ ok: false, error: 'enter your e-mail address' });

  var sent = { ok: true, sent: true,
               note: 'If that address is an admin, a code is on its way.' };
  if (!isAdmin_(email)) return json_(sent);

  var props = PropertiesService.getScriptProperties();
  var slot = 'admincode:' + email;
  var prev = readCode_(props, slot);
  /* Asking twice in a minute mints nothing and sends nothing: without this a
     held-down button is a mail bomb aimed at somebody else's inbox, and each
     fresh code would quietly kill the one they are already typing. */
  if (prev && (Date.now() - prev.made) < CODE_GAP_MS) return json_(sent);

  var code = sixDigits_();
  /* Mailed first, stored second. The other order can leave an address locked
     out for CODE_GAP_MS holding a code that never arrived. */
  MailApp.sendEmail({
    to: email,
    name: FROM_NAME,
    subject: 'Your FACERINNA booth admin code: ' + code,
    htmlBody:
      '<p>Your one-time code for the FACERINNA booth admin is:</p>' +
      '<p style="font:700 28px/1.2 monospace;letter-spacing:4px">' + code + '</p>' +
      '<p style="color:#667;font-size:13px">It works once, on whichever device you ' +
      'type it into, and stops working in ' + CODE_MINS + ' minutes. It signs that ' +
      'device in to the booth admin, so treat it as you would the sign-in link.</p>' +
      '<p style="color:#667;font-size:13px">If you did not ask for it, ignore this ' +
      'mail; nothing changes.</p>',
    body: 'Your FACERINNA booth admin code is ' + code + '. It works once, for ' +
          CODE_MINS + ' minutes, on whichever device you type it into.'
  });
  props.setProperty(slot, JSON.stringify({
    h: codeHash_(email, code), exp: Date.now() + CODE_MINS * 60000,
    tries: 0, made: Date.now()
  }));
  return json_(sent);
}

/* Body: {action:'redeem', email, code}
   Back: {ok:true, token, email, expires} | {ok:false, reason:...}

   A spent code is deleted before the session goes out, so the same six digits
   can never buy a second one. */
function codeRedeem_(b) {
  var email = email_(b && b.email);
  var code  = String((b && b.code) || '').replace(/\D/g, '');
  if (!email) return json_({ ok: false, reason: 'nocode' });

  var props = PropertiesService.getScriptProperties();
  var slot  = 'admincode:' + email;
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

  /* Asked again rather than trusting what was true when the code was minted:
     an address taken off the list in those ten minutes must not still get in
     on a code from while it was live. */
  if (!isAdmin_(email)) return json_({ ok: false, reason: 'revoked' });

  var token = addSession_('session', email, SESSION_DAYS * 24 * 60);
  var who = person_(adminRow_(email));
  return json_({ ok: true, token: token, email: email, role: who.role, access: who.access,
                 expires: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString() });
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
  var salt = props.getProperty('admin-code-salt');
  if (!salt) { salt = Utilities.getUuid(); props.setProperty('admin-code-salt', salt); }
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + email + '|' + code);
  return Utilities.base64Encode(bytes);
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
  out.games_off = gamesOff_(out.games_off).join(',');
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


/* ------------------------------------------------------- QR codes and posters

   An admin uploads a picture of a QR code or a poster. It is stored in Drive,
   named here, and tagged with the event it is for. Whether the public can see
   it is decided in ONE place, mediaLive_: the row is on, and its event is the
   current one (or it names no event). Everything that follows from "live"
   follows from that function -- the config lists only live items, and
   syncMedia_ sets the Drive file to "anyone with the link" when it is live and
   to private when it is not, so a locked poster is locked at the source and
   its link stops working, not just left out of the page. */

function eventName_(v) {
  /* letters, digits, spaces and a little punctuation; no markup in a name that
     is shown on a page and in a file name */
  return String(v == null ? '' : v).replace(/[^\w .,'&()\/-]/g, ' ').replace(/\s+/g, ' ').replace(/^[-=+@ ]+/, '').trim().slice(0, 60);
}
/* Sheets turns "13/9" into a date and "2026" into a number as it is typed in. An
   event name or label is text whatever it looks like, so anything Sheets would
   read as a number or a date goes in with the leading apostrophe that says
   "text" (Sheets keeps the apostrophe out of the value), and so does anything it
   would read as a formula. */
function textCell_(v) {
  var s = String(v == null ? '' : v);
  return /^[=+\-@\t\r]/.test(s) || /^[\d\s.,:\/\-]+$/.test(s) && /\d/.test(s) ? "'" + s : s;
}
function slug_(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
function sameEvent_(a, b) { return slug_(a) === slug_(b); }

/* The Media tab came with QR codes and posters. A script pasted in without running
   setUp has none, and the config the WHOLE booth page lives on must not fail over
   it: no tab reads as no media, and everything else carries on. */
function mediaTab_() {
  try { return rows_(T_MEDIA, MEDIA_HEADERS); } catch (e) { return []; }
}
function mediaRows_() {
  return mediaTab_().filter(function (r) { return String(r.id || '').trim() && String(r.file_id || '').trim() && !isBuiltin_(r.id); });
}

/* The three codes and the session poster written into the page itself. They
   have no Drive file -- their pictures are part of the published page -- so for
   them "off" or "locked to another event" means the page leaves them out, the
   same closed door (not a safe) as a hidden section. Each gets a row in the
   Media tab the first time somebody changes it; until then it is on, at every
   event. thumb is the page's own copy of the picture, for the admin list. */
var BUILTIN_MEDIA = [
  { id: 'builtin-qr-registration', kind: 'qr', label: 'Registration', thumb: 'media/builtin-qr-registration.png' },
  { id: 'builtin-qr-more-info', kind: 'qr', label: 'More Info', thumb: 'media/builtin-qr-more-info.png' },
  { id: 'builtin-qr-whatsapp', kind: 'qr', label: 'WhatsApp', thumb: 'media/builtin-qr-whatsapp.png' },
  { id: 'builtin-poster-session-talk', kind: 'poster', label: 'Session poster: Dr. Peter Ch\'ng (talk section)', thumb: 'docs/talk-poster-1.webp' }
];
function isBuiltin_(id) { return /^builtin-/.test(String(id || '')); }
function builtins_() {
  var have = {};
  mediaTab_().forEach(function (r) { if (isBuiltin_(r.id)) have[String(r.id)] = r; });
  /* the switch these codes had before they were listed one by one */
  var oldHide = String(settings_().qr_builtin || '') === 'hide';
  return BUILTIN_MEDIA.map(function (b) {
    var r = have[b.id];
    return { id: b.id, kind: b.kind, name: b.id.replace(/^builtin-/, ''), label: b.label, thumb: b.thumb, builtin: true,
             event: r ? String(r.event || '') : '', on: r ? r.on : ((oldHide && b.kind === 'qr') ? 'no' : 'yes'),
             _row: r ? r._row : 0, created: r ? r.created : '', by: r ? r.by : '' };
  });
}
/* the built-in pieces the page should leave out right now */
function builtinOff_(active) {
  var cur = active == null ? settings_().active_event : active;
  return builtins_().filter(function (b) { return !mediaLive_(b, cur); }).map(function (b) { return b.id; });
}
function mediaLive_(r, active) {
  if (!yes_(r.on)) return false;
  var ev = String(r.event || '').trim(), cur = String(active == null ? settings_().active_event : active || '').trim();
  if (!ev || !cur) return true;
  return sameEvent_(ev, cur);
}
function mediaUrl_(id, kind) {
  return 'https://lh3.googleusercontent.com/d/' + id + (kind === 'qr' ? '=s800' : '=w1800');
}
/* what the public page gets: live items only, and nothing that names the file's
   owner, the admin who uploaded it or the other events there are */
function publicMedia_(active) {
  var cur = active == null ? settings_().active_event : active;
  return mediaRows_().filter(function (r) { return mediaLive_(r, cur); })
    .map(function (r) {
      var o = { id: String(r.id), kind: String(r.kind), name: String(r.name), label: String(r.label || ''),
                url: mediaUrl_(String(r.file_id), String(r.kind)) };
      if (r.kind === 'qr' && /^https:\/\//i.test(String(r.target || ''))) o.link = String(r.target);
      return o;
    });
}
function mediaList_() {
  var cur = settings_().active_event;
  var fixed = builtins_().map(function (b) {
    var live = mediaLive_(b, cur);
    return { id: b.id, kind: b.kind, name: b.name, label: b.label, event: b.event, on: yes_(b.on), live: live,
             locked: yes_(b.on) && !live, builtin: true, thumb: b.thumb, target: '', bytes: 0, url: '',
             created: iso_(b.created), by: String(b.by || '') };
  });
  return fixed.concat(mediaRows_().map(function (r) {
    var live = mediaLive_(r, cur);
    return { id: String(r.id), kind: String(r.kind), name: String(r.name), label: String(r.label || ''),
             event: String(r.event || ''), on: yes_(r.on), live: live,
             locked: yes_(r.on) && !live,            /* switched on, but for another event */
             target: String(r.target || ''), bytes: Number(r.bytes) || 0,
             url: live ? mediaUrl_(String(r.file_id), String(r.kind)) : '',
             created: iso_(r.created), by: String(r.by || '') };
  }));
}
function mediaEvents_() {
  var seen = {}, out = [];
  builtins_().concat(mediaRows_()).forEach(function (r) {
    var e = String(r.event || '').trim();
    if (e && !seen[slug_(e)]) { seen[slug_(e)] = true; out.push(e); }
  });
  var cur = String(settings_().active_event || '').trim();
  if (cur && !seen[slug_(cur)]) out.push(cur);
  return out.sort();
}

function mediaFolder_() {
  var it = DriveApp.getFoldersByName(MEDIA_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(MEDIA_FOLDER);
}
/* Make every file's sharing agree with its row. Called after anything that can
   change what is live. A file already in the right state is left alone. */
function syncMedia_() {
  var cur = settings_().active_event, sh = null;
  mediaRows_().forEach(function (r) {
    var want = mediaLive_(r, cur) ? 'link' : 'private';
    if (String(r.shared || '') === want) return;       /* Drive already says so */
    shareFile_(String(r.file_id), want === 'link');
    if (!sh) sh = sheet_(T_MEDIA);
    sh.getRange(r._row, MEDIA_SHARED_COL, 1, 1).setValue(want);
  });
}
function shareFile_(fileId, live) {
  var f = DriveApp.getFileById(fileId);
  if (live) f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  else f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
}

/* The label a person would call it. A QR code is named for where it leads. */
var QR_HOSTS = [
  [/(^|\.)wa\.me$|(^|\.)whatsapp\.com$/, 'whatsapp'],
  [/^docs\.google\.com$|^forms\.gle$|^forms\.google\.com$/, 'form'],
  [/(^|\.)facerinna\.com$|github\.io$/, 'website'],
  [/(^|\.)instagram\.com$/, 'instagram'], [/(^|\.)facebook\.com$|^fb\.me$/, 'facebook'],
  [/(^|\.)tiktok\.com$/, 'tiktok'], [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)youtube\.com$|^youtu\.be$/, 'youtube'], [/(^|\.)shopee\./, 'shopee'], [/(^|\.)lazada\./, 'lazada']
];
function qrLabel_(target) {
  var m = /^https:\/\/([^\/?#:]+)/i.exec(String(target || ''));
  if (!m) return 'code';
  var host = m[1].toLowerCase();
  for (var i = 0; i < QR_HOSTS.length; i++) if (QR_HOSTS[i][0].test(host)) return QR_HOSTS[i][1];
  var parts = host.replace(/^www\./, '').split('.');
  return slug_(parts.length > 1 ? parts[parts.length - 2] : parts[0]) || 'code';
}
function fileLabel_(filename) {
  var base = String(filename || '').replace(/^.*[\\\/]/, '').replace(/\.[A-Za-z0-9]{2,5}$/, '');
  base = base.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base.slice(0, 60);
}
/* kind-event-label-NN, the number counting what already has that stem */
function mediaName_(kind, event, label, rows) {
  var stem = [kind, slug_(event) || 'all', slug_(label)].filter(String).join('-');
  var n = 1;
  rows.forEach(function (r) { if (String(r.name).indexOf(stem + '-') === 0) n = Math.max(n, (Number(String(r.name).slice(stem.length + 1)) || 0) + 1); });
  return stem + '-' + (n < 10 ? '0' + n : String(n));
}

var MEDIA_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
function mediaUpload_(b, by) {
  var kind = String(b.kind || '').toLowerCase();
  if (kind !== 'qr' && kind !== 'poster') return json_({ ok: false, error: 'say whether it is a QR code or a poster' });
  var mime = String(b.mime || '').toLowerCase();
  if (!MEDIA_TYPES[mime]) return json_({ ok: false, error: 'a PNG, JPEG or WebP picture, please' });
  var data = String(b.data || '').replace(/^data:[^,]*,/, '').replace(/\s/g, '');
  if (!data || !/^[A-Za-z0-9+\/]+=*$/.test(data)) return json_({ ok: false, error: 'the picture did not arrive' });
  var bytes;
  try { bytes = Utilities.base64Decode(data); } catch (e) { return json_({ ok: false, error: 'the picture could not be read' }); }
  if (!bytes || !bytes.length) return json_({ ok: false, error: 'the picture is empty' });
  if (bytes.length > MEDIA_MAX_BYTES) return json_({ ok: false, error: 'the picture is over ' + Math.round(MEDIA_MAX_BYTES / 100000) / 10 + ' MB' });
  var target = String(b.target || '').trim();
  if (target && url_(target) === null) target = '';
  if (kind !== 'qr') target = '';

  var rows = mediaRows_();
  if (rows.length >= MEDIA_MAX_ITEMS) return json_({ ok: false, error: 'the library is full (' + MEDIA_MAX_ITEMS + '); delete some first' });
  var event = eventName_(b.event);
  var label = kind === 'qr' ? qrLabel_(target) : (fileLabel_(b.filename) || 'poster');
  if (kind === 'poster') label = slug_(label).split('-').slice(0, 4).join('-') || 'poster';
  var name = mediaName_(kind, event, label, rows);

  var blob = Utilities.newBlob(bytes, mime, name + '.' + MEDIA_TYPES[mime]);
  var file;
  try { file = mediaFolder_().createFile(blob); }
  catch (e) { return json_({ ok: false, error: 'Drive refused the file: ' + String(e && e.message || e) }); }

  var id = 'med-' + Utilities.getUuid().replace(/-/g, '').slice(-10);
  var live = mediaLive_({ on: 'yes', event: event }, settings_().active_event);
  try { shareFile_(file.getId(), live); }
  catch (e) {
    try { file.setTrashed(true); } catch (x) {}
    return json_({ ok: false, error: 'Drive would not set the sharing (' + String(e && e.message || e) +
      '). If your Google account blocks sharing outside it, a Workspace admin has to allow link sharing.' });
  }
  /* the display label for a poster is the filename a person gave it, tidied */
  var shown = kind === 'poster' ? (fileLabel_(b.filename) || label) : label;
  headers_(T_MEDIA, MEDIA_HEADERS);
  sheet_(T_MEDIA).appendRow([id, kind, name, textCell_(shown), textCell_(event), 'yes', file.getId(), cell_(target), mime, bytes.length, now_(), by, now_(),
                             live ? 'link' : 'private']);
  return json_({ ok: true, id: id, name: name, live: live, media: mediaList_(), events: mediaEvents_() });
}

/* Turn one item on or off, move it to another event, or do that for a whole
   event at once: { id, on, event } or { for_event, on }. */
function mediaSet_(b, by) {
  var sh = sheet_(T_MEDIA), rows = builtins_().concat(mediaRows_()), hit = 0;
  var patch = function (r) {
    if (!r._row) {
      /* a built-in piece changed for the first time: it gets its row now */
      sh.appendRow([r.id, r.kind, r.name, textCell_(r.label), '', yes_(r.on) ? 'yes' : 'no', '', '', '', '', now_(), by, now_(), '']);
      r._row = sh.getLastRow();
    }
    var on = ('on' in b) ? (yes_(b.on) ? 'yes' : 'no') : (yes_(r.on) ? 'yes' : 'no');
    var ev = ('event' in b && b.id) ? eventName_(b.event) : String(r.event || '');
    sh.getRange(r._row, 5, 1, 2).setValues([[textCell_(ev), on]]);
    sh.getRange(r._row, 13, 1, 1).setValue(now_());
    hit++;
  };
  if (b.id) {
    rows.forEach(function (r) { if (String(r.id) === String(b.id)) patch(r); });
  } else if ('for_event' in b) {
    var fe = String(b.for_event || '');
    rows.forEach(function (r) { if (sameEvent_(r.event, fe) && (slug_(fe) || !String(r.event || '').trim())) patch(r); });
  } else return json_({ ok: false, error: 'say which one' });
  if (!hit) return json_({ ok: false, error: 'nothing matched' });
  var out = { ok: true, changed: hit };
  try { syncMedia_(); } catch (e) { out.media_error = String(e && e.message || e); }
  out.media = mediaList_(); out.events = mediaEvents_();
  return json_(out);
}
function mediaDelete_(b, by) {
  var sh = sheet_(T_MEDIA), id = String((b && b.id) || '');
  if (isBuiltin_(id)) return json_({ ok: false, error: 'that one is built into the page: turn it off instead' });
  var rows = mediaRows_();
  for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === id) {
    try { DriveApp.getFileById(String(rows[i].file_id)).setTrashed(true); } catch (e) { /* already gone */ }
    sh.getRange(rows[i]._row, 1, 1, MEDIA_HEADERS.length)
      .setValues([MEDIA_HEADERS.map(function (h) { return h === 'updated' ? now_() : h === 'by' ? by + ' (deleted)' : ''; })]);
    return json_({ ok: true, media: mediaList_(), events: mediaEvents_() });
  }
  return json_({ ok: false, error: 'no such item' });
}

/* ------------------------------------------------------------- the actions */

/* What each game has to score, worked out here so no page has to parse it.
   Two pages reading one format is two places for it to drift; they get a
   plain map of id to number and look theirs up. */
function giftNeeds_(raw) {
  var out = {};
  var text = String(raw == null ? '' : raw).trim();
  if (!text) return out;
  if (/^\d+$/.test(text)) {                 /* the old single number */
    var all = parseInt(text, 10);
    GIFT_GAMES.forEach(function (id) { out[id] = all; });
    return out;
  }
  text.split(/[\r\n,;]+/).forEach(function (line) {
    var bits = String(line).split(/[=:]/);
    if (bits.length < 2) return;
    var id = bits[0].trim().toLowerCase();
    var n = parseInt(String(bits[1]).replace(/[^0-9]/g, ''), 10);
    if (id && !isNaN(n) && n > 0) out[id] = n;
  });
  return out;
}

/* Every phone asks for this the moment the page opens, and again every few
   minutes while it stays open. Answered from the sheet it costs three
   spreadsheet opens and three reads, and Apps Script runs only about thirty
   requests at once, so a hundred phones arriving together (a poster QR code
   on a busy afternoon) queued behind one another and the slow ones timed out.

   The answer changes only when an admin saves something, so it is kept for
   CONFIG_SECS and thrown away by every admin write (see doPost). What this
   cannot see is a cell edited by hand in the sheet: that shows up within
   CONFIG_SECS, the same backstop booth-scores.gs uses for its board. If the
   cache is missing or throws, this is the old, slower path and nothing else
   changes. It holds only what config_ already hands to anybody who asks:
   never the passcode, the admin list or a hidden segment. */
var CONFIG_KEY  = 'config.v1';
var CONFIG_SECS = 20;
function configCache_() { try { return CacheService.getScriptCache(); } catch (e) { return null; } }
function dropConfig_() {
  var c = configCache_();
  if (c) { try { c.remove(CONFIG_KEY); } catch (e) {} }
}
function configText_(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}
function config_() {
  var cache = configCache_();
  if (cache) {
    try { var hit = cache.get(CONFIG_KEY); if (hit) return configText_(hit); } catch (e) {}
  }
  var set = publicSettings_();
  var text = JSON.stringify({ ok: true, settings: set, segments: publicSegments_(),
                 sections: SECTIONS, section_states: publicSections_(),
                 games: GAMES, gift_games: GIFT_GAMES, gift_needs: giftNeeds_(set.gift_points),
                 media: publicMedia_(set.active_event), builtin_off: builtinOff_(set.active_event),
                 at: Date.now() });
  /* a script cache value may not pass 100KB; past that, do without */
  if (cache && text.length < 90000) { try { cache.put(CONFIG_KEY, text, CONFIG_SECS); } catch (e) {} }
  return configText_(text);
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

/* Only what this person may see: a setting outside their areas is not sent
   at all -- the passcode above all -- and the People list goes to admins. */
function settingsFor_(me) {
  var all = settings_(), out = {};
  Object.keys(SETTING_KEYS).forEach(function (k) {
    if (can_(me, SETTING_AREA[k])) out[k] = (k in all) ? all[k] : SETTING_KEYS[k];
  });
  return out;
}
function teamList_() {
  return rows_(T_ADMINS, ADMIN_HEADERS).map(function (r) {
    var p = person_(r);
    return { email: p.email, name: p.name, active: p.active, role: p.role, access: p.access,
             owner: p.owner, added: iso_(r.added), updated: iso_(r.updated), by: String(r.by || '') };
  }).filter(function (a) { return a.email; });
}
function adminGet_(me) {
  var out = { ok: true, email: me.email, settings: settingsFor_(me), sections: SECTIONS, games: GAMES,
              me: { email: me.email, name: me.name, role: me.role, access: me.access, owner: me.owner },
              perms: PERMS };
  if (can_(me, 'segments')) out.segments = segments_();
  if (can_(me, 'sections')) out.section_rows = sectionRows_();
  if (can_(me, 'media')) { out.media = mediaList_(); out.events = mediaEvents_(); }
  if (can_(me, 'stock')) out.stock = stockPublic_();
  if (can_(me, 'claims')) out.claims = claimsList_();
  if (me.role === 'admin') {
    out.admins = teamList_();
    var quota = 0; try { quota = MailApp.getRemainingDailyQuota(); } catch (e) {}
    out.quota = quota;
  }
  return json_(out);
}
function adminSettings_(b, me) {
  var email = me.email;
  var s = (b && b.settings) || {};
  /* Every key asked for has to be in one of this person's areas, or nothing
     is written: a half-applied save is the worse of the two. */
  var keys = Object.keys(s).filter(function (k) { return k in SETTING_KEYS; });
  for (var i = 0; i < keys.length; i++)
    if (!can_(me, SETTING_AREA[keys[i]])) return refuse_(SETTING_AREA[keys[i]]);
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
    if (k === 'gift_active') v = yes_(v) ? 'yes' : 'no';
    if (k === 'gift_points') v = String(v == null ? '' : v).slice(0, 600);
    if (k === 'games_off') v = gamesOff_(v).join(',');
    if (k === 'qr_builtin') v = yes_(v) ? 'show' : 'hide';
    if (k === 'active_event') v = eventName_(v);
    if (k === 'passcode') v = v.slice(0, 64);
    else if (k === 'gift_products') v = v.slice(0, 2000);
    else v = v.slice(0, 400);
    next[k] = v; changed.push(k);
  });

  var pass = String(next.passcode || '').trim();
  if (next.page_mode === 'locked' && !pass)
    return json_({ ok: false, changed: [], error: 'set a passcode before locking the page' });
  /* a wheel with nothing on it cannot be spun, so it cannot be switched on */
  if (yes_(next.gift_active) && !yes_(now.gift_active) && !wheel_().length)
    return json_({ ok: false, changed: [], error: 'put at least one product in stock before switching the gift on' });
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

  changed.forEach(function (k) { setSetting_(k, k === 'active_event' ? textCell_(next[k]) : next[k], email); });
  /* a different event changes what is locked: make Drive agree before answering */
  var out = { ok: true, changed: changed, settings: settingsFor_(me), public: publicSettings_() };
  if (changed.indexOf('active_event') >= 0) {
    try { syncMedia_(); } catch (e) { out.media_error = String(e && e.message || e); }
    if (can_(me, 'media')) out.media = mediaList_();
  }
  return json_(out);
}

/* ------------------------------------------------------------------- gifts

   Facy Run ends on a QR code once a run scores gift_points. The code is a
   claim: one per device, minted here and written to the Gifts tab. The admin
   scans it with a phone that is signed in to admin.html, and THIS script picks
   the product -- at random, from gift_products -- and writes it against the
   claim in the same call. The wheel on the admin's screen only animates to
   the answer it is handed. So: the device gets one claim, the claim is spent
   once, and nothing on the visitor's side chooses the prize.

   What this cannot do: tell two devices apart if one of them clears its
   storage. The device id lives in the browser, the same way the scores' does.
   A visitor who wipes it looks like a new visitor. */

function giftProducts_(raw) {
  return String(raw == null ? SETTING_KEYS.gift_products : raw)
    .split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 40);
}
function giftTab_() {
  tab_(SpreadsheetApp.openById(SHEET_ID), T_GIFTS, GIFT_HEADERS);
  return headers_(T_GIFTS, GIFT_HEADERS);
}
/* The claim a device holds now: a reset one no longer counts, so the device
   can earn another. */
function giftLive_(rows, device) {
  for (var i = 0; i < rows.length; i++)
    if (String(rows[i].device || '').trim() === device && !rows[i].reset) return rows[i];
  return null;
}

/* ------------------------------------------------------------------- stock */

function stockTab_() {
  var book = SpreadsheetApp.openById(SHEET_ID);
  var fresh = !book.getSheetByName(T_STOCK);
  var sh = tab_(book, T_STOCK, STOCK_HEADERS);
  if (fresh) {
    /* the first time: the products the wheel already had, not counted */
    var t = now_();
    giftProducts_(settings_().gift_products).forEach(function (p) {
      sh.appendRow([cell_(p), '', t, 'the product list before stock']);
    });
  }
  return sh;
}
/* blank is "not counted"; anything else is a whole number, and something
   that is not a number reads as none left -- less on the wheel, not more */
function qty_(v) {
  var s = String(v == null ? '' : v).trim();
  if (s === '') return null;
  var n = Math.floor(Number(s));
  return isFinite(n) && n > 0 ? n : 0;
}
function stock_() {
  stockTab_();
  return rows_(T_STOCK, STOCK_HEADERS).map(function (r) {
    return { product: String(r.product || '').trim(), quantity: qty_(r.quantity), _row: r._row,
             updated: iso_(r.updated), by: String(r.by || '') };
  }).filter(function (x) { return x.product; });
}
function wheel_() {
  return stock_().filter(function (x) { return x.quantity === null || x.quantity > 0; }).slice(0, STOCK_MAX);
}
function stockPublic_() {
  return stock_().map(function (x) {
    return { product: x.product, quantity: x.quantity, on_wheel: x.quantity === null || x.quantity > 0,
             updated: x.updated, by: x.by };
  });
}
function stockFind_(rows, name) {
  var k = String(name || '').trim().toLowerCase();
  for (var i = 0; i < rows.length; i++) if (rows[i].product.toLowerCase() === k) return rows[i];
  return null;
}

/* Body: {action:'admin.stock.set', product, quantity}   -- set the count
         {action:'admin.stock.set', product, add}        -- restock by this many
   Back: {ok:true, stock:[...]}
   add is the safe way to restock while the counter is giving gifts out: a
   count typed from a page loaded ten minutes ago would undo what was handed
   over since. A product not on the list yet is added. */
function stockSet_(b, me) {
  var name = String((b && b.product) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!name) return json_({ ok: false, error: 'enter a product name' });
  var rows = stock_(), row = stockFind_(rows, name), q;
  if (b && 'add' in b) {
    var d = Math.floor(Number(b.add));
    if (!isFinite(d) || !d) return json_({ ok: false, error: 'enter how many to add' });
    if (!row) return json_({ ok: false, error: 'that product is not on the list' });
    q = Math.min(STOCK_MAX_QTY, Math.max(0, (row.quantity || 0) + d));
  } else {
    var raw = String(b.quantity == null ? '' : b.quantity).trim();
    if (raw === '') return json_({ ok: false, error: 'enter how many there are' });
    q = Math.floor(Number(raw));
    if (!isFinite(q) || q < 0 || q > STOCK_MAX_QTY)
      return json_({ ok: false, error: 'enter a count from 0 to ' + STOCK_MAX_QTY });
  }
  var sh = stockTab_(), t = now_();
  if (row) {
    sh.getRange(row._row, 2).setValue(q);
    sh.getRange(row._row, 3).setValue(t);
    sh.getRange(row._row, 4).setValue(me.email);
  } else {
    if (rows.length >= STOCK_MAX) return json_({ ok: false, error: 'the wheel holds ' + STOCK_MAX + ' products at most' });
    sh.appendRow([cell_(name), q, t, me.email]);
  }
  return json_({ ok: true, stock: stockPublic_() });
}
function stockRemove_(b, me) {
  var row = stockFind_(stock_(), b && b.product);
  if (!row) return json_({ ok: false, error: 'that product is not on the list' });
  sheet_(T_STOCK).deleteRow(row._row);
  return json_({ ok: true, stock: stockPublic_() });
}

/* ------------------------------------------------------------------ claims */

function claimsList_() {
  return giftRows_().map(function (r) {
    return { device: String(r.device || ''), game: String(r.game || ''), score: r.score,
             name: String(r.name || ''), created: iso_(r.created), redeemed: iso_(r.redeemed),
             product: String(r.product || ''), by: String(r.by || ''),
             reset: iso_(r.reset), reset_by: String(r.reset_by || '') };
  }).reverse().slice(0, 300);
}
/* Body: {action:'admin.claims.reset', device}
   Let a device earn a gift again. Its rows stay -- the record of what was
   handed out is kept -- and are stamped reset, so the device lookup passes
   over them. A code it had not spent yet dies with the reset: otherwise the
   old QR and a new one would be two gifts. */
function claimsReset_(b, me) {
  var device = String((b && b.device) || '').trim();
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(device)) return json_({ ok: false, error: 'not a device id' });
  var live = giftRows_().filter(function (r) { return String(r.device || '').trim() === device && !r.reset; });
  if (!live.length) return json_({ ok: false, error: 'that device has no gift to reset' });
  var sh = sheet_(T_GIFTS), t = now_();
  live.forEach(function (r) { sh.getRange(r._row, 10).setValue(t); sh.getRange(r._row, 11).setValue(me.email); });
  return json_({ ok: true, reset: live.length, claims: claimsList_() });
}
function giftRows_() {
  /* the tab is made on first use rather than by setUp, so a script deployed
     before gifts existed does not have to be set up again */
  giftTab_();
  return rows_(T_GIFTS, GIFT_HEADERS);
}
function giftFind_(rows, key, val) {
  for (var i = 0; i < rows.length; i++)
    if (String(rows[i][key] || '').trim() === val) return rows[i];
  return null;
}
function giftPublic_(r) {
  return { ok: true, claim: String(r.claim), redeemed: !!r.redeemed,
           product: r.product ? String(r.product) : '' };
}

/* Body: {action:'gift.claim', device, score, game, name}
   Back: {ok:true, claim, redeemed, product} | {ok:false, reason}
   The same device asking twice gets the same claim back, never a second. */
function giftClaim_(b) {
  var all = settings_();
  var active = yes_((('gift_active' in all) ? all.gift_active : SETTING_KEYS.gift_active));
  var needs = giftNeeds_(('gift_points' in all) ? all.gift_points : SETTING_KEYS.gift_points);
  var need = needs[String(b && b.game || '').toLowerCase()];
  /* No figure for this game is not "everything qualifies": it is no gift. */
  if (!need) return json_({ ok: false, reason: 'nogame' });
  if (!active) return json_({ ok: false, reason: 'inactive' });
  /* A game switched off gives nothing, even to a phone that still had it open
     when it went off: the page hiding it is manners, this is the lock. */
  if (gamesOff_(all.games_off).indexOf(String(b.game || '').toLowerCase()) >= 0)
    return json_({ ok: false, reason: 'gameoff' });

  var device = String(b.device || '').trim();
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(device)) return json_({ ok: false, reason: 'device' });
  var score = Math.round(Number(b.score));
  if (!isFinite(score) || score < 0 || score > GIFT_MAX_SCORE) return json_({ ok: false, reason: 'score' });
  if (score < need) return json_({ ok: false, reason: 'short', need: need, score: score });
  var game = String(b.game || 'facy-run').replace(/[^a-z0-9-]/gi, '').slice(0, 24);
  var name = cell_(String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 18));

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json_({ ok: false, reason: 'busy' });
  try {
    var have = giftLive_(giftRows_(), device);
    if (have) return json_(giftPublic_(have));
    /* nothing left to give: no code, rather than one the counter cannot honour */
    if (!wheel_().length) return json_({ ok: false, reason: 'nostock' });
    var claim = Utilities.getUuid();
    sheet_(T_GIFTS).appendRow([claim, device, game, score, name, now_(), '', '', '']);
    return json_({ ok: true, claim: claim, redeemed: false, product: '' });
  } finally { flushSheets_(); lock.releaseLock(); }
}

/* Body: {action:'admin.gift.redeem', token, claim}
   Back: {ok:true, product, index, products, already, score, name}
   Under the admin lock already, from doPost. A claim scanned twice comes back
   with the product it already got, and `already: true`, so a second scan is
   a receipt and not a second prize. */
function giftRedeem_(b, email) {
  var claim = String(b.claim || '').trim();
  if (!validKey_(claim)) return json_({ ok: false, error: 'not a claim code' });
  var row = giftFind_(giftRows_(), 'claim', claim);
  if (!row) return json_({ ok: false, error: 'no such claim' });

  var wheel = wheel_();
  var products = wheel.map(function (x) { return x.product; });
  var attempt = /^[A-Za-z0-9_-]{8,64}$/.test(String(b.attempt || '')) ? String(b.attempt) : '';
  if (row.redeemed) {
    /* The same scan asking again -- its phone lost the first answer in a crowd --
       gets the spin it was given, not "already redeemed", which would have the
       counter turn away a visitor whose gift is real. The product it won may have
       just gone out of stock and off the wheel, so it is put back on the list
       this phone draws. */
    var again = !!attempt && String(row.attempt || '') === attempt;
    var list = products.slice(), idx = list.indexOf(String(row.product));
    if (again && idx < 0) { list.push(String(row.product)); idx = list.length - 1; }
    return json_({ ok: true, already: !again, again: again, product: String(row.product), index: idx,
                   products: again ? list : products, at: row.redeemed, score: row.score, name: String(row.name || '') });
  }
  if (row.reset) return json_({ ok: false, error: 'This code was cancelled when the device was reset. The visitor can play again for a new one.' });
  if (!wheel.length) return json_({ ok: false, error: 'Every product on the wheel is out of stock. Restock it in the admin page.' });

  /* Math.random on the script, not on the phone: the spin is decided here and
     the wheel is told where to stop. Only what is in stock is on the wheel,
     and the one it lands on is taken off the count in the same call. */
  var pick = Math.floor(Math.random() * wheel.length);
  var chosen = wheel[pick], left = null;
  /* one write per tab, not one per cell: the lock is held for as long as this
     takes, and every other counter in the queue waits behind it */
  var sh = sheet_(T_GIFTS);
  sh.getRange(row._row, 7, 1, 3).setValues([[now_(), chosen.product, email]]);
  if (attempt) sh.getRange(row._row, 12, 1, 1).setValues([[attempt]]);
  if (chosen.quantity !== null) {
    left = chosen.quantity - 1;
    sheet_(T_STOCK).getRange(chosen._row, 2, 1, 3).setValues([[left, now_(), email]]);
  }
  return json_({ ok: true, already: false, product: chosen.product, index: pick, left: left,
                 products: products, score: row.score, name: String(row.name || '') });
}

/* ----------------------------------------------------------------- the guide

   The booth page carries a question mark beside the games. Behind it is this:
   how the gift works at the counter, and how the two scripts were set up.

   It is kept here rather than in the page for the reason the top of this file
   gives about locking: the page is a public file, and anything written into it
   can be read by anyone who opens the source, passcode or no passcode. This
   text never reaches a browser that is not holding a live admin session -- an
   address on the Admins tab, signed in on that device.

   Blocks, not markup: the page builds every one of these with text nodes, so
   nothing typed here can turn into HTML there. A *word in stars* comes out
   bold, and that is the whole of the formatting. */

var GUIDE_TITLE = 'Running the booth';

var GUIDE = [
  { t: 'note', s: 'You can read this because this device is signed in as an admin. Visitors cannot open it.' },

  { t: 'h', s: 'At the counter' },
  { t: 'ol', items: [
    'A visitor finishes Facy Run. If the run scored enough, the result screen shows a QR code.',
    'Scan it with the counter phone. The gift page opens and the wheel spins by itself.',
    'It lands on one product. Hand that product over.',
    'The code is now spent. Scanning it again shows the same product marked already redeemed, which is your check against giving a second gift.'
  ] },
  { t: 'p', s: 'The product is picked by the booth script, not by the phone that scans. Nobody at the counter can steer the wheel.' },

  { t: 'h', s: 'The counter phone has to be signed in' },
  { t: 'p', s: 'Once, on that phone: open *my.facerinna.com/scan.html* (or the *Counter* icon on its home screen), enter an address an admin has added under *People* with *Counter* ticked, and type the code that is mailed to it. It stays signed in after that.' },
  { t: 'p', s: 'A phone that is not signed in gets a sign-in card instead of a wheel, and nothing is spent.' },

  { t: 'h', s: 'Turning the gift on, and off' },
  { t: 'p', s: 'In the admin page, under *The gift at the end of a game*:' },
  { t: 'ul', items: [
    '*Gift QR code is on* -- untick it and runs stop showing the QR code. Codes already issued still redeem, so nobody is left holding a dead code.',
    '*What each game has to score* -- 6,000 for Facy Run to begin with. About 14,950 are reachable in a run, so 6,000 asks for a good run, not a perfect one.'
  ] },
  { t: 'p', s: 'A saved change reaches the booth screens within three minutes, or at once if a screen is reopened.' },

  { t: 'h', s: 'The wheel is the stock' },
  { t: 'p', s: 'In the admin page, *Gifts*, then *Stock on the wheel*: one line per product with how many are left. Each gift handed out takes one off that product\'s count.' },
  { t: 'ul', items: [
    'A product at *0* leaves the wheel by itself. Restock it and it is back on the next spin.',
    'Use *Add* to restock (it adds to what is left, so gifts handed out meanwhile are not undone). Use *Set* only to correct a count after counting the boxes.',
    'When every product is at 0 the games stop giving out new codes, so nobody is handed a code the counter cannot honour.',
    'A product showing *not counted* stays on the wheel until you set a number for it.'
  ] },

  { t: 'h', s: 'Letting a device play again' },
  { t: 'p', s: 'One gift per device, until you say otherwise. In the admin page, *Gifts*, then *Claims*: find the visitor by name, game or time, and tap *Let play again*. That device can earn a new gift on its next run.' },
  { t: 'p', s: 'The old row stays in the Gifts tab, marked with when and by whom it was reset. A code that device had not spent yet stops working, so the old QR and a new one cannot be two gifts.' },

  { t: 'h', s: 'QR codes and posters for an event' },
  { t: 'p', s: 'In the admin page, *QR & posters*. Choose the event the booth is running, then upload the picture of each QR code or poster. The page names it for you (for example *qr-agm-penang-whatsapp-01*) and works out from the picture whether it is a QR code or a poster.' },
  { t: 'ul', items: [
    '*Event now* is the one switch. Every code or poster tagged with another event is locked at once: its Drive file goes private and it leaves the page. Switch back and they return.',
    'Each item can also be turned off on its own, moved to another event, or deleted.',
    'Items with no event show at every event.',
    'The three codes written into the page (Registration, More Info, WhatsApp) and Dr. Peter\'s session poster are in the same list, marked *built into the page*. Turn them off or tie them to an event like the rest; they cannot be deleted. Turning the session poster off takes the whole talk section off the page.'
  ] },

  { t: 'h', s: 'One gift per device' },
  { t: 'p', s: 'The limit is per device, not per run. A visitor who plays again on the same phone gets the same code back, already spent. A different phone is a different device, which is the honest limit a booth can hold without asking anyone for a name.' },

  { t: 'h', s: 'Where the records are' },
  { t: 'p', s: 'The scores workbook has a *Gifts* tab, one row per code:' },
  { t: 'table', head: ['Column', 'What it holds'], rows: [
    ['claim', 'the code inside the QR'],
    ['device', 'the browser that earned it'],
    ['game, score, name', 'the run that earned it'],
    ['created', 'when the code was issued'],
    ['redeemed', 'when it was scanned, blank until then'],
    ['product', 'what the wheel gave'],
    ['by', 'which admin scanned it'],
    ['reset, reset_by', 'when the device was let play again, and by whom']
  ] },
  { t: 'p', s: 'The *Gift stock* tab has one row per product: its name and how many are left.' },
  { t: 'p', s: 'To clear a test claim of your own, delete its row.' },

  { t: 'h', s: 'The two scripts, and which is which' },
  { t: 'p', s: 'Only needed when the code changes. Each Apps Script project has exactly one doPost, so pasting a file into the wrong project takes that project\'s feature off the air. Check which one you have open under Deploy, Manage deployments, and read the web app address.' },
  { t: 'table', head: ['File', 'Project', 'Its address starts'], rows: [
    ['booth-scores.gs', 'booth scores', 'AKfycbx4zwb'],
    ['booth-admin.gs', 'booth admin', 'AKfycbyXD0qJ']
  ] },
  { t: 'ol', items: [
    'Open the project, select everything in the editor, delete it, paste the whole file, save.',
    'For booth admin only: Run, then setUp. It adds only what is missing: new tabs, new columns and new settings rows.',
    'Deploy, Manage deployments, the pencil, Version: *New version*, Deploy.'
  ] },
  { t: 'note', s: 'New version, never New deployment. A new deployment mints a different address, and both pages would still be pointing at the old one.' },

  { t: 'h', s: 'Testing it before the doors open' },
  { t: 'ol', items: [
    'Play Facy Run past the points threshold. The QR code appears on the result screen.',
    'Scan it with the counter phone. The wheel spins and lands.',
    'Scan the same code again. No spin, just the receipt.',
    'Delete that row from the Gifts tab afterwards, so a test does not sit in the records.'
  ] }
];

/* A read, so it runs before the lock: nothing here writes. */
function guide_(email) {
  return json_({ ok: true, you: email, title: GUIDE_TITLE, blocks: GUIDE });
}

/* ------------------------------------------------------------------ people

   admin.team.save   {person:{email, name, role, access:[...], active}}
   admin.team.remove {email}
   Back: {ok:true, admins:[...]}

   Admins only. Nobody changes their own row here, and the owner's row is not
   changed here at all: both are what stop a borrowed session from locking the
   owner out or raising itself. Every write stamps updated and by. */
/* A tab from before a column was added has fewer headings; name the new ones
   so the sheet reads properly. A heading somebody changed by hand is kept. */
function headers_(name, headers) {
  var sh = sheet_(name);
  var have = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  headers.forEach(function (h, i) {
    if (!String(have[i] || '').trim()) sh.getRange(1, i + 1).setValue(h);
  });
  return sh;
}
function teamHeaders_() { return headers_(T_ADMINS, ADMIN_HEADERS); }
function teamGuard_(me, email) {
  if (me.role !== 'admin') return json_({ ok: false, reason: 'forbidden', error: 'Only an admin can change who has access.' });
  if (!email) return json_({ ok: false, error: 'enter a valid e-mail address' });
  if (email === me.email) return json_({ ok: false, error: 'You cannot change your own access. Ask another admin.' });
  if (email === owner_()) return json_({ ok: false, error: 'The owner always has full access and is changed only in the sheet.' });
  return null;
}
function teamSave_(b, me) {
  var p = (b && b.person) || {};
  var email = email_(p.email);
  var stop = teamGuard_(me, email); if (stop) return stop;

  var role = String(p.role || '').toLowerCase() === 'admin' ? 'admin' : 'staff';
  var access = [];
  if (role === 'staff') [].concat(p.access || []).forEach(function (k) {
    k = String(k).toLowerCase();
    if (PERM_KEYS.indexOf(k) >= 0 && access.indexOf(k) < 0) access.push(k);
  });
  /* the order PERMS lists them, so the sheet reads the same way every time */
  access.sort(function (a, c) { return PERM_KEYS.indexOf(a) - PERM_KEYS.indexOf(c); });
  var active = (p.active === false || /^(no|n|false|0|off)$/i.test(String(p.active))) ? 'no' : 'yes';

  var sh = teamHeaders_();
  var row = adminRow_(email);
  var t = now_();
  if (row) {
    var name = ('name' in p) ? cell_(String(p.name || '').replace(/\s+/g, ' ').trim().slice(0, 60)) : row.name;
    sh.getRange(row._row, 2).setValue(active);
    sh.getRange(row._row, 3).setValue(name);
    sh.getRange(row._row, 5).setValue(role);
    sh.getRange(row._row, 6).setValue(access.join(', '));
    sh.getRange(row._row, 7).setValue(t);
    sh.getRange(row._row, 8).setValue(me.email);
  } else {
    if (rows_(T_ADMINS, ADMIN_HEADERS).length >= TEAM_MAX)
      return json_({ ok: false, error: 'the list is full (' + TEAM_MAX + ' people)' });
    sh.appendRow([email, active, cell_(String(p.name || '').replace(/\s+/g, ' ').trim().slice(0, 60)),
                  t, role, access.join(', '), t, me.email]);
  }
  return json_({ ok: true, admins: teamList_() });
}
function teamRemove_(b, me) {
  var email = email_(b && b.email);
  var stop = teamGuard_(me, email); if (stop) return stop;
  var row = adminRow_(email);
  if (!row) return json_({ ok: false, error: 'that address is not on the list' });
  sheet_(T_ADMINS).deleteRow(row._row);
  return json_({ ok: true, admins: teamList_() });
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
    if (action === 'code')    return codeRequest_(b);
    if (action === 'redeem')  return codeRedeem_(b);
    if (action === 'gift.claim') return giftClaim_(b);

    /* the admin ones: every write takes the lock */
    if (action.indexOf('admin.') !== 0) return json_({ ok: false, error: 'unknown action' });
    var me = auth_(b);
    if (!me) return json_({ ok: false, error: 'signed out' });
    var email = me.email;
    if (ACTION_AREA[action] && !can_(me, ACTION_AREA[action])) return refuse_(ACTION_AREA[action]);
    if (action === 'admin.get') return adminGet_(me);
    if (action === 'admin.guide') return guide_(email);

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return json_({ ok: false, error: 'busy, try again' });
    try {
      switch (action) {
        case 'admin.settings':        return adminSettings_(b, me);
        case 'admin.segment.save':    return saveSegment_(b, email);
        case 'admin.segment.delete':  return deleteSegment_(b, email);
        case 'admin.segment.order':   return orderSegments_(b, email);
        case 'admin.media.upload':    return mediaUpload_(b, email);
        case 'admin.media.set':       return mediaSet_(b, email);
        case 'admin.media.delete':    return mediaDelete_(b, email);
        case 'admin.section.set':     return setSection_(b, email);
        case 'admin.gift.redeem':     return giftRedeem_(b, email);
        case 'admin.team.save':       return teamSave_(b, me);
        case 'admin.stock.set':       return stockSet_(b, me);
        case 'admin.stock.remove':    return stockRemove_(b, me);
        case 'admin.claims.reset':    return claimsReset_(b, me);
        case 'admin.team.remove':     return teamRemove_(b, me);
        default: return json_({ ok: false, error: 'unknown action' });
      }
    } finally {
      /* Whatever was just saved, the next phone to ask must see it. Dropped
         before the lock is let go, so no reader can refill it with the old
         sheet in between. */
      dropConfig_();
      flushSheets_();
      lock.releaseLock();
    }
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
