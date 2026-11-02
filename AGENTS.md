# FACERINNA Showcase — project rules

Booth dashboard for the Persatuan Dermatologi Malaysia AGM. Live at
https://my.facerinna.com/ (GitHub Pages, `main` → deploy).

## Shape of the repo

Static HTML + vanilla JS. No build step, no bundler, no framework — a page you
can open is a page that ships. Every page is self-contained: CSS and JS inline in
the `.html`, shared behaviour in small `fx-*.js` files that the pages include.

- `index.html` — the booth page: games wheel (`#gameRing`), publications, talks
- `admin.html` — booth admin (game toggles, gift targets, rankings). Talks to the
  Apps Script project; the game list is duplicated here on purpose (see below)
- `fx-gift.js` — gift desk client (`settings()`, `needFor()`, redeem panel)
- `fx-rank.js` — booth ranking + the name gate that covers the page until a
  visitor enters a name
- `fx-games.js` — turns a game off when the admin has switched it off
- `fx-ui-polish.js` / `fx-ui-polish.css` — Lenis, Motion, Lucide, `:focus-visible`
- `sw.js` — offline shell for the hall wifi; every page must be in its list
- `tools/*.test.mjs` — 50 Playwright checks
- `tools/qr-test.py` — decodes every embedded QR with zbar AND OpenCV

## Rules that are not negotiable

1. **Nothing goes live before the admin turns it on.** A new game ships with an
   admin switch that is OFF. Do not flip it, do not announce it as live.
2. **The gift desk contract is the same in every game.** `fxGift.settings()`
   returns `{gift_active, gift_needs}`; the target comes from
   `gift_needs['<game-id>']`, never hard-coded. A gift run **stops the instant it
   reaches the target** and shows the winner screen. Normal play never stops.
   A game with no target set must disable the gift button and say so — not fall
   back to a default number.
3. **`textContent`, not `innerHTML`,** for anything drawn from a name a visitor
   typed. The ranking shows names.
4. **A page that is a dead link is worse than no page.** Adding a game means
   updating: `index.html` card + `ART[]` entry + `cg-num` sequence, `admin.html`
   `GAMES` and `GIFT_GAMES`, `lucky-wheel.html` label map, and `sw.js` shell list.
   Miss one and the card either 404s or shows a blank tile.
5. **Two writers to one thing is a bug.** The booth script owns gift targets;
   the page only reads them.

## Performance: measure, do not guess

This is the lesson that cost two PRs on Pack Drop.

- **The background blobs were the lag, not the game loop.** Three animated
  `70vmax` radial gradients re-composited every frame: 10 fps → 47 fps with that
  animation alone removed. The gradients stay; the animation is gone.
- **A DOM write per frame is expensive.** Writing `textContent` on the score
  counter every frame took the page from 55 fps to 13. Write only when the
  printed number changes, and park the `requestAnimationFrame` loop when nothing
  is moving.
- **Never force a device-pixel-ratio the screen does not have.** A floor of `2`
  on a `dpr: 1` monitor quadruples the pixels for no visible gain.
- **`contain:paint` + `translateZ(0)`** on the canvas promotes it to its own
  layer; it helps only once the blobs are gone.
- Loop cost is measured by timing the RAF callback, not by eyeballing FPS.

## Verification

```sh
npm ci && npx playwright install --with-deps chromium
node tools/booth-board.test.mjs      # and the rest of tools/*.test.mjs
python tools/qr-test.py              # needs libzbar0 + tools/requirements.txt
```

Browser tests resolve files relative to the checkout, so they run from any cwd.
On this machine the shared Chromium lives at `/opt/data/lib/playwright-browsers`
(Python) and `/opt/data/lib/playwright-lemo` (Node, for the Lemo renderer);
set `PLAYWRIGHT_BROWSERS_PATH` to the right one.

`test-game-perf.mjs` compares a new game against the **shipped** game on the same
machine rather than asserting an absolute frame rate — this container has no GPU
and runs Chromium on SwiftShader, where even the live game sits near 13 fps at
1920. A fixed number here would fail on a busy box without anything having
changed.

## Traps already paid for

- **Falsy index zero.** `if (!firstPick)` rejected card 0; the top-left tile
  could never open a matter. Compare against `null`.
- **A deck built for the wrong grid.** Six pairs for an eight-pair board lets a
  product repeat, and two identical packs match each other. Build the deck from
  the grid size, and assert every pair appears exactly twice.
- **Text sized by string length.** "Niacinamide + TXA" is short but wide and ran
  off a 90 px card. Measure with `measureText` and fit.
- **`--allowedTools`/variadic flags swallow the next token** — relevant when
  driving Claude Code from here.
- **The service worker hides a missing page.** An added page that is not in
  `sw.js` works on the dev box and 404s offline at the booth.

## Style

Malay for anything a visitor reads on the Malaysian pages; English for code,
comments and commit messages. No em dash in visitor-facing copy. No invented
number, name or claim — a formulation claim on a pack is a regulatory statement,
not marketing.
