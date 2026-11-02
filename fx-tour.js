/* FACERINNA booth -- the tournament.
 *
 * One run through several games, easiest first. The admin page picks which
 * games are in (tour_games) and switches it on (tour_active); the order is
 * always the one below, so a visitor never meets the hardest game first.
 *
 *   tournament.html          the lobby: the rounds, the start, the total
 *   <game page>?tour=RUN     a round: this file turns the page into one
 *
 * Loaded on every scored game page BEFORE fx-rank.js and fx-gift.js. On a
 * page opened without ?tour= it does nothing at all, so the games play as
 * they always have.
 *
 * In a round it:
 *   - shows "Tournament · Game 2 of 5" at the top,
 *   - takes away Redeem gift (a round is Normal play; the gift belongs to
 *     the game played on its own),
 *   - books the score the moment the game's result screen comes up -- the
 *     same hidden -> shown edge fx-rank.js listens for -- once, so a replay
 *     cannot better it,
 *   - and puts a card over the result with the points and the way on.
 *
 * Points: every game scores on its own scale (six thousand is a good run of
 * Facy Run, a few hundred of Pack Match), so a round is turned into tournament
 * points. The admin sets the most a game can give (tour_points, 1,500 where
 * none is set). Reaching the game's target -- its gift points in Admin, or
 * 1,000 where it has none -- earns two thirds of that, and one and a half times
 * the target earns all of it.
 *
 * The winner: the most points. On a tie, the fastest (the least total time
 * spent playing the rounds). Then the highest level (the levels reached in each
 * round, added up). The time and the levels are kept with every round and sent
 * with the total.
 *
 * The run lives in localStorage on this device for an hour from its last
 * round, so a kiosk left mid-run does not hand a stranger somebody's score.
 */
(function () {
  'use strict';

  /* Easy to hard. [id, name, page, level] */
  var ORDER = [
    ['magic-tiles',   'Magic Tiles',   'magic-tiles-4k.html',   'Easy'],
    ['pack-match',    'Pack Match',    'pack-match.html',       'Easy'],
    ['match-factory', 'Match Factory', 'match-factory-4k.html', 'Easy'],
    ['pack-slicer',   'Pack Slicer',   'pack-slicer-4k.html',   'Medium'],
    ['match-lab',     'Match Lab',     'match-lab.html',        'Medium'],
    ['pack-crush',    'Pack Crush',    'pack-crush-4k.html',    'Medium'],
    ['shelf-shot',    'Shelf Shot',    'shelf-shot.html',       'Medium'],
    ['pack-recall',   'Pack Recall',   'pack-recall-4k.html',   'Hard'],
    ['pack-drop',     'Pack Drop',     'pack-drop-4k.html',     'Hard'],
    ['deep-lab',      'Deep Lab',      'deep-lab.html',         'Hard'],
    ['lab-run',       'Lab Run',       'lab-run.html',          'Hard'],
    ['facy-run',      'Facy Run',      'facy-run.html',         'Hard']
  ];
  var KEY = 'fx.tour', LIFE = 60 * 60 * 1000, MAX = 1500, CAP = 1.5, PAR = 1000;

  function row(id) { for (var i = 0; i < ORDER.length; i++) if (ORDER[i][0] === id) return ORDER[i]; return null; }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

  function load() {
    var s = null;
    try { s = JSON.parse(read(KEY) || 'null'); } catch (e) {}
    if (!s || !s.run || !s.games || !s.games.length) return null;
    if (Date.now() - (s.at || 0) > LIFE) return null;
    return s;
  }
  function save(s) { s.at = Date.now(); write(KEY, JSON.stringify(s)); return s; }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }

  /* The games a setting names, in the tournament's order, less any that are off. */
  function pick(raw, off) {
    var want = String(raw || '').toLowerCase().split(/[^a-z0-9-]+/);
    var gone = String(off || '').toLowerCase().split(/[^a-z0-9-]+/);
    return ORDER.filter(function (g) { return want.indexOf(g[0]) >= 0 && gone.indexOf(g[0]) < 0; })
                .map(function (g) { return g[0]; });
  }
  /* max: the most this game can give; its target (par) earns two thirds of it, and CAP times the target all of it */
  function points(raw, par, max) {
    par = par > 0 ? par : PAR; max = max > 0 ? max : MAX;
    return Math.max(0, Math.round(max * Math.min(1, (raw || 0) / (par * CAP))));
  }
  function start(games, needs, maxes, dflt) {
    var pars = {}, mx = {};
    games.forEach(function (id) {
      var n = needs && +needs[id]; pars[id] = n > 0 ? n : PAR;
      var m = maxes && +maxes[id]; mx[id] = m > 0 ? m : (dflt > 0 ? dflt : MAX);
    });
    var run = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return save({ run: run, games: games.slice(), pars: pars, maxes: mx, i: 0, raw: [], pts: [], secs: [], lvl: [] });
  }
  function sum(a) { return (a || []).reduce(function (x, y) { return x + (y || 0); }, 0); }
  function total(s) { return sum(s.pts); }
  function totalSecs(s) { return sum(s.secs); }
  function totalLevel(s) { return sum(s.lvl); }
  function mmss(sec) { sec = Math.max(0, Math.round(sec || 0)); var m = Math.floor(sec / 60), r = sec % 60; return m + ':' + (r < 10 ? '0' : '') + r; }
  /* the level the run reached, read from the game when its result comes up: the newer games say
     it in their snapshot, the older ones through fx-modes; a game with no levels counts as 1 */
  function levelNow() {
    try {
      var m = window.__fxModes && __fxModes.snapshot && __fxModes.snapshot();
      if (m && m.level > 0) return Math.floor(m.level);
    } catch (e) {}
    var hooks = ['__magictiles', '__packslicer', '__matchfactory', '__packcrush', '__packdrop', '__packrecall'];
    for (var i = 0; i < hooks.length; i++) {
      try { var s = window[hooks[i]] && window[hooks[i]].snapshot && window[hooks[i]].snapshot(); if (s && s.level > 0) return Math.floor(s.level); } catch (e) {}
    }
    return 1;
  }
  function urlFor(s) {
    return s.i < s.games.length ? row(s.games[s.i])[2] + '?tour=' + s.run : 'tournament.html?tour=' + s.run;
  }

  window.fxTour = {
    ORDER: ORDER, MAX: MAX, CAP: CAP, PAR: PAR,
    load: load, save: save, clear: clear, pick: pick, points: points, start: start, total: total, urlFor: urlFor,
    totalSecs: totalSecs, totalLevel: totalLevel, mmss: mmss, levelNow: levelNow,
    maxOf: function (s, id) { var m = s && s.maxes && +s.maxes[id]; return m > 0 ? m : MAX; },
    nameOf: function (id) { var r = row(id); return r ? r[1] : id; },
    pageOf: function (id) { var r = row(id); return r ? r[2] : null; },
    levelOf: function (id) { var r = row(id); return r ? r[3] : ''; }
  };

  /* ---- a round --------------------------------------------------------- */

  var R = window.FX_RANK;
  if (!R || !R.id || R.id === 'tournament' || !R.result) return;
  var q = null;
  try { q = new URLSearchParams(location.search).get('tour'); } catch (e) {}
  if (!q) return;
  var s = load();
  if (!s || s.run !== q || s.games[s.i] !== R.id) return;

  var idx = s.i, n = s.games.length;
  window.__fxTourRound = { run: s.run, game: R.id, round: idx + 1, of: n };
  /* no gift offer on a round: fx-gift.js asks this before it offers one */
  window.FX_GIFT = window.FX_GIFT || {};
  window.FX_GIFT.giftGate = function () { return false; };

  var css = document.createElement('style');
  css.textContent =
    '#fxTourBar{position:fixed;top:calc(env(safe-area-inset-top,0px) + 8px);left:50%;transform:translateX(-50%);' +
      'z-index:2147482000;pointer-events:none;white-space:nowrap;padding:.45em 1.2em;border-radius:999px;' +
      'background:linear-gradient(180deg,#ffe28a,#ffb12e);color:#3a2300;' +
      'font:700 clamp(12px,1.6vmin,30px)/1.2 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
      'box-shadow:0 6px 22px rgba(255,170,40,.35)}' +
    '#fxTour{position:fixed;inset:0;z-index:2147482500;display:flex;align-items:center;justify-content:center;' +
      'padding:20px;background:radial-gradient(circle at 50% 40%,rgba(6,28,56,.88),rgba(3,10,24,.97));' +
      'color:#eef8ff;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center;' +
      'opacity:0;transition:opacity .35s ease}' +
    '#fxTour.on{opacity:1}' +
    '#fxTour .ft{width:min(92vw,clamp(320px,46vmin,900px))}' +
    '#fxTour .ft-cap{margin:0;letter-spacing:.3em;text-transform:uppercase;font-weight:700;color:#ffd98a;font-size:clamp(11px,1.5vmin,28px)}' +
    '#fxTour h2{margin:.35em 0 .6em;font-family:Fraunces,Georgia,serif;font-weight:600;font-size:clamp(24px,4.4vmin,84px);line-height:1.1}' +
    '#fxTour .ft-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:.55em 0;' +
      'border-top:1px solid rgba(160,215,255,.16);font-size:clamp(14px,2vmin,38px)}' +
    '#fxTour .ft-row span{color:#9cc0d8;font-weight:600;letter-spacing:.04em}' +
    '#fxTour .ft-row b{font-variant-numeric:tabular-nums;font-size:1.25em}' +
    '#fxTour .ft-row.tot b{color:#ffe08a;font-size:1.5em}' +
    '#fxTour .ft-go{display:inline-block;margin-top:1.1em;min-height:48px;box-sizing:border-box;padding:.95em 2em;' +
      'border-radius:999px;text-decoration:none;font-weight:800;font-size:clamp(15px,2.2vmin,42px);' +
      'background:linear-gradient(180deg,#6fd2ff,#2fa6e6);color:#031d33;box-shadow:0 8px 0 #1a77ad,0 18px 40px rgba(31,150,225,.4)}' +
    '#fxTour .ft-go.end{background:linear-gradient(180deg,#ffe28a,#ffb12e);color:#3a2300;box-shadow:0 8px 0 #c47a08,0 18px 40px rgba(255,170,40,.4)}' +
    '#fxTour .ft-lv{display:inline-block;margin-left:.5em;padding:.1em .6em;border-radius:999px;font-size:.7em;' +
      'background:rgba(255,255,255,.14);vertical-align:middle}' +
    '#fxTour :focus-visible{outline:3px solid #ffe183;outline-offset:3px}' +
    '.fx-tour-on #goGift,.fx-tour-on #giftNote{display:none!important}';
  document.head.appendChild(css);
  document.documentElement.classList.add('fx-tour-on');

  var bar = document.createElement('div');
  bar.id = 'fxTourBar';
  bar.setAttribute('aria-live', 'polite');
  bar.textContent = '\u{1F3C6} Tournament · Game ' + (idx + 1) + ' of ' + n + ' · ' + fmt(total(s)) + ' pts';
  document.body.appendChild(bar);

  var resultEl = document.querySelector(R.result);
  if (!resultEl) return;
  var booked = false;
  /* the clock for this round: from the page opening, and restarted when Normal play is pressed, so the time
     spent reading the start screen is not held against anybody */
  var t0 = Date.now();
  document.addEventListener('click', function (e) { var b = e.target && e.target.closest && e.target.closest('#goPlay'); if (b) t0 = Date.now(); }, true);

  function scoreNow() {
    var el = R.score && document.querySelector(R.score);
    if (!el) return null;
    var v = parseInt(String(el.textContent).replace(/[^0-9-]/g, ''), 10);
    return isNaN(v) ? null : Math.max(0, v);
  }

  function book() {
    if (booked) return;
    var raw = scoreNow();
    if (raw === null) return;
    var now = load();
    /* the run moved on in another tab, or ran out: this page is no longer a round */
    if (!now || now.run !== s.run || now.i !== idx) return;
    booked = true;
    var pts = points(raw, now.pars && now.pars[R.id], now.maxes && now.maxes[R.id]);
    var secs = Math.max(1, Math.round((Date.now() - t0) / 1000)), lvl = levelNow();
    now.raw[idx] = raw; now.pts[idx] = pts; now.secs = now.secs || []; now.lvl = now.lvl || [];
    now.secs[idx] = secs; now.lvl[idx] = lvl; now.i = idx + 1;
    save(now);
    bar.textContent = '\u{1F3C6} Tournament · Game ' + (idx + 1) + ' of ' + n + ' · ' + fmt(total(now)) + ' pts';
    setTimeout(function () { card(now, raw, pts, secs, lvl); }, 1300);
  }

  function card(now, raw, pts, secs, lvl) {
    var last = now.i >= now.games.length;
    var box = document.createElement('div');
    box.id = 'fxTour';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'fxTourT');
    var ft = document.createElement('div'); ft.className = 'ft';
    var cap = document.createElement('p'); cap.className = 'ft-cap';
    cap.textContent = 'Tournament · Game ' + (idx + 1) + ' of ' + n;
    var h = document.createElement('h2'); h.id = 'fxTourT';
    h.textContent = fxTour.nameOf(R.id) + ' done';
    ft.appendChild(cap); ft.appendChild(h);
    [['Score', fmt(raw), ''], ['Tournament points', '+' + fmt(pts) + ' of ' + fmt(fxTour.maxOf(now, R.id)), ''], ['Time \u00B7 level', mmss(secs) + ' \u00B7 L' + lvl, ''], ['Total so far', fmt(total(now)), 'tot']]
      .forEach(function (r) {
        var d = document.createElement('div'); d.className = 'ft-row' + (r[2] ? ' ' + r[2] : '');
        var a = document.createElement('span'); a.textContent = r[0];
        var b = document.createElement('b'); b.textContent = r[1];
        d.appendChild(a); d.appendChild(b); ft.appendChild(d);
      });
    var go = document.createElement('a');
    go.className = 'ft-go' + (last ? ' end' : '');
    go.href = urlFor(now);
    if (last) go.textContent = 'See my tournament result ▶';
    else {
      var nx = now.games[now.i];
      go.textContent = 'Next: ' + fxTour.nameOf(nx) + ' ▶';
      var lv = document.createElement('span'); lv.className = 'ft-lv'; lv.textContent = fxTour.levelOf(nx);
      go.appendChild(lv);
    }
    ft.appendChild(go);
    box.appendChild(ft);
    document.body.appendChild(box);
    requestAnimationFrame(function () { box.classList.add('on'); });
    try { go.focus({ preventScroll: true }); } catch (e) {}
    window.__fxTourDone = { raw: raw, pts: pts, next: go.getAttribute('href') };
  }

  var wasHidden = resultEl.classList.contains('hidden');
  new MutationObserver(function () {
    var isHidden = resultEl.classList.contains('hidden');
    /* the score is written as the screen shows; read it a beat later */
    if (wasHidden && !isHidden) setTimeout(book, 150);
    wasHidden = isHidden;
  }).observe(resultEl, { attributes: true, attributeFilter: ['class'] });
})();
