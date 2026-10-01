/* FACERINNA booth -- a game the admin has switched off.
 *
 * The admin page can turn any game off. The booth page then leaves it off
 * the wheel, but a game is also reached from an old link, a bookmark or a QR
 * code on the stand, and those still land here. This puts a resting card over
 * the game instead, with the way back to the booth.
 *
 *   <script src="fx-games.js" data-game="uv-card"></script>
 *
 * It is manners, not a lock: the booth script refuses a gift from a game
 * that is off, which is what matters. So it errs towards letting people play.
 * No answer from the script, no card; an admin signed in on this device sees
 * the game as it is, the same way the booth page shows them everything.
 *
 * The answer it goes on is the booth page's own copy of the config, kept in
 * localStorage on this origin, when that is under three minutes old (the
 * booth page asks that often anyway); otherwise it asks the script once.
 */
(function () {
  'use strict';
  var me = document.currentScript;
  var GAME = me && me.getAttribute('data-game');
  if (!GAME) return;

  /* A test points this somewhere else by setting window.__BOOTH_API first. */
  var API = (typeof window.__BOOTH_API === 'string') ? window.__BOOTH_API
    : 'https://script.google.com/macros/s/AKfycbyXD0qJ_aYCCowg8_U552PYiO5GXaq8hBGiLX1tQle0N7ELYUocBLGUPO-cwdEmy1C8/exec';
  var CACHE = 'fx.booth.config', ADMIN = 'fx.admin.token', FRESH_MS = 180000;
  if (!API) return;

  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  if (read(ADMIN)) return;

  function isOff(cfg) {
    var raw = cfg && cfg.settings && cfg.settings.games_off;
    return String(raw || '').toLowerCase().split(/[\s,;]+/).indexOf(GAME) >= 0;
  }

  var card = null;
  function rest() {
    if (card) return;
    card = document.createElement('div');
    card.id = 'fxRest';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'fxRestT');
    card.innerHTML =
      '<style>' +
      '#fxRest{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;' +
        'justify-content:center;padding:24px;background:linear-gradient(160deg,#0E4B7E,#071B2E);' +
        'color:#fff;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center}' +
      '#fxRest .fr{max-width:360px}' +
      '#fxRest .fr-m{font-size:12px;font-weight:800;letter-spacing:.32em;text-transform:uppercase;' +
        'color:#9FD3F7;margin-bottom:18px}' +
      '#fxRest h1{margin:0 0 10px;font-size:24px;line-height:1.25}' +
      '#fxRest p{margin:0 0 22px;font-size:15px;line-height:1.55;color:rgba(255,255,255,.8)}' +
      '#fxRest a{display:inline-block;min-height:44px;box-sizing:border-box;padding:12px 26px;' +
        'border-radius:999px;background:#fff;color:#0E4B7E;font-weight:800;text-decoration:none}' +
      '</style>' +
      '<div class="fr"><div class="fr-m">Facerinna</div>' +
      '<h1 id="fxRestT">This game is resting</h1>' +
      '<p>It is not on at the booth right now. The other games are waiting for you.</p>' +
      '<a href="index.html#game">Back to the booth games</a></div>';
    (document.body || document.documentElement).appendChild(card);
    document.documentElement.style.overflow = 'hidden';
  }
  function wake() {
    if (!card) return;
    card.remove(); card = null;
    document.documentElement.style.overflow = '';
  }
  function apply(cfg) { if (cfg && cfg.settings) { if (isOff(cfg)) rest(); else wake(); } }

  var seen = null;
  try { seen = JSON.parse(read(CACHE) || 'null'); } catch (e) {}
  if (seen && seen.cfg) apply(seen.cfg);
  if (seen && seen.cfg && Date.now() - (seen.at || 0) < FRESH_MS) return;

  var ctl = ('AbortController' in window) ? new AbortController() : null;
  var t = ctl && setTimeout(function () { ctl.abort(); }, 4000);
  fetch(API, { method: 'POST', body: JSON.stringify({ action: 'config' }), signal: ctl ? ctl.signal : undefined })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j || !j.ok || !j.settings) return;
      try { localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), cfg: j })); } catch (e) {}
      apply(j);
    })
    .catch(function () { /* offline: whatever was cached stands */ })
    .finally(function () { if (t) clearTimeout(t); });
})();
