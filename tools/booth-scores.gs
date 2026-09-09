/* FACERINNA booth scoreboard — the Apps Script behind the ranking popup.
 *
 * WHAT IT IS FOR
 *   The five arcade games keep their scores in localStorage, so a booth iPad
 *   builds its own board and a visitor's phone builds a different one. Nobody
 *   can see anybody else. This is the shared board: every finished run posts
 *   here, and every popup reads the same rows back, whatever device played.
 *
 *   The sheet IS the admin panel. There is deliberately no admin API and no
 *   token: everything an organiser needs — see all runs, hide a joke name,
 *   delete a cheat, export the winners — is done by opening the sheet. An
 *   admin endpoint would have to carry a secret, and the only place to put a
 *   secret on a static page is in the page, where it is not a secret.
 *
 * ===================================================================
 *  NEVER PASTE THIS INTO AN APPS SCRIPT PROJECT THAT ALREADY HAS ONE
 * ===================================================================
 *
 *   A project has exactly one doPost and one doGet. Pasting this beside
 *   another web app REPLACES them, and re-deploying that deployment takes the
 *   old one off the air at the URL it has always answered on.
 *
 *   That is not hypothetical. This file went into the events REGISTRATION
 *   project on 9 Sept and broke registration the night before the PDM AGM:
 *   every submission came back "We could not send that", because this script
 *   was answering registration posts with {"ok":false,"error":"unknown game"}.
 *   Recovery was Deploy -> Manage deployments -> pencil -> Version: (the one
 *   before), Deploy — deployments pin a code snapshot, so rolling the version
 *   back restores the old behaviour at the same URL.
 *
 *   This gets its OWN project. Always.
 *
 * SET UP  (five minutes, and it must be you — the deployment is tied to your
 *          Google account and cannot be created from outside)
 *
 *   1. script.google.com -> New project.  NOT Extensions -> Apps Script from
 *      a sheet that already has a script on it. A standalone project can open
 *      any sheet by id, which is how one workbook holds the scores and the
 *      registrations side by side without the two scripts ever meeting.
 *   2. Delete the stub, paste this whole file.
 *   3. Put the workbook's id in SHEET_ID below — the long string between /d/
 *      and /edit in its address. Leave it blank ONLY if you made this from
 *      Extensions -> Apps Script on a sheet that has no other script.
 *   4. Run -> setUp once. It builds the Scores tab with its headers and frozen
 *      row, beside whatever tabs are already there. Grant the permissions it
 *      asks for. You only ever do this once.
 *   5. Deploy -> New deployment -> type Web app.
 *        Execute as:        Me
 *        Who has access:    Anyone            <-- must be Anyone, not "Anyone
 *                                                 with Google account", or a
 *                                                 visitor's browser is asked
 *                                                 to sign in and the post dies
 *   6. Copy the /exec URL. That is what goes into fx-rank.js. Check it is a
 *      DIFFERENT string from any URL already in this repository before you
 *      hand it over — an identical one means step 1 went wrong.
 *
 *   Re-deploy after ANY edit to this file: Deploy -> Manage deployments ->
 *   the pencil -> Version: New version. Editing alone changes nothing that is
 *   live, which is the single most common way to spend an hour confused.
 *
 * THE ONE TRAP ON THE PAGE SIDE
 *   Post the body with NO Content-Type header. fetch then sends
 *   text/plain;charset=UTF-8, which is a "simple" request and skips the CORS
 *   preflight. Set application/json and the browser sends OPTIONS first, Apps
 *   Script does not answer OPTIONS, and every post fails with a CORS error
 *   that says nothing about the cause. The events registration endpoint on
 *   this same site already works exactly this way.
 *
 * WHAT THIS CANNOT DO
 *   It cannot stop someone posting a made-up score. The endpoint is public and
 *   the page is readable, so anyone who can read the code can imitate its
 *   requests. The checks below reject the careless — impossible numbers, a
 *   flood from one name, a game id that does not exist — and that is the
 *   honest limit of it. If a prize turns on the top score, an organiser should
 *   see the winning run happen. Better to know that now than after.
 */

/* ------------------------------------------------------------------ config */

/* The workbook to write into: the long string between /d/ and /edit in its
   address. A standalone script has nothing bound to it, so this is how one
   workbook can hold the scores and the event registrations in separate tabs
   while their two scripts stay entirely separate projects.

   Blank falls back to the bound sheet, which only works if this project was
   made from Extensions -> Apps Script on a sheet that had no script already.
   Read the warning at the top of this file before choosing that. */
var SHEET_ID = '1J9QAO7PUO4caLhDBsKMGZ5tofv4Gqy5-QSVlo_hBEso';
var TAB      = 'Scores';

/* The five games, by the id each game page declares in window.FX_RANK. A post
   naming anything else is refused: it is either a typo or somebody poking, and
   neither belongs in the board. */
var GAMES = {
  'match-lab':  { name: 'Match Lab',  max: 100000 },
  'pack-match': { name: 'Pack Match', max: 100000 },
  'shelf-shot': { name: 'Shelf Shot', max: 100000 },
  'deep-lab':   { name: 'Deep Lab',   max: 100000 },
  'lab-run':    { name: 'Lab Run',    max: 100000 }
};

/* Ceilings start generous on purpose. Watch the real scores for an hour, then
   tighten each `max` to something a good run cannot reach — that single number
   is the most useful anti-nonsense control here, and it costs one re-deploy. */

var NAME_MAX   = 18;   /* matches the name field's maxlength on the game pages */
var KEEP       = 500;  /* rows read back per game; the sheet keeps everything  */
var RATE_N     = 12;   /* posts allowed per name+game ...                      */
var RATE_SECS  = 60;   /* ... per this many seconds                            */

var HEADERS = ['when', 'ts', 'game', 'name', 'score', 'device', 'hidden', 'agent'];

/* ------------------------------------------------------------------- setup */

function setUp() {
  var sh = tab_();
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.setColumnWidth(1, 165);
    sh.hideColumns(2);                       /* epoch ms: for tie-breaks, not reading */
    sh.hideColumns(8);                       /* user agent: for spotting a bot        */
  }
  return 'Ready. Tab "' + TAB + '" has ' + (sh.getLastRow() - 1) + ' score row(s).';
}

function tab_() {
  var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActive();
  if (!ss) throw new Error('No spreadsheet. Bind this script to a Sheet, or set SHEET_ID.');
  return ss.getSheetByName(TAB) || ss.insertSheet(TAB);
}

/* --------------------------------------------------------------- responses */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------------------------------------------------------- reading */

/*  ?game=match-lab&top=5   one game
 *  ?all=1&top=5            all five in one request — what the booth's combined
 *                          board wants, so it makes one call instead of five
 */
function doGet(e) {
  try {
    var p   = (e && e.parameter) || {};
    var top = Math.min(parseInt(p.top, 10) || 5, 50);

    if (p.all) {
      var all = {};
      var rows = readAll_();
      for (var id in GAMES) all[id] = bests_(rows[id] || []).slice(0, top);
      return json_({ ok: true, games: all, at: Date.now() });
    }

    var id = String(p.game || '');
    if (!GAMES[id]) return json_({ ok: false, error: 'unknown game' });
    var one = bests_((readAll_()[id]) || []);
    return json_({ ok: true, game: id, rows: one.slice(0, top), players: one.length, at: Date.now() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* Every visible row, bucketed by game. One read of the whole sheet, because
   getValues() once is far cheaper than five filtered reads. */
function readAll_() {
  var sh = tab_();
  var last = sh.getLastRow();
  var out = {};
  if (last < 2) return out;

  var vals = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (r[6] === true || String(r[6]).toUpperCase() === 'TRUE') continue;  /* hidden */
    var id = String(r[2]);
    if (!GAMES[id]) continue;
    (out[id] = out[id] || []).push({
      n: String(r[3]),
      s: Number(r[4]),
      t: Number(r[1]) || 0
    });
  }
  return out;
}

/* One row per person, their best run — the same rule the page already applies,
   so the popup and the sheet can never tell different stories. Ties go to the
   earlier run, which is how the page has always broken them. */
function bests_(rows) {
  var seen = {}, out = [];
  rows.filter(function (r) { return r && isFinite(r.s) && r.n; })
      .sort(function (a, b) { return b.s - a.s || a.t - b.t; })
      .forEach(function (r) {
        var k = r.n.toLowerCase();
        if (seen[k]) return;
        seen[k] = 1;
        out.push(r);
      });
  return out.slice(0, KEEP);
}

/* ---------------------------------------------------------------- writing */

/* Body: {"game":"match-lab","name":"Ahmad","score":1234,"device":"a1b2c3"}
 * Back: {"ok":true,"rank":3,"best":1234,"players":27,"rows":[...]}
 *
 * The reply carries the board so a finished run is one round trip, not two:
 * at a booth the popup opens the moment the game ends and there is no second
 * gap to hide a fetch in.
 */
function doPost(e) {
  try {
    var body = {};
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
    catch (bad) { return json_({ ok: false, error: 'bad json' }); }

    var id = String(body.game || '');
    if (!GAMES[id]) return json_({ ok: false, error: 'unknown game' });

    var name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
    if (!name) return json_({ ok: false, error: 'no name' });

    var score = Number(body.score);
    if (!isFinite(score) || Math.floor(score) !== score)
      return json_({ ok: false, error: 'score must be a whole number' });
    if (score < 0 || score > GAMES[id].max)
      return json_({ ok: false, error: 'score out of range' });

    if (!underRate_(id, name))
      return json_({ ok: false, error: 'too many runs too quickly — wait a moment' });

    /* Two people finishing at the same instant both read the same last row and
       one write lands on top of the other. The lock is the whole reason the
       board can be trusted at a busy booth. */
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var now = new Date();
      tab_().appendRow([
        now,
        now.getTime(),
        id,
        name,
        score,
        String(body.device || '').slice(0, 40),
        false,
        String((e && e.postData && e.postData.type) || '') +
          ' ' + String(body.ua || '').slice(0, 120)
      ]);
    } finally {
      lock.releaseLock();
    }

    var rows = bests_((readAll_()[id]) || []);
    var rank = null, best = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].n.toLowerCase() === name.toLowerCase()) { rank = i + 1; best = rows[i].s; break; }
    }
    return json_({ ok: true, rank: rank, best: best, players: rows.length, rows: rows.slice(0, 5) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* A booth run takes the better part of a minute, so a dozen posts from one
   name inside sixty seconds is not somebody playing. Cache-based, so it costs
   no sheet reads and forgets by itself. */
function underRate_(game, name) {
  var cache = CacheService.getScriptCache();
  var key = 'r:' + game + ':' + name.toLowerCase();
  var n = parseInt(cache.get(key), 10) || 0;
  if (n >= RATE_N) return false;
  cache.put(key, String(n + 1), RATE_SECS);
  return true;
}

/* ------------------------------------------------------------ maintenance */

/* Run from the editor when the board should start clean — the morning of a
   show, say. It hides rather than deletes: the runs stay in the sheet, out of
   the board, and a mistake is one un-tick away. */
function hideAllSoFar() {
  var sh = tab_();
  var last = sh.getLastRow();
  if (last < 2) return 'Nothing to hide.';
  sh.getRange(2, 7, last - 1, 1).setValue(true);
  return 'Hid ' + (last - 1) + ' row(s). The board is now empty; the runs are still here.';
}

/* What the board looks like right now, printed in the editor — a way to check
   the script without opening the booth page. */
function preview() {
  var rows = readAll_();
  var out = [];
  for (var id in GAMES) {
    var b = bests_(rows[id] || []).slice(0, 5);
    out.push(GAMES[id].name + ': ' + (b.length
      ? b.map(function (r, i) { return (i + 1) + '. ' + r.n + ' ' + r.s; }).join('  |  ')
      : '(no scores yet)'));
  }
  Logger.log(out.join('\n'));
  return out.join('\n');
}
