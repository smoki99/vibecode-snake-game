# Spec: Snake — production-grade arcade game (multi-file source, single-file bundle)

Status: **v2 — planned (see `tasks/plan.md`)** · Owner: agent · Last updated: session 2
Scope check (Phase 0): one capability ("play a great game of Snake"). No capability map needed.

> **Revision log**
> - **v1 (session 1):** single self-contained HTML file, zero extra files.
> - **v2 (session 2, user request):** scope widened to a small multi-file project — local font files,
>   a hand-authored SVG icon set, and a high-quality standalone SVG artwork version. Playable and
>   unit-tested. The single-file property is **kept as a build output** (`dist/snake-standalone.html`),
>   not as the source layout, so nothing from v1 is lost. See §2, §3, §4, §8, OQ-6..OQ-9.

---

## 1. Objective

Ship a polished Snake game that a person can open and play immediately — no install, no server, no
network at runtime — built from a small set of clean source files (HTML, ES modules, local fonts,
SVG icons and artwork), plus a generated single-file bundle that plays offline from `file://`.

**User:** one person, on a laptop or phone, who wants to play right now. No accounts, no other
players, no server.

**"Very high quality" reframed as testable success criteria** (this is what the phrase means here):

| Dimension | Concrete criterion |
|---|---|
| Feel | Logic runs on a fixed timestep (decoupled from render); rendering interpolates between ticks so movement is smooth at any refresh rate. Input registered between ticks is buffered and applied at the next tick — never dropped, never double-applied. |
| Correctness | No self-collision on a rapid two-key combo in the same tick (the classic 180°-reversal bug). Snake never occupies two cells. Food never spawns on the snake. Score, length and speed always agree with the sim state. |
| Robustness | Tab blur / `visibilitychange` auto-pauses; a 10-second background stint never costs a life. `requestAnimationFrame` catch-up after a stall is clamped (no "spiral of death" teleport-death). |
| Accessibility | Playable with keyboard only; visible focus rings; UI text ≥ 4.5:1 contrast; food and snake are distinguishable by shape as well as hue (colorblind-safe); state changes (GO, PAUSED, +1 food) announced via `aria-live`; `prefers-reduced-motion` disables non-essential animation; `prefers-color-scheme` respected. |
| Mobile | Pointer/swipe steering with a 24 px dead zone, on-screen D-pad fallback, no 300 ms tap delay, no page scroll while playing, layout usable from 320 px wide to 4K. |
| Perf | 60 fps sustained on a mid-range laptop; frame budget < 4 ms for the game's own JS; canvas is DPR-aware (crisp on retina); total file < 100 KB uncompressed, 0 network requests after the file loads. |
| Persistence | High score survives reload via `localStorage`, wrapped in try/catch (private-mode safe); corrupt/unexpected stored values fall back to 0 without throwing. |

**Out of scope (explicitly not being built):** multiplayer, server/backend, accounts, level
editor, achievements, ads, analytics, service worker / offline manifest, gamepad, UI framework,
third-party *runtime* JS libraries, remotely fetched fonts or icons.

---

## 1b. v2 scope additions

1. **Local fonts.** Two families vendored as subset `.woff2` files under `assets/fonts/` with an
   `@font-face` stylesheet and a full fallback stack. Downloaded **once at setup time** by
   `tools/fetch-fonts.mjs`; the game itself never fetches anything.
2. **SVG icon set.** Every icon in the UI is a hand-authored SVG on a 24 × 24 grid, stroke-based,
   `currentColor`, no embedded rasters. Shipped both as individual `assets/icons/*.svg` files and as
   one `<symbol>` sprite (`assets/icons/icons.svg`) injected inline at runtime so icons inherit text
   color and theme.
3. **High-quality SVG artwork version.** `assets/brand/snake-poster.svg` — a poster-grade, fully
   self-contained vector artwork of the game (board, snake with gradient body and eyes, apple with
   highlight, grid, glow), plus `snake-logo.svg` (mark + wordmark) and `favicon.svg` derived from the
   same geometry. These are authored once as vector art and reused at every size (favicon → hero →
   OG image), which is the point of the SVG version: one artwork, infinitely scalable.
4. **Single-file bundle as a build output.** `tools/build-single.mjs` inlines CSS, JS and
   base64-fonts into `dist/snake-standalone.html` so the v1 promise (double-click, offline, one
   file) still holds.

---

## 2. Tech Stack

- **Language:** vanilla ES2022 JavaScript as native ES modules (`<script type="module">`). No
  transpile, no framework, no runtime dependencies (0 `node_modules` entries shipped in the artifact).
- **Rendering:** single `<canvas>`, 2D context (chosen for interpolation smoothness and frame budget).
  SVG is used for icons, overlays, branding and artwork. An `?renderer=svg` vector renderer is a
  stretch task (OQ-7), not core.
- **Fonts:** `Space Grotesk` (UI, OFL) + `Silkscreen` (arcade numerals/accents, OFL), latin-subset
  `.woff2`, `font-display: swap`, self-hosted under `assets/fonts/` with license files.
- **Icons/artwork:** SVG only, hand-authored, no raster anywhere in the source tree.
- **Styling:** `assets/styles/` stylesheets linked from `index.html`, CSS custom properties for theming, `clamp()` for fluid type.
- **Storage:** `localStorage` (single key, `snake.best.v1`).
- **Audio (optional, see OQ-4):** WebAudio API oscillator blips, no asset files, muted by default
  until first user gesture.
- **Test tooling (dev only, not part of the artifact):** Node 24 built-in test runner + Playwright
  1.64 headless Chromium; `sharp` for rasterizing SVG previews for human review (never shipped).
- **Serving:** `python3 -m http.server` for local play (ES modules need `http://`, not `file://`).

---

## 3. Commands

Everything is dev tooling around one artifact; the artifact itself has no build.

```bash
# Setup (one-time, the only steps that touch the network)
node /workspace/tools/fetch-fonts.mjs                # vendor subset .woff2 + licenses into assets/fonts/
playwright install chromium                          # one-time browser download for the browser suite

# Play (dev server — ES modules require http://, not file://)
cd /workspace && python3 -m http.server 8080         # → http://localhost:8080/index.html

# Tests
node --test /workspace/tests/unit/                   # fast pure-logic tests, no browser
node --test /workspace/tests/assets/                 # SVG well-formedness, icon/sprite rules, font presence + budget
node --test /workspace/tests/browser/                # real key events, real canvas, lifecycle, a11y
node --test /workspace/tests/                        # everything

# Build the single-file artifact + verify it is self-contained
node /workspace/tools/build-single.mjs               # → dist/snake-standalone.html
node --test /workspace/tests/build/                  # bundle has 0 external requests, plays from file://

# Asset previews (human eyeballs; PNGs are generated, never hand-edited)
node /workspace/tools/render-svg.mjs assets/brand/snake-poster.svg .build/poster.png 1600
```

---

## 4. Project Structure

```
/workspace/
  index.html              → entry page: HUD, overlays, canvas, inline-safe markup; loads src/main.js
  src/
    main.js               → boot only: wire sim + renderer + controller + loop (the only side effects)
    sim/
      constants.js        → board size, tick presets, scoring, palette tokens
      rng.js              → mulberry32 (seeded, pure)
      state.js            → createState(config) — the immutable snapshot factory
      steering.js         → takeSteering(pending, dir) — reversal/stale-turn rejection
      step.js             → step(state, input) — the whole ruleset, pure
      food.js             → spawnFood(state) — seeded placement, board-full handling
      difficulty.js       → chill | classic | frantic presets + speed curve
      storage.js          → best score + last difficulty, private-mode safe
    render/
      canvas.js           → canvas renderer: DPR, interpolation, board/snake/apple/effect drawing
      palette.js          → color tokens shared by canvas drawing and CSS (single source of truth)
      svg.js              → (stretch, OQ-7) vector renderer behind ?renderer=svg
    ui/
      controller.js       → keyboard, swipe, D-pad, buttons, visibility/blur → input events + intents
      hud.js              → score/best/status DOM writes + overlays derived from state
      icons.js            → injects the SVG sprite, <svg><use> helper, aria rules for icons
      loop.js             → fixed-timestep loop with clamped catch-up
  assets/
    fonts/                → *.woff2 (subset), fonts.css, LICENSE-*.txt
    styles/               → base.css (tokens, layout, type), game.css (board, HUD, overlays), a11y.css
    icons/                → play.svg, pause.svg, restart.svg, arrow-*.svg, trophy.svg, volume-*.svg,
                            keyboard.svg, swipe.svg, moon.svg, sun.svg, info.svg, close.svg, snake.svg
                            + icons.svg (sprite of the same shapes as <symbol>)
    brand/                → snake-logo.svg, snake-poster.svg (the high-quality SVG artwork version)
    favicon.svg
  tools/
    fetch-fonts.mjs       → download + verify licenses + write fonts.css (setup-time only)
    build-single.mjs      → inline CSS/JS/fonts → dist/snake-standalone.html
    render-svg.mjs        → SVG → PNG preview via sharp
    sprite.mjs            → assets/icons/*.svg → icons.svg sprite (generated; source of truth = the files)
  tests/
    unit/                 → pure sim, rng, steering, food, difficulty, storage (no DOM at all)
    assets/               → SVG/font contract tests (parse, viewBox, currentColor, no external refs, budget)
    browser/              → smoke, input, lifecycle, a11y, motion
    build/                → single-file bundle: self-contained, plays from file://
    helpers/              → shared fixtures, fake storage, deterministic seed helper
  dist/                   → generated single-file bundle (never hand-edited)
  .build/                 → generated previews/screenshots (never hand-edited)
  SPEC.md · tasks/plan.md · tasks/todo.md
```

Layering rule, enforced by tests: `sim/` imports nothing outside `sim/`; `render/` and `ui/` may read
`sim/` but never mutate it; only `main.js` wires them together.

---

## 5. Design decisions (the ones that determine whether it feels good)

1. **Fixed-timestep simulation, interpolated render.**
   `STATE.targetMs` starts at 120 ms/tick and eases down to a floor of 60 ms as the snake grows.
   Render lerps each segment `alpha = acc / stepMs` between its previous and current cell, so the
   snake glides instead of snapping. A hard clamp of 5 catch-up ticks per frame prevents
   teleport-death after a stall.
2. **Pure sim, no DOM.** `step(state, input)` is a total function returning a new state; it never
   touches `window`, `document`, timers, or `Math.random`. This is what makes the game unit-testable
   and what makes replays/determinism possible.
3. **Input queue, not last-key-wins.** Keys push into a queue (max 2 pending). Each tick consumes one
   entry, discarding entries that would reverse into the neck. This kills the "pressed ↑ then ← in
   one tick and died" bug.
4. **Seeded RNG.** `mulberry32` seeded from a URL param (`?seed=123`) or random otherwise. Same seed
   ⇒ same food sequence ⇒ the browser tests are deterministic and a bug report is reproducible.
5. **Everything visual is drawn, not imaged.** Rounded-rect body with tapered tail, distinct head
   with eyes that face the travel direction, pulsing apple with a highlight, subtle checkerboard
   board, grid-aligned drop shadow. No external assets — the file stays self-contained.
6. **State machine is explicit:** `idle → playing ⇄ paused → over → playing`. Illegal transitions
   are ignored rather than throwing; overlays are derived from state, never mutated independently.

### Code style

One real snippet beats three paragraphs. Conventions: `camelCase` values, `SCREAMING_SNAKE` for
frozen config, pure functions for sim (`step`, `spawnFood`), `//` comments only where *why* is
non-obvious, no semicolon-free style, 2-space indent, single quotes, no abbreviations except
`x/y/vx/vy/ms`.

```js
// Pure: same (state, input) in ⇒ same state out. No DOM, no timers, no Math.random.
export function step(state, input) {
  if (state.status !== 'playing') return state;

  const dir = takeSteering(state.pending, state.dir);        // drops reversal + stale turns
  const head = { x: state.snake[0].x + dir.x, y: state.snake[0].y + dir.y };

  if (isWall(head, state.board) || hitsBody(head, state.snake, state.grows)) {
    return { ...state, dir, status: 'over', best: Math.max(state.best, state.score) };
  }

  const body = [head, ...state.snake];
  const eats = head.x === state.food.x && head.y === state.food.y;
  if (!eats) body.pop();                                     // tail lifts unless we grew

  const next = { ...state, dir, snake: body, pending: dropFirst(state.pending) };
  return eats ? { ...next, score: state.score + 1, food: spawnFood(next) } : next;
}
```

Naming you will see throughout: `state` (immutable sim snapshot), `input` (edge events since last
tick), `renderer` (the only thing that touches canvas), `controller` (the only thing that touches
DOM events), `boot()` in `src/main.js` (the only module with top-level side effects; `src/sim/*` stays
side-effect-free so Node can import it directly — asserted by the layering guard test, T11).

---

## 6. Testing Strategy

Two layers, because "it renders" and "the rules are right" are different claims.

- **Asset contracts (`tests/assets/`):** every `assets/icons/*.svg` parses, has a `viewBox`, uses
  `currentColor` (no hardcoded fills), contains no raster/base64 payload and no remote `xlink:href`;
  the sprite contains exactly one `<symbol>` per icon file with matching geometry; brand SVGs are
  self-contained and free of `<script>`/`<foreignObject>`; every font referenced by `fonts.css`
  exists on disk, is declared with `font-display: swap`, has a license file, and the family total is
  under budget; `src/sim/*` contains no `document`/`window`/`Math.random` reference (import-grammar
  test).
- **Logic (fast, no browser):** `node --test tests/unit/`. Modules are real ES modules imported
  directly by Node, so tests exercise **the shipped code path**, not a copy that can drift. Covers: straight movement, growth on food, tail-follow on straight
  run, wall death, self-collision, reversal rejection inside one tick and across two ticks, food
  never on body, food spawn when board nearly full (win/board-full handling), score = length − 3,
  speed curve monotonic and floored, seeded RNG reproducibility, best-score persistence incl.
  corrupt values.
- **Browser (real events, real canvas):** Playwright Chromium against `http://localhost:<port>/index.html`
  (static server started by the test harness) and, for the bundle, `file:///workspace/dist/snake-standalone.html`.
  Covers: no console errors on load or play, arrow keys / WASD / home-row (`hjkl`) all steer, a
  keyboard-only player can Tab to Start and press `Enter` to run it, `Space` starts and toggles pause,
  `P`/`Escape` pause and resume, the tab going hidden pauses a running game and becoming visible again
  does not resume it, swipe and the d-pad steer on a coarse pointer, restart returns to a fresh 3-cell
  snake, high score survives reload, `aria-live` announces game over, contrast of HUD text,
  0 requests to any origin other than the file itself.

  Two earlier promises were corrected rather than implemented. "blur auto-pauses" is narrower in the
  shipped game: only `document.hidden` pauses, because a window blur also fires when focus moves to
  devtools or a second monitor, which would pause on interactions that are not "I left". And `Enter` is
  not a global start key — it belongs to the focused control, so the overlay's real `<button>` activates
  with it and the handler deliberately hands the keystroke back.
- **Determinism in browser tests:** drive with `?seed=` and use the debug handle the page already
  exposes, `window.game` — live `state`, plus `pump(ms)` to advance the simulation by hand and `steer`,
  `run`, `restart`, `resize`, `cycleTheme`. Tests assert on state rather than pixels through it. Pixel assertions are limited to "canvas is not blank"
  plus a golden screenshot kept for human eyeballs, not asserted on byte equality.
- **Manual checklist** (documented at the bottom of `SPEC.md`, run once before "done"): keyboard-only
  full run, phone swipe run at 390 px, reduced-motion run, blur for 10 s mid-game, 120 Hz display
  smoothness, dark/light schemes.
- **Coverage expectation:** every branch of the pure sim reached (`step`, `takeSteering`,
  `spawnFood`, `hitTest`, `best` read/write); the render/controller layer is covered by browser
  tests rather than mocked, since mocking a canvas proves nothing.

---

## 7. Boundaries

**Always do**
- Keep runtime dependency-free and network-silent (0 requests to other origins; fonts/icons/art local).
- Vendor any font with its license file next to it, and assert the license exists in `tests/assets/`.
- Keep every UI icon as SVG authored in `assets/icons/*.svg` (the sprite is generated from them, never hand-edited).
- Keep sim pure and DOM-free; assert it in tests.
- Guard every browser API that can throw or be absent (`localStorage`, `matchMedia`, `navigator.vibrate`, AudioContext) — degrade silently.
- Run `node --test tests/` before calling any change done; run the browser suite before declaring the game done.
- Update this spec first when a design decision changes.

**Ask first**
- Adding any runtime JS dependency or any remote fetch (violates the network-silent constraint).
- Adding a new font family, or raising the font/artifact size budgets.
- Adding a new top-level directory or changing the `sim/ → render/ → ui/` import direction.
- Enabling sound by default.
- Changing the core rules from the classic game (see open questions — those are *proposals*, not decisions).
- Anything requiring network access (fonts, analytics, share links).

**Never do**
- Inline secrets, tracking, or telemetry of any kind.
- Reach the browser from the sim layer.
- Delete or skip a failing test to get green.
- Weaken a threshold (coverage, contrast, file size) to make a check pass — raise the code instead.

---

## 8. Success Criteria (definition of done)

**v2 asset/artifact criteria**

0a. `index.html` serves from a static server with **0 requests to any origin other than the host**
    (fonts, icons and art are local). Every icon in the UI is SVG.
0b. `assets/brand/snake-poster.svg` renders correctly at 16 × 16, 512 × 512 and 1600 × 1600 with no
    external references, and passes the asset contract tests (well-formed XML, `viewBox`, no
    `<script>`/`<foreignObject>`/remote `xlink:href`, no raster payloads).
0c. `dist/snake-standalone.html` builds, opens from `file://` with 0 console errors, is playable, and
    is < 500 KB (subset fonts included).
0d. Unit tests cover the sim **and** the asset contracts; both suites green.

**Carried over from v1**

1. `index.html` served over `http://localhost` in Chromium with **zero console errors** and playable within one keypress of load; `dist/snake-standalone.html` likewise from `file://`.
2. `node --test tests/` and `node --test tests/browser/` both pass; no test is skipped.
3. Rapid combo steering cannot kill the player (asserted by test, not by manual luck).
4. Movement is visibly smooth on a 60 Hz and a 120 Hz display (interpolated; no per-tick snapping).
5. Playable with keyboard only **and** with touch only; screen reader announces game-over and score.
6. High score persists across reload; deleting/corrupting the stored key does not break the game.
7. Dev bundle < 250 KB over the local server (fonts excluded from that number, counted separately);
   0 requests to any origin other than the local host (verified in DevTools Network).
8. The manual checklist in §6 has been walked and its results recorded in this spec.

---

## 9. Assumptions I'm making

1. **Multi-file is now allowed** (v2), but runtime stays network-silent: fonts/icons/art are local
   files, no CDN, no Google Fonts `<link>`. The single-file property moves to `dist/snake-standalone.html`.
2. **Tests are wanted** (you asked for unit tests): `tests/unit/` for logic, `tests/assets/` for the
   SVG/font contracts, `tests/browser/` for the real thing. Dev-only, not shipped.
2a. **Fonts are vendored at setup time** by `tools/fetch-fonts.mjs` (network is available and
    fonts.gstatic/jsdelivr both answered 200). If you prefer zero setup, I'll switch to a pure
    system-font stack and delete the font files.
3. **Classic rules:** walls kill (no wrap-around), self-collision kills, food grows the snake, speed rises with length.
4. **Single-player, single screen, no levels/modes** beyond difficulty selection (OQ-2) — no menus beyond a start overlay and a pause overlay.
5. **Dark-first visual design** with a light scheme via `prefers-color-scheme`; no theme toggle unless asked.
6. **English-only UI text**, hardcoded (no i18n layer).
7. **The browser test suite may download Chromium once** (`playwright install chromium`, ~150 MB into the shared toolchain volume). Not downloaded yet.
→ Correct me now or I'll proceed with these.

---

## 10. Open Questions

- **OQ-1 — Wrap-around or walls?** Guess: walls kill (classic, and it makes the speed curve meaningful). Alternative: toroidal wrap, which is more forgiving and better for a casual mobile audience.
- **OQ-2 — Difficulty selection?** Guess: three presets on the start overlay (Chill 150 ms / Classic 120 ms / Frantic 90 ms tick), remembering the last choice. Alternative: one fixed classic speed, simplest possible.
- **OQ-3 — Obstacles or special food?** Guess: none — pure classic board. Alternative: golden food (rare, +3, timed) adds spice at the cost of rule complexity.
- **OQ-4 — Sound?** Guess: subtle WebAudio blips, **muted by default**, `M` toggles. Alternative: no audio at all.
- **OQ-5 — Score display:** raw food count or points with a length multiplier (e.g. `+10 × speedTier`)? Guess: points with a small speed multiplier, since a high score that scales with survival feels better on a leaderboard of one.
- **OQ-6 — What exactly is "a high quality SVG version"?** Guess: poster-grade vector **artwork** (`assets/brand/snake-poster.svg`) plus a logo/mark and favicon derived from the same geometry — i.e. the game's art as one crisp, infinitely scalable vector piece. Alternative reading: an **SVG-rendered version of the gameplay** (vector board instead of canvas) — that is OQ-7.
- **OQ-7 — Is a vector gameplay renderer in scope?** Guess: not for v1 — canvas wins on frame budget for interpolated motion; ship `?renderer=svg` as a stretch task (Task 17) only if you want it.
- **OQ-8 — Font choice?** Guess: `Space Grotesk` (UI) + `Silkscreen` (arcade numerals), both SIL OFL, latin subset ≈ 15–25 KB each. Alternative: one family only, or a system-font stack with no files at all.
- **OQ-9 — Is the generated `dist/snake-standalone.html` wanted?** Guess: yes — it keeps the original "double-click one file, offline" promise (plan task T18). If you don't care about it, drop T18 and keep `tools/render-svg.mjs` for previews only.

---

## 11. Manual verification record

Every item below was exercised in Chromium (Playwright, headless) against `index.html` on
`http://localhost`, and the offline items against `dist/snake-standalone.html` over `file://`.

- [x] Keyboard-only: start → steer → eat → pause → resume → die → restart, no mouse — `gameplay.spec`
- [x] Touch: d-pad visible at 420 × 820, swipe steers, taps on the board start the run — `gameplay.spec`
- [x] `prefers-reduced-motion: reduce` → animations removed, game still playable — `app.spec`
- [x] Tab hidden mid-game → auto-pause, and a 9 s stall runs at most 5 catch-up ticks — `gameplay.spec`
- [~] High refresh rate → physics never depends on frame timing (fixed timestep + `alpha`
      interpolation, covered by the stall test), but actual glide on 120 Hz hardware was not measured
      in CI — no such device here
- [x] HiDPI → backing store = CSS size × deviceScaleFactor (checked at 2×) — `app.spec`
- [x] Light + dark + auto → contrast asserted numerically (≥ 4.5:1 on text tokens) and the canvas
      re-reads its palette per theme — `palette.spec`, `app.spec`
- [x] Network: the `file://` bundle issues 0 external requests — `standalone.spec`; the dev page loads
      only its own files
- [x] Console: boot with an empty console (errors and warnings) — `app.spec`
- [x] Determinism: the same seed plus the same inputs replays to the same trace — `gameplay.spec`

| Date | Reviewer | Result |
|---|---|---|
| 2026-10-27 | Automated suite (`npm run test:all`) | 95 unit/asset/build + 25 browser tests, all green |
