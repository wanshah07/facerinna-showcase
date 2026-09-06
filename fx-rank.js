/* Booth ranking — name first, score after.
 *
 * The five games are separate pages with their own loops and their own ids, so
 * this attaches from the outside and touches none of them: it reads the score
 * the game already prints on its result screen, and watches that screen's own
 * `hidden` class to know a run just ended. Each game only declares where those
 * two things are, in FX_RANK, before loading this file.
 *
 * The board lives in localStorage, so a booth iPad builds its own leaderboard
 * through the day with nothing to host and nothing to go down. It is per
 * browser and per game — that is the point at a booth, not a limitation.
 */
(function () {
  var CFG = window.FX_RANK;
  if (!CFG) return;

  var NAME_KEY = 'fx.player';
  var BOARD_KEY = 'fx.rank.' + CFG.id;
  var TOP = 5;

  /* Every read and write is wrapped: private windows and locked-down browsers
     throw on localStorage rather than returning null, and a booth game must
     still play if the board cannot be kept. */
  function read(key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function board() {
    try { return JSON.parse(read(BOARD_KEY, '[]')) || []; } catch (e) { return []; }
  }

  var player = read(NAME_KEY, '');

  var css = document.createElement('style');
  css.textContent =
    '.fxr-gate{position:fixed;inset:0;z-index:70;display:flex;flex-direction:column;' +
      'justify-content:center;align-items:center;text-align:center;padding:24px;' +
      'background:linear-gradient(180deg,rgba(8,22,34,.82),rgba(8,22,34,.96));' +
      'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}' +
    '.fxr-gate.hidden{display:none}' +
    '.fxr-eyebrow{font-size:11px;letter-spacing:.42em;text-transform:uppercase;' +
      'font-weight:800;color:#54C1F5;margin:0 0 10px}' +
    '.fxr-title{font-size:26px;font-weight:800;color:#fff;margin:0 0 6px;letter-spacing:-.01em}' +
    '.fxr-sub{font-size:14px;line-height:1.55;color:rgba(255,255,255,.72);font-weight:600;' +
      'max-width:340px;margin:0 0 20px}' +
    '.fxr-in{font:inherit;font-size:17px;font-weight:700;text-align:center;width:min(320px,86vw);' +
      'padding:15px 18px;border-radius:14px;border:2px solid rgba(255,255,255,.22);' +
      'background:rgba(255,255,255,.10);color:#fff;outline:none}' +
    '.fxr-in::placeholder{color:rgba(255,255,255,.42);font-weight:600}' +
    '.fxr-in:focus{border-color:#54C1F5;background:rgba(255,255,255,.16)}' +
    '.fxr-go{margin-top:16px;border:0;cursor:pointer;font:inherit;font-weight:800;' +
      'letter-spacing:.05em;background:#2CA9F0;color:#fff;padding:15px 42px;border-radius:99px;' +
      'font-size:16px;box-shadow:0 6px 0 #1B87C6,0 14px 26px rgba(10,84,128,.28)}' +
    '.fxr-go:active{transform:translateY(4px);box-shadow:0 2px 0 #1B87C6}' +
    '.fxr-go[disabled]{opacity:.45;cursor:not-allowed;box-shadow:0 6px 0 #1B87C6}' +
    '.fxr-err{margin:12px 0 0;font-size:13px;font-weight:700;color:#FFD9D4;min-height:18px}' +
    /* the panel that lands on the game's own result screen */
    '.fxr-board{width:min(380px,88vw);margin:18px auto 4px;text-align:left;' +
      'background:rgba(255,255,255,.10);border-radius:16px;padding:14px 16px}' +
    '.fxr-board h3{margin:0 0 10px;font-size:11px;letter-spacing:.32em;text-transform:uppercase;' +
      'font-weight:800;color:#9FD8FF}' +
    '.fxr-row{display:flex;align-items:center;gap:10px;padding:7px 0;font-weight:700;' +
      'font-size:14px;color:rgba(255,255,255,.86);border-top:1px solid rgba(255,255,255,.10)}' +
    '.fxr-row:first-of-type{border-top:0}' +
    '.fxr-row.me{color:#fff}' +
    '.fxr-pos{flex:none;width:22px;font-size:12px;color:rgba(255,255,255,.5);font-weight:800}' +
    '.fxr-row.me .fxr-pos{color:#54C1F5}' +
    '.fxr-nm{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.fxr-sc{flex:none;font-variant-numeric:tabular-nums}' +
    '.fxr-note{margin:10px 0 0;font-size:12px;font-weight:700;color:rgba(255,255,255,.55)}' +
    /* bottom-left: the games keep their score and their pause cluster in the
       top corners and their own buttons in the middle, so this corner is the
       one that is free in all five */
    /* above the name gate (z-index 70) on purpose: someone who opens a game by
       mistake, or does not want to give a name, must still have a way out */
    '.fxr-back{position:fixed;left:14px;bottom:14px;z-index:75;border:0;cursor:pointer;' +
      'font:inherit;font-weight:800;font-size:13px;letter-spacing:.04em;' +
      'padding:10px 16px;border-radius:99px;color:#EAF6FF;' +
      'background:rgba(8,22,34,.62);border:1.5px solid rgba(255,255,255,.22);' +
      '-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}' +
    '.fxr-back:hover{background:rgba(8,22,34,.82)}' +
    '.fxr-back:active{transform:translateY(2px)}';
  document.head.appendChild(css);

  /* ---- name gate ------------------------------------------------------- */

  var gate = document.createElement('div');
  gate.className = 'fxr-gate';
  gate.innerHTML =
    '<p class="fxr-eyebrow">FACERINNA Booth</p>' +
    '<h2 class="fxr-title">' + (CFG.name || 'Ready to play') + '</h2>' +
    '<p class="fxr-sub">Enter your name so your score joins the booth ranking.</p>' +
    '<input class="fxr-in" id="fxrName" type="text" maxlength="18" autocomplete="off" ' +
      'autocapitalize="words" spellcheck="false" placeholder="Your name">' +
    '<p class="fxr-err" id="fxrErr"></p>' +
    '<button class="fxr-go" id="fxrGo">Continue</button>';
  document.body.appendChild(gate);

  var input = gate.querySelector('#fxrName');
  var go = gate.querySelector('#fxrGo');
  var err = gate.querySelector('#fxrErr');
  input.value = player;

  function submit() {
    var v = (input.value || '').trim().replace(/\s+/g, ' ');
    if (!v) { err.textContent = 'Please enter a name first.'; input.focus(); return; }
    player = v;
    write(NAME_KEY, player);
    gate.classList.add('hidden');
  }
  go.addEventListener('click', submit);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });

  /* Every game binds its controls to document in the bubble phase — m mutes,
     w/a/d move, space acts — and those handlers swallowed the very letters
     people were trying to type: "Ahmad" arrived as "Ahd". Stopping the event
     at the field keeps it from ever reaching document, and stopPropagation
     does not affect the other listener on this same element, so Enter still
     submits. */
  ['keydown', 'keyup', 'keypress'].forEach(function (t) {
    input.addEventListener(t, function (e) { e.stopPropagation(); });
  });
  /* And while the gate is up but the field is not focused, the game must not
     hear the keys either. Capture runs ahead of the games' bubble handlers;
     the field's own keys are let through untouched. */
  ['keydown', 'keyup', 'keypress'].forEach(function (t) {
    document.addEventListener(t, function (e) {
      if (gate.classList.contains('hidden') || e.target === input) return;
      e.stopPropagation();
    }, true);
  });
  /* a booth tablet opens the keyboard on focus, which is what we want here */
  setTimeout(function () { try { input.focus(); } catch (e) {} }, 120);

  /* ---- the way back ---------------------------------------------------- */

  /* In full screen there is no browser chrome to go back with, and the deck
     now opens games in the same tab, so without this a game is a dead end.
     history.back() is preferred when we arrived from the showcase: it returns
     to the slide the visitor left, not to the top of the page. */
  var back = document.createElement('button');
  back.className = 'fxr-back';
  back.type = 'button';
  back.innerHTML = '\u2190 Booth';
  back.addEventListener('click', function () {
    var from = document.referrer || '';
    if (history.length > 1 && from.indexOf(location.origin) === 0) history.back();
    else location.href = 'index.html';
  });
  document.body.appendChild(back);

  /* ---- recording a finished run ---------------------------------------- */

  var resultEl = document.querySelector(CFG.result);
  var scoreSel = CFG.score;
  if (!resultEl) return;

  function currentScore() {
    var el = document.querySelector(scoreSel);
    if (!el) return null;
    var n = parseInt(String(el.textContent).replace(/[^0-9-]/g, ''), 10);
    return isNaN(n) ? null : n;
  }

  function panel() {
    var p = resultEl.querySelector('.fxr-board');
    if (!p) {
      p = document.createElement('div');
      p.className = 'fxr-board';
      /* ahead of the buttons, so "play again" stays the last thing on screen */
      var btn = resultEl.querySelector('.btn, .btnrow');
      if (btn) resultEl.insertBefore(p, btn); else resultEl.appendChild(p);
    }
    return p;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function record() {
    var score = currentScore();
    if (score === null) return;

    var rows = board();
    var prevBest = bestOf(rows, player);
    rows.push({ n: player || 'Player', s: score, t: Date.now() });
    rows.sort(function (a, b) { return b.s - a.s || a.t - b.t; });
    write(BOARD_KEY, JSON.stringify(rows.slice(0, 200)));
    render(score, prevBest);
  }

  function bestOf(rows, name) {
    for (var i = 0; i < rows.length; i++) if (rows[i].n === name) return rows[i].s;
    return null;
  }

  /* One row per person, their best run. Otherwise a single keen player takes
     the whole top five and nobody else can see themselves on it. */
  function standings() {
    var seen = {}, out = [];
    board().forEach(function (r) {
      if (Object.prototype.hasOwnProperty.call(seen, r.n)) return;
      seen[r.n] = 1;
      out.push(r);
    });
    return out;
  }

  function render(justScored, prevBest) {
    var rows = standings();
    var myPos = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].n === player) { myPos = i + 1; break; }
    }
    var html = '<h3>Booth ranking</h3>';
    rows.slice(0, TOP).forEach(function (r, i) {
      html += '<div class="fxr-row' + (i + 1 === myPos ? ' me' : '') + '">' +
        '<span class="fxr-pos">' + (i + 1) + '</span>' +
        '<span class="fxr-nm">' + esc(r.n) + '</span>' +
        '<span class="fxr-sc">' + r.s + '</span></div>';
    });
    if (myPos && myPos > TOP) {
      html += '<div class="fxr-row me"><span class="fxr-pos">' + myPos + '</span>' +
        '<span class="fxr-nm">' + esc(player) + '</span>' +
        '<span class="fxr-sc">' + rows[myPos - 1].s + '</span></div>';
    }
    html += '<p class="fxr-note">' +
      (prevBest === null || justScored > prevBest
        ? 'You scored ' + justScored + ' — your best yet.'
        : 'You scored ' + justScored + ' · your best is ' + prevBest + '.') +
      '</p>';
    panel().innerHTML = html;
  }

  /* The result screen is shown by removing `hidden`, the same way every one of
     these games does it. Only the hidden -> shown edge counts, so a re-render
     of the same screen does not book the score twice. */
  var wasHidden = resultEl.classList.contains('hidden');
  new MutationObserver(function () {
    var isHidden = resultEl.classList.contains('hidden');
    if (wasHidden && !isHidden) record();
    wasHidden = isHidden;
  }).observe(resultEl, { attributes: true, attributeFilter: ['class'] });
})();
