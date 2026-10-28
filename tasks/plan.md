# Implementation Plan: Snake (multi-file, SVG art + local fonts, playable + tested)

Consumes `SPEC.md` v2. Task list target: `tasks/todo.md` (markdown checklists, no external tracker).
Status: **shipped** — T1–T20 are complete and green; T21 (stretch, vector gameplay renderer) was
deliberately not built. Deviations from the plan, all recorded in `SPEC.md` and `README.md`:
the icon roster differs (14 icons: `play, pause, restart, sound-on, sound-off, trophy, keyboard,
swipe, moon, sun, theme, heart, apple, snake`), styles live in one `assets/styles/styles.css` rather
than four files, the test seam is `window.game` (not `__snake`) and exposes `pump`/`steer`/`cycleTheme`,
SVG rasterising uses Playwright rather than `sharp`, and the `?renderer=svg` seam never got a second
implementation, so `src/render/` has exactly one renderer behind a documented interface.

---

## Overview

Build a polished Snake game as a small, clean multi-file project: ES-module source under `src/`
(pure sim → renderer → UI controller), locally vendored fonts, a hand-authored SVG icon set, and a
poster-grade SVG artwork version under `assets/brand/`. Ship it playable over a static server, prove
the rules with Node unit tests and the product with Playwright browser tests, and generate
`dist/snake-standalone.html` so the original "double-click one file, offline" property survives.

## Architecture Decisions

- **AD-1 — Pure sim core, DOM-free.** `src/sim/*` are total pure functions over an immutable
  `state` snapshot: `step(state, input) → state`. No `document`, `window`, timers, or `Math.random`.
  This is what makes the rules unit-testable in Node without a browser and what makes runs
  reproducible. Enforced by a guard test (Task 11), not by convention.
- **AD-2 — Real ES modules, so tests import the shipped code.** v1 needed a script-extraction hack;
  multi-file removes it. `node --test tests/unit/` imports `src/sim/*.js` directly — zero drift
  between tested and shipped code. Dev runs over `http://localhost` (modules + `file://` don't mix);
  the `file://` story moves to the generated bundle (AD-6).
- **AD-3 — Fixed timestep + interpolated render.** Sim ticks at `difficulty.tickMs`; render lerps
  segment positions with `alpha = acc / tickMs`, clamped to 5 catch-up ticks/frame. Smooth on 60 Hz
  and 120 Hz; no spiral-of-death teleport-death.
- **AD-4 — Input queue with reversal guard.** Keys push into a queue (max 2); each tick consumes one
  legal turn, dropping neck-reversals and stale turns. Kills the "↑ then ← in one tick = death" bug.
- **AD-5 — Seeded RNG (`mulberry32`).** `?seed=123` fixes the food sequence ⇒ deterministic browser
  tests and reproducible bug reports. Test seam: `window.__snake = { state(), tick(n), seed() }`,
  ~10 lines in `main.js`, documented in-file.
- **AD-6 — Single-file bundle is a build output, not the source.** `tools/build-single.mjs` inlines
  CSS + JS + base64 fonts into `dist/snake-standalone.html`, verified to make 0 external requests.
- **AD-7 — Icons: files are the source of truth, sprite is generated.** Author `assets/icons/*.svg`
  (24 × 24 grid, stroke, `currentColor`); `tools/sprite.mjs` emits `icons.svg` (`<symbol>`s);
  `src/ui/icons.js` injects the sprite once so `<svg><use href="#i-play">` inherits text color and
  theme. Hand-editing the sprite is forbidden by a test that regenerates and diffs it.
- **AD-8 — Canvas for gameplay, SVG for everything else.** Interpolated motion at 60 fps is a canvas
  job; icons, overlays, HUD chrome and branding are SVG (crisp, themeable, tiny). A vector gameplay
  renderer (`?renderer=svg`) is isolated behind one interface as a stretch task (T21) so it can be
  dropped without touching the sim.
- **AD-9 — One palette, two consumers.** `src/render/palette.js` exports the color tokens; CSS custom
  properties in `assets/styles/base.css` declare the same values. A test asserts they match, so the
  canvas board and the DOM chrome can never drift apart.
- **AD-10 — Fonts vendored at setup, never fetched at runtime.** `tools/fetch-fonts.mjs` downloads
  latin-subset `.woff2` (Space Grotesk UI + Silkscreen arcade accents, both SIL OFL), writes
  `fonts.css` with `font-display: swap` and a system fallback stack, and drops the license files.
  Network is confirmed reachable (fonts.googleapis.com and jsdelivr both returned 200 in this
  session); if a later run is offline, the tool exits with a clear message and the fallback stack
  keeps the game looking right.

## Dependency Graph

```
T1 fonts ─┐
T2 icons ─┼─→ T4 page shell (html + styles + sprite injection) ─┐
T3 brand art ┘                                                  │
                                                                ├─→ T16 main.js → PLAYABLE ─→ T17 a11y ─→ T18 bundle ─→ T19 polish ─→ T20 docs
T5 state+rng ─→ T6 step (move/grow/kill) ─┬─→ T12 canvas renderer ──┤                          (T21 stretch svg renderer)
                    ├─→ T7 steering queue ─┤                                              (needs T16)
                    ├─→ T8 food spawn ─────┤
                    ├─→ T9 difficulty+score┤
                    └─→ T10 storage ───────┘
T11 purity guard ← traces T5–T10 (any time after T6)
T13 loop math (independent of renderer) ─────────────────────────┘
T14 controller (needs T6 signatures; DOM events) ────────────────┘
T15 HUD/overlays (needs T4 shell + state shape) ─────────────────┘
```

Build order: **foundations (T1–T4) → rules (T5–T11) → playable slice (T12–T16) → quality (T17–T20)**,
with T21 optional. Vertical-slice note: the first moment the game is *playable* is T16, and it stays
playable from there — every later task changes quality, never viability.

## Task List

### Phase 1 — Foundations: assets, tooling, shell

- [x] **T1: Vendor fonts locally with licenses + font contract test**
  `tools/fetch-fonts.mjs` downloads latin-subset `space-grotesk` 400/700 and `silkscreen` 400 `.woff2`
  into `assets/fonts/`, writes `fonts.css` (`@font-face`, `font-display: swap`, fallback stack) and
  saves each OFL license as `LICENSE-<family>.txt`.
  **Acceptance:** files exist and are non-empty; family total < 80 KB; `fonts.css` references only
  relative paths; no network at page load; fallback stack renders acceptably when fonts are removed.
  **Verify:** `node tools/fetch-fonts.mjs` then `node --test tests/assets/fonts.spec.mjs`.
  **Depends:** none · **Files:** `tools/fetch-fonts.mjs`, `assets/fonts/*`, `tests/assets/fonts.spec.mjs` · **Size:** M

- [x] **T2: Author the SVG icon set + generated sprite**
  Hand-author `assets/icons/*.svg` on a 24 × 24 grid, stroke-based, `currentColor`, `stroke-width` 1.75:
  `play, pause, restart, arrow-up, arrow-right, arrow-down, arrow-left, trophy, volume-on, volume-off,
  keyboard, swipe, moon, sun, info, close, snake`. `tools/sprite.mjs` concatenates them into
  `assets/icons/icons.svg` as `<symbol id="i-*">`.
  **Acceptance:** every icon parses, has `viewBox="0 0 24 24"`, no hardcoded fill, no raster, no remote
  `xlink:href`; sprite regenerates byte-identically; names unique and kebab-cased.
  **Verify:** `node tools/sprite.mjs && node --test tests/assets/icons.spec.mjs` (test regenerates to a
  temp file and diffs against the committed sprite).
  **Depends:** none · **Files:** `assets/icons/*.svg`, `tools/sprite.mjs`, `tests/assets/icons.spec.mjs` · **Size:** M

- [x] **T3: High-quality SVG artwork version (poster, logo, favicon)**
  Author `assets/brand/snake-poster.svg` (board + gradient snake body with directional eyes + apple
  with highlight + grid + soft glow, self-contained gradients), `snake-logo.svg` (mark + wordmark) and
  `assets/favicon.svg` sharing one geometry vocabulary. `tools/render-svg.mjs` rasterizes previews via
  `sharp` for human review (PNGs land in `.build/`, never shipped).
  **Acceptance:** renders correctly at 16, 512 and 1600 px; 0 external refs; no `<script>`/
  `<foreignObject>`/base64 raster; passes brand contract test; human-approved preview screenshot.
  **Verify:** `node tools/render-svg.mjs assets/brand/snake-poster.svg .build/poster.png 1600` (eyeball)
  and `node --test tests/assets/brand.spec.mjs`.
  **Depends:** none (palette values must match `base.css` tokens — asserted) · **Files:** `assets/brand/*.svg`, `assets/favicon.svg`, `tools/render-svg.mjs`, `tests/assets/brand.spec.mjs` · **Size:** M

- [x] **T4: Page shell — HTML, styles, theme tokens, sprite injection**
  `index.html` (HUD, canvas host, overlays, D-pad, buttons wired to icons), `assets/styles/base.css`
  (tokens, layout, fluid type via `clamp()`, dark-first + `prefers-color-scheme`), `game.css`,
  `a11y.css` (focus rings, `.sr-only`, reduced-motion overrides), `src/ui/icons.js`.
  **Acceptance:** page renders at 320 px → 4K with no horizontal scroll; HUD text contrast ≥ 4.5:1 in
  both schemes; icons visible and inheriting text color; `palette.js` and CSS tokens agree.
  **Verify:** serve + eyeball at 320/768/1440; `node --test tests/assets/palette.spec.mjs`;
  `node --test tests/browser/shell.spec.mjs` (no console errors, no layout overflow at 320 px).
  **Depends:** T1, T2 · **Files:** `index.html`, `assets/styles/*.css`, `src/ui/icons.js`, `src/render/palette.js`, `tests/browser/shell.spec.mjs` · **Size:** M

### Checkpoint A — Foundations
- [x] `node --test tests/assets/` green (fonts, icons, brand, palette)
- [x] Shell serves with 0 console errors, 0 requests to any other origin
- [ ] Poster/logo previews reviewed by the human before gameplay work starts

### Phase 2 — Core rules (pure sim, test-first)

- [x] **T5: State factory + seeded RNG**
  `constants.js` (board 24 × 18, tick presets, scoring table), `rng.js` (`mulberry32`), `state.js`
  (`createState({ seed, difficulty })` → 3-cell snake, first food, `status: 'idle'`).
  **Acceptance:** same seed ⇒ deep-equal state; different seeds differ; no `Math.random` anywhere in `src/sim/`.
  **Verify:** `node --test tests/unit/state.spec.mjs tests/unit/rng.spec.mjs`.
  **Depends:** none · **Files:** `src/sim/{constants,rng,state}.js`, `tests/unit/{state,rng}.spec.mjs` · **Size:** S

- [x] **T6: `step()` — movement, growth, wall and self collision**
  Write tests first, then the function. Tail lifts unless growing; growth defers one tick so the
  snake does not duplicate a cell; wall ⇒ `over`; self-collision ignores the cell the tail is
  vacating (classic forgiveness); `score` and `snake.length` stay consistent invariants.
  **Acceptance:** straight-line movement wraps never (walls kill); growth adds exactly 1 length;
  death sets `status: 'over'` and freezes further steps; 20+ assertions incl. invariant checks over a
  500-tick scripted run.
  **Verify:** `node --test tests/unit/step.spec.mjs`.
  **Depends:** T5 · **Files:** `src/sim/step.js`, `tests/unit/step.spec.mjs` · **Size:** M

- [x] **T7: Steering queue + reversal guard**
  `pushInput(state, dir)` / `takeSteering(pending, dir)`: max 2 queued, reversal into the neck
  dropped, duplicate same-direction turns collapsed, one turn consumed per tick.
  **Acceptance:** pressing ↑ then ← within one tick cannot kill a rightward snake; two queued turns
  both apply on consecutive ticks; queue overflow drops the oldest, not the newest.
  **Verify:** `node --test tests/unit/steering.spec.mjs` (incl. the combo-regression test).
  **Depends:** T5 · **Files:** `src/sim/steering.js`, `tests/unit/steering.spec.mjs` · **Size:** S

- [x] **T8: Food placement**
  `spawnFood(state)` picks uniformly among *free* cells using the seeded RNG; when no free cell
  remains, returns a `won` status rather than looping forever.
  **Acceptance:** food never on the snake across 10 000 seeded placements; distribution sanity
  (χ²-ish bucket test, loose threshold); near-full board terminates; sequence reproducible by seed.
  **Verify:** `node --test tests/unit/food.spec.mjs`.
  **Depends:** T5 · **Files:** `src/sim/food.js`, `tests/unit/food.spec.mjs` · **Size:** S

- [x] **T9: Difficulty presets, speed curve, scoring**
  `difficulty.js`: chill 150 / classic 120 / frantic 90 ms base tick, easing to a 60 ms floor as
  length grows; score = `+10 × tier` per food (OQ-5), best-of stored per difficulty.
  **Acceptance:** curve monotonically non-increasing and floored; presets selectable and validated
  (unknown preset ⇒ classic, no throw); score matches the table for scripted runs.
  **Verify:** `node --test tests/unit/difficulty.spec.mjs tests/unit/score.spec.mjs`.
  **Depends:** T5, T6 · **Files:** `src/sim/difficulty.js`, `tests/unit/{difficulty,score}.spec.mjs` · **Size:** S

- [x] **T10: Best score + settings storage**
  `storage.js`: `readBest/readSettings/writeBest/writeSettings` behind an injected storage object
  (test double in unit tests), try/catch on every access, corrupt JSON or wrong types ⇒ defaults.
  **Acceptance:** corrupt value, quota throw, and absent `localStorage` all degrade to defaults
  without throwing; best only increases; difficulty round-trips.
  **Verify:** `node --test tests/unit/storage.spec.mjs`.
  **Depends:** T5, T9 · **Files:** `src/sim/storage.js`, `tests/unit/storage.spec.mjs` · **Size:** S

- [x] **T11: Purity and layering guard test**
  Static test over `src/sim/**`: no `document|window|localStorage|Math.random|setTimeout`;
  no import outside `src/sim/`; `render/` and `ui/` never import each other's internals.
  **Acceptance:** guard fails if a future edit reaches the DOM from the sim; error message names the
  offending file and line.
  **Verify:** `node --test tests/unit/layering.spec.mjs` (and confirm it fails when a violation is
  injected locally, then revert).
  **Depends:** T6 · **Files:** `tests/unit/layering.spec.mjs` · **Size:** XS

### Checkpoint B — Rules proven without a browser
- [x] `node --test tests/unit/` green; no skipped tests
- [x] Classic-rule edge cases all asserted (reversal combo, tail-vacate, board-full, corrupt storage)
- [ ] Review with human before wiring the UI

### Phase 3 — Playable slice

- [x] **T12: Canvas renderer with interpolation**
  DPR-aware sizing, checkerboard board with inset border, snake drawn as a rounded path from
  interpolated segment centers with tapered tail, head with eyes facing travel, pulsing apple,
  `prefers-reduced-motion` disables the pulse.
  **Acceptance:** crisp on 2× DPR; identical sim state ⇒ identical draw; render mutates no state
  (asserted by snapshot compare); frame cost < 4 ms for a 40-segment snake (measured in-browser).
  **Verify:** `node --test tests/browser/render.spec.mjs` (canvas not blank, perf sample, state
  snapshot unchanged after 30 renders) + golden screenshot in `.build/` for eyeballs.
  **Depends:** T4, T6 · **Files:** `src/render/canvas.js`, `tests/browser/render.spec.mjs` · **Size:** M

- [x] **T13: Fixed-timestep loop with clamped catch-up**
  `ui/loop.js`: accumulator, ≤ 5 ticks/frame, `alpha` exposed for interpolation, pause stops
  accumulation, `document.visibilityState` hidden ⇒ pause intent.
  **Acceptance:** 1000 ms of fake time at tickMs 120 yields exactly 8 ticks; a 3 s stall yields ≤ 5
  ticks and no death; alpha always in [0,1).
  **Verify:** `node --test tests/unit/loop.spec.mjs` (loop driven by an injected clock).
  **Depends:** T6 · **Files:** `src/ui/loop.js`, `tests/unit/loop.spec.mjs` · **Size:** S

- [x] **T14: Controller — keyboard, swipe, D-pad, buttons, blur**
  Arrows + WASD (never `preventDefault` outside the game region), `Space`/`Escape` pause, `Enter`
  start/restart, `M` mute, pointer swipe with 24 px dead zone, `touch-action: none` on the board,
  D-pad buttons, `visibilitychange` auto-pause.
  **Acceptance:** real `ArrowLeft` and `KeyA` both steer; swipe left steers and does not scroll the
  page; blur mid-game ⇒ paused, not dead; no console errors from an unhandled event.
  **Verify:** `node --test tests/browser/input.spec.mjs tests/browser/lifecycle.spec.mjs`.
  **Depends:** T6, T7, T13 · **Files:** `src/ui/controller.js`, `tests/browser/{input,lifecycle}.spec.mjs` · **Size:** M

- [x] **T15: HUD + overlays + live region**
  Score, best, difficulty, and status written from state only; overlays for idle/playing/paused/
  over/won; `aria-live="polite"` announcements for +1, PAUSED, GAME OVER + final score; overlay
  buttons are real focusable `<button>`s with SVG icons + accessible names.
  **Acceptance:** HUD text always equals state-derived values (no independent mutation); every
  overlay reachable by keyboard with visible focus; game-over announcement appears in the a11y tree.
  **Verify:** `node --test tests/browser/hud.spec.mjs`; manual tab-through.
  **Depends:** T4, T6 · **Files:** `src/ui/hud.js`, `tests/browser/hud.spec.mjs` · **Size:** M

- [x] **T16: `main.js` wiring — first playable build**
  Boot: read `?seed`/`?renderer`, load settings, create state, wire loop + renderer + controller +
  HUD, install the `window.__snake` test seam.
  **Acceptance:** from a fresh page load, `Enter` starts and the snake can be steered to eat and die;
  0 console errors; bundle-free dev server serves everything locally.
  **Verify:** `node --test tests/browser/smoke.spec.mjs` + a manual 2-minute play session.
  **Depends:** T12, T13, T14, T15 · **Files:** `src/main.js`, `tests/browser/smoke.spec.mjs` · **Size:** S

### Checkpoint C — Playable (this is the "make it playable" gate)
- [x] Full session by keyboard only: start → eat ≥ 15 → pause → resume → die → restart
- [x] `node --test tests/` green (unit + assets + browser)
- [ ] Review with human before polish

### Phase 4 — Quality, artifacts, docs

- [x] **T17: Accessibility pass**
  Shape-distinguishes-food-from-snake (colorblind-safe, asserted via palette+shape test), contrast
  audit, visible focus, reduced-motion path, keyboard-only completion, `aria-live` verified,
  screen-reader-readable status, no keyboard trap in overlays.
  **Acceptance:** axe-core (or the project's contrast/role probes) reports 0 serious violations on
  the start, playing and game-over screens; keyboard-only run completes.
  **Verify:** `node --test tests/browser/a11y.spec.mjs`.
  **Depends:** T16 · **Files:** `assets/styles/a11y.css`, `src/ui/{hud,controller}.js`, `src/render/canvas.js`, `tests/browser/a11y.spec.mjs` · **Size:** M

- [x] **T18: Single-file bundle build + self-containment test**
  `tools/build-single.mjs` inlines stylesheets, ES modules (concatenated in dependency order, no
  bare imports left) and base64 fonts into `dist/snake-standalone.html`.
  **Acceptance:** bundle opens from `file://`, plays, 0 console errors, 0 requests beyond the file
  itself, < 500 KB; unit tests still run against `src/` (bundle is generated, never tested as source).
  **Verify:** `node tools/build-single.mjs && node --test tests/build/`.
  **Depends:** T16 · **Files:** `tools/build-single.mjs`, `dist/snake-standalone.html`, `tests/build/bundle.spec.mjs` · **Size:** M

- [x] **T19: Motion + feel polish (juice), then manual checklist**
  Food-eat pop, death flash + brief shake (respecting reduced motion), smooth score roll, start
  countdown, sound blips behind a muted-by-default toggle (OQ-4), golden screenshots per screen.
  **Acceptance:** none of it drops frames (perf sample < 4 ms); all effects disabled under
  `prefers-reduced-motion`; §11 checklist in `SPEC.md` walked and results recorded.
  **Verify:** `node --test tests/browser/motion.spec.mjs` + manual checklist walk.
  **Depends:** T16, T17 · **Files:** `src/render/canvas.js`, `src/ui/{controller,hud}.js`, `src/sim/audio.js`, `tests/browser/motion.spec.mjs` · **Size:** M

- [x] **T20: README + how to run/test**
  Short `README.md`: play (dev server + bundle), test commands, project map, font/icon licensing.
  **Acceptance:** a newcomer can play and run all tests from the README alone.
  **Verify:** follow the README top to bottom in a clean shell.
  **Depends:** T18 · **Files:** `README.md` · **Size:** S

- [ ] **T21 (stretch, OQ-7): SVG gameplay renderer behind `?renderer=svg`**
  Implement the `Renderer` interface in `src/render/svg.js` (transform-per-segment, no per-frame DOM
  rebuild) so the vector version of the *gameplay* exists too.
  **Acceptance:** identical sim ⇒ identical visual state at tick boundaries; no frame-budget
  regression > 2 ms at 40 segments; sim untouched (T11 still green).
  **Verify:** `node --test tests/browser/svg-renderer.spec.mjs`.
  **Depends:** T12, T16 · **Files:** `src/render/svg.js`, `tests/browser/svg-renderer.spec.mjs` · **Size:** M

### Phase 7 — Test-suite trustworthiness

- [x] **T22: Browser specs name only things that exist**
  Six invented selectors (11 sites) and the wrong state key were the entire browser failure set; four
  further assertions compared `undefined === undefined` and had been passing vacuously.
  **Acceptance:** `npm run test:browser` green on three consecutive runs; no assertion reads a key that
  `readState()` does not return. **Met** — 24/24, plus five shipped defects found (loop fast-forward on
  start, difficulty preset killing its own clock, idle heading refused, unpausable frozen game, sound
  button's inverted `aria-pressed`). Two new unit tests cover the loop and queueing fixes.
  **Verify:** `npm run check` → exit 0, 98 headless + 24 browser.
  **Depends:** none · **Files:** `tests/browser/*.spec.mjs`, `tests/helpers/browser.mjs`, `src/ui/{loop,controller,input,hud}.js`, `src/sim/step.js` · **Size:** M

- [ ] **T23: Contract test that fails the moment a spec drifts from the DOM**
  New `tests/build/dom-contract.spec.mjs`: extract every `#id` / `[data-*]` / class literal from
  `tests/browser/*.spec.mjs` and assert each resolves in `index.html`; assert every property read off a
  `readState()` result is one of the keys the helper returns. Includes a mutation probe (inject a bogus
  selector into a temp copy, assert the test fails) in the style of `layering.spec`.
  **Acceptance:** green today; red on an injected selector.
  **Verify:** `node --test tests/build/` · **Depends:** T22 · **Files:** `tests/build/dom-contract.spec.mjs` · **Size:** M

## Parallelization

- **Safe in parallel:** T1, T2, T3 (independent assets); tests for T5–T10 can be written before their
  implementations (TDD); T17/T20 are independent of T18.
- **Must be sequential:** T6 → T12/T13/T14/T15 → T16 (shared `state` shape; freeze it at T6 and record
  it in `src/sim/state.js` JSDoc so parallel work has a contract); T18 after T16.
- **Needs a contract first:** the `Renderer` interface (canvas vs svg) and the `state` snapshot shape —
  both frozen during T6/T12 and documented before T21 starts.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Playwright module is global-only (`/opt/shared-tooling/npm/lib/node_modules/playwright`), ESM can't resolve it by bare specifier | Med | `tests/helpers/browser.mjs` tries `import('playwright')` then falls back to the absolute path; if both fail, browser tests skip with an explicit message and unit tests still gate (never silently skip) |
| Chromium not downloaded yet (~150 MB) | Med | `playwright install chromium` is a setup task (T14 prerequisite); unit + asset suites run without it |
| ES modules + `file://` CORS | Med | Dev = static server; `file://` support tested only for the inlined bundle (T18) |
| Google Fonts fetch blocked later / font subset too big | Med | `fetch-fonts.mjs` verifies bytes + licenses and fails loudly; fallback stack keeps layout; budget asserted in `tests/assets/fonts.spec.mjs` |
| Sprite drift (hand-editing `icons.svg`) | Low | T2 test regenerates and diffs; CI-visible failure names the icon |
| Interpolation bugs look like sim bugs | Med | Renderer test asserts sim state snapshot unchanged by drawing; loop tests use an injected clock, so timing is proven headlessly |
| "High quality" stays subjective | Med | §1 criteria in `SPEC.md` + T17/T19 measurable checks + golden screenshots reviewed by the human at Checkpoints A and C |
| Poster SVG bloats with gradients/filters | Low | Budget check (< 60 KB) in brand test; filters replaced by layered paths if it blows up |

## Test Commands (all green = done)

```bash
node --test tests/unit/       # rules, loop math, storage  — no browser
node --test tests/assets/     # fonts, icons, sprite, brand art, palette contract
node --test tests/browser/    # real events, real canvas, lifecycle, a11y, motion
node --test tests/build/      # single-file bundle: self-contained + plays from file://
node --test tests/            # everything
```

## Open Questions (inherited from `SPEC.md` §10 — defaults are already chosen)

- **OQ-1** walls kill (default) vs wrap-around.
- **OQ-2** three difficulty presets (default) vs one fixed speed.
- **OQ-3** pure classic board (default) vs golden food / obstacles.
- **OQ-4** audio muted-by-default (default) vs no audio at all.
- **OQ-5** points with speed multiplier (default) vs raw food count.
- **OQ-6** "high quality SVG version" = poster/logo artwork (default, T3) — confirm that's the intent.
- **OQ-7** vector gameplay renderer in scope? (default: stretch T21 only).
- **OQ-8** fonts: Space Grotesk + Silkscreen, OFL, subset (default) — or system stack with no files.
- **OQ-9** keep the generated `dist/snake-standalone.html`? (default: yes).

Defaults are wired into the tasks above, so "go with defaults" is a complete answer — T1–T16 proceed
without waiting on any of these.

## Definition of Done (per task, from `references/definition-of-done.md`)

Every task lands with: tests written/updated and passing, no new console errors, no skipped or
weakened assertions, spec updated if a design decision changed, and the task checked off in
`tasks/todo.md` in the same session it was completed.
