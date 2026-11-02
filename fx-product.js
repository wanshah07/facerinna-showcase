/* FACERINNA booth -- the product that fills as you score.
 *
 * Beside the board there is a 3D model of one FACERINNA product. It begins
 * blank: a ghost of the pack, grey and empty. As the score climbs it fills from
 * the bottom, slowly, like a bottle filling, until the whole real product shows;
 * then it lights up, holds a moment, and is replaced by the next product,
 * blank again.
 *
 * The model is built from the product's own photograph, so what fills in is the
 * real pack, not a drawing of one. It is extruded: the cut-out is stacked into
 * a thin solid, and a front and a back face are set on it, and the whole thing
 * is turned a little either way on a showcase, in real CSS 3D. (There are no 3D
 * scans of the range in this site; if there are ever GLB files they can replace
 * this without the games changing, they only call the five functions below.)
 *
 *   var m = fxProduct.mount(el, { order: [0,1,2,3,4,5] });
 *   m.set(0.4);          the fraction filled, 0..1: it climbs there slowly
 *   m.complete(next);    fill the rest, light up, then swap to product `next`
 *   m.complete(false);   fill the rest and light up, and stay (a winner)
 *   m.reset(i);          a new run: product i, blank
 *   m.index();           which product is showing
 *   m.name(); m.pct();   for the caption
 *
 * Costs: the spin is a CSS animation on the compositor; the only script that
 * runs is a frame loop while the fill is still climbing, and it parks when it
 * has arrived.
 */
(function () {
  'use strict';
  var PRODUCTS = [
    { slug: '10-niacinamide-3-txa-bright-dark-spot-serum', name: '10% Niacinamide 3% TXA Bright Dark Spot Serum', color: '#4898D8' },
    { slug: '2-salicylic-acid-acne-serum', name: '2% Salicylic Acid Acne Serum', color: '#12A79B' },
    { slug: 'retinol-anti-aging-serum', name: 'Retinol Anti-Aging Serum', color: '#B4557C' },
    { slug: 'ceramide-b5-balancing-moisturizer', name: 'Ceramide B5 Balancing Moisturizer', color: '#3FA7D6' },
    { slug: '5-b5-intensive-barrier-cream', name: '5% B5 Intensive Barrier Cream', color: '#F0C25A' },
    { slug: 'physical-defense-barrier-serum-sunscreen-spf50', name: 'Physical Defense Barrier Serum Sunscreen SPF50', color: '#E8A13B' }
  ];
  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var SLICES = 9;

  var css = document.createElement('style');
  css.textContent =
    '.fxp{position:relative;width:100%;height:100%;display:grid;place-items:center;perspective:900px;perspective-origin:50% 40%;contain:layout paint}' +
    '.fxp-shadow{position:absolute;left:50%;bottom:3%;width:62%;height:7%;transform:translateX(-50%);border-radius:50%;' +
      'background:radial-gradient(ellipse at center,rgba(0,8,24,.55),rgba(0,8,24,0) 70%)}' +
    '.fxp-slot{position:relative;transform-style:preserve-3d;transition:transform .55s cubic-bezier(.5,0,.2,1),opacity .45s ease}' +
    '.fxp-slot.leave{transform:translateX(70%) scale(.7);opacity:0}' +
    '.fxp-slot.enter{transform:translateX(-70%) scale(.7);opacity:0;transition:none}' +
    '.fxp-turn{position:absolute;inset:0;transform-style:preserve-3d;animation:fxp-swing 9s ease-in-out infinite}' +
    '@keyframes fxp-swing{0%,100%{transform:rotateY(-36deg) rotateX(4deg)}50%{transform:rotateY(36deg) rotateX(4deg)}}' +
    '@media (prefers-reduced-motion:reduce){.fxp-turn{animation:none;transform:rotateY(-20deg) rotateX(4deg)}}' +
    '.fxp-sl{position:absolute;inset:0;-webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;' +
      'background:linear-gradient(90deg,var(--fxp-a),var(--fxp-b));transition:filter .6s}' +
    '.fxp-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden}' +
    '.fxp-face img{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;-webkit-user-drag:none}' +
    '.fxp-ghost{filter:grayscale(1) brightness(.52) contrast(.9);opacity:.6}' +
    '.fxp-live{clip-path:inset(var(--fxp-top,100%) 0 0 0)}' +
    '.fxp-lvl{position:absolute;inset:0;-webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;pointer-events:none}' +
    '.fxp-lvl i{position:absolute;left:-10%;right:-10%;top:var(--fxp-top,100%);height:6%;transform:translateY(-50%);' +
      'background:linear-gradient(180deg,rgba(255,255,255,0),rgba(190,235,255,.95),rgba(255,255,255,0));filter:blur(.5px)}' +
    '.fxp-back{transform:rotateY(180deg)}' +
    '.fxp-back img{filter:brightness(.55) saturate(.8)}' +
    '.fxp-shine{position:absolute;inset:0;-webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;opacity:0;pointer-events:none;' +
      'background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.85) 50%,transparent 65%);background-size:260% 100%;background-position:130% 0}' +
    '.fxp-slot.done .fxp-shine{opacity:1;animation:fxp-shine 1.1s ease-out .05s 1 forwards}' +
    '@keyframes fxp-shine{to{background-position:-30% 0}}' +
    '.fxp-slot.done{filter:drop-shadow(0 0 clamp(10px,2.4vmin,48px) rgba(255,214,120,.75))}' +
    '.fxp-slot.done .fxp-lvl{opacity:0}' +
    '@media (prefers-reduced-motion:reduce){.fxp-slot{transition-duration:.01ms}.fxp-slot.done .fxp-shine{animation:none;opacity:0}}';
  document.head.appendChild(css);

  function mount(el, opt) {
    opt = opt || {};
    var order = (opt.order && opt.order.length) ? opt.order : PRODUCTS.map(function (_, i) { return i; });
    var host = document.createElement('div'); host.className = 'fxp';
    var shadow = document.createElement('div'); shadow.className = 'fxp-shadow';
    host.appendChild(shadow);
    el.textContent = '';
    el.appendChild(host);

    var cur = 0, slot = null, shown = 0, target = 0, raf = 0, last = 0, busy = false, queued = null, doneAt = 0, hold = false;
    var ratio = {}, box = { w: 0, h: 0 };

    function ratioOf(i, then) {
      if (ratio[i]) return then(ratio[i]);
      var im = new Image(); im.decoding = 'async';
      im.onload = function () { ratio[i] = im.naturalWidth / Math.max(1, im.naturalHeight); then(ratio[i]); };
      im.onerror = function () { ratio[i] = 0.4; then(0.4); };
      im.src = 'products/' + PRODUCTS[order[i % order.length]].slug + '.webp';
    }

    function size() {
      if (!slot) return;
      var r = ratio[cur] || 0.4, W = box.w || host.clientWidth, H = box.h || host.clientHeight;
      if (!W || !H) return;
      var h = Math.min(H * 0.92, W * 0.92 / r), w = h * r;
      slot.style.width = w + 'px'; slot.style.height = h + 'px';
      var d = Math.max(8, Math.min(w, h) * 0.2);
      slot.style.setProperty('--fxp-d', d + 'px');
      var sl = slot.querySelectorAll('.fxp-sl');
      for (var k = 0; k < sl.length; k++) sl[k].style.transform = 'translateZ(' + ((k / (SLICES - 1) - 0.5) * d).toFixed(2) + 'px)';
      var f = slot.querySelector('.fxp-front'), b = slot.querySelector('.fxp-back');
      if (f) f.style.transform = 'translateZ(' + (d / 2 + 0.5).toFixed(2) + 'px)';
      if (b) b.style.transform = 'translateZ(' + (-d / 2 - 0.5).toFixed(2) + 'px) rotateY(180deg)';
    }

    function build(i, cls) {
      var P = PRODUCTS[order[i % order.length]], url = 'products/' + P.slug + '.webp';
      var s = document.createElement('div'); s.className = 'fxp-slot' + (cls ? ' ' + cls : '');
      s.style.setProperty('--fxp-a', P.color); s.style.setProperty('--fxp-b', '#10223a');
      var turn = document.createElement('div'); turn.className = 'fxp-turn';
      var maskCss = 'url("' + url + '")';
      for (var k = 0; k < SLICES; k++) {
        var sl = document.createElement('div'); sl.className = 'fxp-sl';
        sl.style.webkitMaskImage = maskCss; sl.style.maskImage = maskCss;
        sl.style.filter = 'grayscale(1) brightness(.35)';
        turn.appendChild(sl);
      }
      function face(cls2, back) {
        var f = document.createElement('div'); f.className = 'fxp-face ' + cls2;
        var g = document.createElement('img'); g.className = 'fxp-ghost'; g.alt = ''; g.src = url; g.decoding = 'async'; g.draggable = false;
        var l = document.createElement('img'); l.className = 'fxp-live'; l.alt = ''; l.src = url; l.decoding = 'async'; l.draggable = false;
        f.appendChild(g); f.appendChild(l);
        var lv = document.createElement('div'); lv.className = 'fxp-lvl';
        lv.style.webkitMaskImage = maskCss; lv.style.maskImage = maskCss;
        lv.appendChild(document.createElement('i')); f.appendChild(lv);
        var sh = document.createElement('div'); sh.className = 'fxp-shine';
        sh.style.webkitMaskImage = maskCss; sh.style.maskImage = maskCss; f.appendChild(sh);
        return f;
      }
      turn.appendChild(face('fxp-front'));
      var bk = face('fxp-back'); bk.querySelector('.fxp-ghost').style.display = 'none'; turn.appendChild(bk);
      s.appendChild(turn);
      return s;
    }

    function paint() {
      if (!slot) return;
      var top = (100 - Math.max(0, Math.min(1, shown)) * 100).toFixed(2) + '%';
      slot.style.setProperty('--fxp-top', top);
      /* the thickness takes its colour as the pack fills */
      var tint = Math.max(0, Math.min(1, shown));
      var sl = slot.querySelectorAll('.fxp-sl');
      var f = 'grayscale(' + (1 - tint).toFixed(2) + ') brightness(' + (0.35 + 0.65 * tint).toFixed(2) + ')';
      for (var k = 0; k < sl.length; k++) sl[k].style.filter = f;
      var back = slot.querySelector('.fxp-back .fxp-live'); if (back) back.style.clipPath = 'inset(' + top + ' 0 0 0)';
      if (opt.onPaint) opt.onPaint(shown, cur);
    }

    function loop(t) {
      raf = 0;
      var dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60; last = t;
      var d = target - shown;
      if (Math.abs(d) < 0.0008) { shown = target; last = 0; paint(); settled(); return; }
      /* slowly: it closes about a fifth of what is left each second, and never faster than a steady climb */
      var step = d * (1 - Math.exp(-dt * 1.3));
      var floor = (d > 0 ? 1 : -1) * Math.min(Math.abs(d), 0.045 * dt);
      shown += Math.abs(step) > Math.abs(floor) ? step : floor;
      paint();
      raf = requestAnimationFrame(loop);
    }
    function kick() { if (!raf) { last = 0; raf = requestAnimationFrame(loop); } }

    function settled() {
      if (queued && target >= 0.999 && shown >= 0.999 && slot) {
        var next = queued; queued = null;
        slot.classList.add('done'); hold = true;      /* it stays full until it is replaced */
        if (opt.onDone) opt.onDone(cur);
        doneAt = Date.now();
        if (next.next === false) return;        /* a winner: it stays, complete, on the screen */
        setTimeout(function () { swap(next.next); }, RM ? 400 : 1900);
      }
    }

    function swap(i) {
      if (!slot) { place(i); return; }
      slot.classList.add('leave');
      setTimeout(function () { place(i, 'enter'); }, RM ? 20 : 520);
    }

    function place(i, cls) {
      busy = true;
      ratioOf(i, function () {
        if (slot) slot.remove();
        cur = i; slot = build(i, cls); host.insertBefore(slot, shadow);
        hold = false; shown = 0; target = 0; size(); paint();
        if (cls === 'enter') { void slot.offsetWidth; slot.classList.remove('enter'); }
        busy = false;
        if (pending !== null) { target = pending; pending = null; kick(); }
        if (opt.onReplace) opt.onReplace(cur);
      });
    }
    var pending = null;

    if (window.ResizeObserver) new ResizeObserver(function (e) { var c = e[0].contentRect; box.w = c.width; box.h = c.height; size(); }).observe(host);
    else addEventListener('resize', function () { box.w = host.clientWidth; box.h = host.clientHeight; size(); });

    place(0);

    return {
      set: function (p) {
        p = Math.max(0, Math.min(1, +p || 0));
        if (queued || hold) return;            /* it is finishing: the new level's progress waits */
        if (busy) { pending = p; return; }
        target = p; kick();
      },
      complete: function (next) {
        if (busy) { pending = 1; }
        queued = { next: next === false ? false : next == null ? cur + 1 : next };
        target = 1; kick();
        if (shown >= 0.999) settled();
      },
      reset: function (i) {
        queued = null; pending = null; target = 0; hold = false;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        place(i == null ? 0 : i);
      },
      index: function () { return cur; },
      name: function () { return PRODUCTS[order[cur % order.length]].name; },
      pct: function () { return Math.round(shown * 100); },
      state: function () { return { shown: shown, target: target, done: !!(slot && slot.classList.contains('done')), cur: cur, busy: busy, queued: !!queued }; },
      names: function () { return order.map(function (i) { return PRODUCTS[i].name; }); }
    };
  }

  window.fxProduct = { mount: mount, PRODUCTS: PRODUCTS };
})();
