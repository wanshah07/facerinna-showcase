/* FACERINNA booth -- Redeem gift and Normal play, for the games that began with
 * one Start button.
 *
 * The newer games (Pack Drop, Pack Crush, Pack Recall, Magic Tiles, Pack
 * Slicer, Match Factory) open on two buttons. This gives the older ones the
 * same two, with the same rules (AGENTS.md, rule 2):
 *
 *   Redeem gift   the target is gift_needs['<game-id>'] from the gift desk,
 *                 never a number written here. The run STOPS THE INSTANT the
 *                 score reaches it and shows the winner screen. With no target
 *                 set (or gifts off) the button is greyed out and says so.
 *   Normal play   never stops on a target, and never offers a gift.
 *
 * A game mounts itself from inside its own script, where its state lives:
 *
 *   fxModes.mount({
 *     start:    '#start',        the opening screen
 *     startBtn: '#playBtn',      the Start button it already has (kept, hidden,
 *                                and clicked for the player)
 *     result:   '#over',         the result screen (hidden -> shown ends a run)
 *     getScore: function(){ return S.score; },
 *     isPlaying:function(){ return S.playing; },
 *     stop:     function(){ endGame(); },     end the run NOW, as a win
 *     addScore: function(n){ S.score += n; }, optional: lets a test put points on the board
 *     getLevel: function(){ return G.round + 1; }, optional: the level this run is on (the tournament adds them up)
 *     settings: function(){ return Promise<{gift_active, gift_needs}> }, optional: a game that
 *               keeps its own gift desk calls (Facy Run) hands them in
 *     normalSub:'Play as usual'
 *   });
 *
 * and lets the gift panel know when it may speak:
 *
 *   window.FX_RANK = { ..., giftGate: function(){ return !!(window.fxModes && fxModes.gate()); } };
 *
 * Loaded before the game's own script; talks to fx-gift.js once the page is
 * whole (it loads last).
 */
(function () {
  'use strict';
  var mode = 'play', need = 0, giftNeed = null, giftState = 'wait', seq = 0, won = false, timer = 0;
  var cfg = null, ui = {};

  function $(s) { return typeof s === 'string' ? document.querySelector(s) : s; }
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

  var css = document.createElement('style');
  css.textContent =
    '.fxm-box{display:flex;flex-direction:column;align-items:center;gap:clamp(10px,1.6vmin,26px);margin:clamp(8px,1.4vmin,24px) auto 0;width:min(100%,clamp(260px,38vmin,760px))}' +
    '.fxm-btn{font:inherit;font-weight:800;letter-spacing:.02em;border:0;border-radius:999px;padding:.85em 1.6em;min-height:50px;width:100%;cursor:pointer;' +
      'font-size:clamp(15px,2.1vmin,44px);line-height:1.15;text-align:center;touch-action:manipulation;color:#05243b;' +
      'transition:transform .15s cubic-bezier(.2,.9,.3,1.3),box-shadow .2s,opacity .2s}' +
    '.fxm-btn small{display:block;font-weight:700;font-size:.62em;letter-spacing:.04em;opacity:.82;margin-top:.25em}' +
    '.fxm-btn.gift{background:linear-gradient(180deg,#ffe28a,#ffb12e);color:#3a2300;box-shadow:0 7px 0 #c47a08,0 16px 34px rgba(255,170,40,.38)}' +
    '.fxm-btn.play{background:linear-gradient(180deg,#6fd2ff,#2fa6e6);color:#031d33;box-shadow:0 7px 0 #1a77ad,0 16px 34px rgba(31,150,225,.38)}' +
    '.fxm-btn:active{transform:translateY(4px)}' +
    '.fxm-btn[disabled]{opacity:.5;cursor:default;transform:none}' +
    '.fxm-btn:focus-visible{outline:3px solid #ffe183;outline-offset:3px}' +
    '.fxm-note{margin:0;min-height:1.3em;text-align:center;font-size:clamp(12px,1.5vmin,30px);line-height:1.4;color:#cfe6f5}' +
    '.fxm-banner{margin:0 auto clamp(10px,1.6vmin,28px);padding:.7em 1.2em;border-radius:16px;text-align:center;max-width:min(92vw,34em);' +
      'font:700 clamp(15px,2vmin,40px)/1.35 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#eef8ff;background:rgba(255,255,255,.1);border:1px solid rgba(160,215,255,.25)}' +
    '.fxm-banner b{display:block;font-size:1.25em;margin-bottom:.1em}' +
    '.fxm-banner.win{background:linear-gradient(180deg,rgba(255,201,74,.3),rgba(255,160,50,.16));border-color:rgba(255,201,74,.6);color:#ffe8b0}' +
    '.fx-tour-on #goGift,.fx-tour-on #giftNote{display:none!important}';
  document.head.appendChild(css);

  function refresh(force) {
    var fg = ui.fg || window.fxGift;
    if (!ui.sub) return;
    if (!fg) { giftState = 'wait'; ui.sub.textContent = 'Checking the gift desk…'; return; }
    if (force && fg.forget) fg.forget();
    var mine = ++seq;
    /* the booth page's own copy of the config, under three minutes old, is the answer as it
       stands (fx-games.js decides the same way): no call to the script for it */
    var fresh = force ? null : cachedConfig();
    giftState = 'wait'; ui.sub.textContent = 'Checking the gift desk…'; ui.note.textContent = '';
    (fresh ? Promise.resolve(fresh) : fg.settings()).then(function (c) {
      if (mine !== seq) return;
      cfg = c;
      if (!c) { giftState = 'offline'; giftNeed = null; ui.sub.textContent = 'Gift desk not reachable';
        ui.note.textContent = 'Tap Redeem gift to try again, or play normally.'; ui.gift.disabled = false; return; }
      var on = /^(yes|y|true|1|on)$/i.test(String(c.gift_active || 'no'));
      giftNeed = fg.needFor(c, ui.id);
      if (!on) { giftState = 'off'; ui.sub.textContent = 'Gifts are not on right now'; ui.gift.disabled = true;
        ui.note.textContent = 'You can still play normally and join the ranking.'; }
      else if (!giftNeed) { giftState = 'unset'; ui.sub.textContent = 'No gift target set for this game'; ui.gift.disabled = true;
        ui.note.textContent = 'Ask the FACERINNA team. Normal play is open.'; }
      else { giftState = 'ready'; ui.sub.textContent = 'Reach ' + fmt(giftNeed) + ' points to win'; ui.gift.disabled = false;
        ui.note.textContent = 'The game stops the moment you reach it.'; }
    }).catch(function () {
      if (mine !== seq) return;
      giftState = 'offline'; giftNeed = null; ui.sub.textContent = 'Gift desk not reachable'; ui.gift.disabled = false;
      ui.note.textContent = 'Tap Redeem gift to try again, or play normally.';
    });
  }

  function cachedConfig() {
    try {
      var c = JSON.parse(localStorage.getItem('fx.booth.config') || 'null');
      if (c && c.cfg && c.cfg.settings && Date.now() - (c.at || 0) < 180000)
        return { gift_active: c.cfg.settings.gift_active, gift_needs: c.cfg.gift_needs || {} };
    } catch (e) {}
    return null;
  }

  function arm(o) {
    clearInterval(timer); timer = 0;
    if (mode !== 'gift') return;
    /* twenty-five looks a second at one number: the stop lands within a frame or two of the score */
    timer = setInterval(function () {
      if (mode !== 'gift' || !need || !o.isPlaying()) return;
      var sc = o.getScore();
      if (won && sc < need) won = false;          /* a new run began from Again, Retry or the pause menu */
      if (!won && sc >= need) { won = true; o.stop(); }
    }, 40);
  }

  function begin(o, m) {
    mode = m; won = false;
    need = m === 'gift' ? (giftNeed || 0) : 0;
    arm(o);
    o.startBtn.click();
  }

  function mount(o) {
    var start = $(o.start), sbtn = $(o.startBtn), res = $(o.result);
    if (!start || !sbtn) return;
    o.startBtn = sbtn;
    var box = document.createElement('div'); box.className = 'fxm-box';
    var g = document.createElement('button'); g.type = 'button'; g.id = 'goGift'; g.className = 'fxm-btn gift';
    g.appendChild(document.createTextNode('\u{1F381} Redeem gift'));
    var gs = document.createElement('small'); gs.id = 'giftSub'; gs.textContent = 'Checking the gift desk…'; g.appendChild(gs);
    var p = document.createElement('button'); p.type = 'button'; p.id = 'goPlay'; p.className = 'fxm-btn play';
    p.appendChild(document.createTextNode('Normal play'));
    var ps = document.createElement('small'); ps.textContent = o.normalSub || 'Play as usual'; p.appendChild(ps);
    var n = document.createElement('p'); n.id = 'giftNote'; n.className = 'fxm-note';
    box.appendChild(g); box.appendChild(p); box.appendChild(n);
    sbtn.style.display = 'none';
    sbtn.parentNode.insertBefore(box, sbtn);
    ui = { id: o.id, gift: g, play: p, sub: gs, note: n };
    /* a game with its own gift desk calls hands them in; the rest use fx-gift.js */
    if (o.settings) ui.fg = { settings: o.settings, forget: o.forget, needFor: function (c, id) { var v = c && c.gift_needs && +c.gift_needs[id]; return v > 0 ? v : null; } };

    p.addEventListener('click', function () { begin(o, 'play'); });
    g.addEventListener('click', function () {
      if (giftState === 'ready' && giftNeed) begin(o, 'gift');
      else if (giftState !== 'off' && giftState !== 'unset') refresh(true);
    });

    /* the result screen: the winner line on a gift run, and how far short if it fell short */
    if (res) {
      var was = res.classList.contains('hidden');
      /* only the moment the screen comes up: touching its class list from in here changes the
         class attribute, which wakes this observer again, so it must never act on a change it made */
      new MutationObserver(function () {
        var now = res.classList.contains('hidden');
        if (was && !now) { if (mode === 'gift' && need) banner(res, o); else clearBanner(res); }
        was = now;
      }).observe(res, { attributes: true, attributeFilter: ['class'] });
    }
    /* the games restart themselves from Again, Retry and the pause menu: the mode carries over */
    window.addEventListener('load', function () { refresh(false); });
    refresh(false);
    window.__fxModes = { snapshot: function () { return { mode: mode, need: need, giftNeed: giftNeed, giftState: giftState, won: won,
        level: o.getLevel ? o.getLevel() : 0 }; },
      start: function (m) { begin(o, m === 'gift' ? 'gift' : 'play'); }, refresh: refresh,
      /* for the tests: put points on the score the way a catch would */
      addScore: function (n) { if (o.addScore) o.addScore(n); } };
  }

  function clearBanner(res) { var b = res.querySelector('.fxm-banner'); if (b) b.remove(); if (res.classList.contains('win')) res.classList.remove('win'); }
  function banner(res, o) {
    clearBanner(res);
    var s = o.getScore(), b = document.createElement('div'), t = document.createElement('b'), l = document.createElement('span');
    b.className = 'fxm-banner';
    if (won && s >= need) {
      b.classList.add('win'); res.classList.add('win');
      t.textContent = '\u{1F381} Gift unlocked'; l.textContent = 'You reached ' + fmt(need) + ' points. Your gift is ready.';
    } else {
      t.textContent = 'So close!'; l.textContent = fmt(Math.max(0, need - s)) + ' more points for the gift. Go again!';
    }
    b.appendChild(t); b.appendChild(l);
    res.insertBefore(b, res.firstChild);
  }

  window.fxModes = {
    mount: mount,
    gate: function () { return mode === 'gift'; },
    mode: function () { return mode; },
    need: function () { return need; }
  };
})();
