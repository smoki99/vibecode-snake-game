# Snake

A production-grade Snake: a fixed-timestep arcade game that boots from a single HTML file with no
network access at all, and ships as a real multi-file ES-module project with a deterministic
simulation core, an interpolated canvas renderer, vendored fonts, hand-authored SVG icons and
artwork, theming, persistence and a 119-test automated suite (95 headless, 24 in a real browser).

> A temporary public preview of this build is linked at the end of this file — it is a throwaway
> tunnel for review, not part of the project.

## Run it

```bash
npm run setup     # vendor the fonts (once; needs network, the game itself never does)
npm run serve     # dev server → http://localhost:8080
npm test          # 95 unit + asset + build tests, no browser, seconds
npm run check     # sprite check + bundle build + everything, including the browser suite
```

Or just open `dist/snake-standalone.html` in a browser. That file is the whole game — JS, CSS,
fonts, icons, favicon — inlined into 135 KB with zero requests, and it is a **build output**:
edit `src/`, then `npm run build` regenerates it.

## Controls

| Key | Action |
| --- | --- |
| `↑↓←→` `wasd` `hjkl` | Steer (buffered, reversal-safe) |
| `Space` `Enter` | Start / resume |
| `P` `Esc` | Pause |
| `R` | New run, same difficulty |
| `1` `2` `3` | Difficulty: chill, classic, frantic |
| `M` | Sound on / off |
| `T` | Theme: dark → light → auto |
| swipe / d-pad | Steering and start on touch |

URL parameters — `?seed=42`, `?difficulty=frantic`, `?theme=light`, `?autoplay=1` — override the
stored settings without persisting.

## Architecture

```
src/sim/      constants rng difficulty steering food state step storage   ← DOM-free, deterministic
src/render/   palette canvas                                              ← canvas 2D, reads CSS tokens
src/ui/       loop controller hud input audio icons main                  ← the only DOM-facing layer
assets/       fonts/ (vendored woff2 + OFL) icons/ (SVG source) brand/ (SVG artwork) styles/
tools/        build, dev-server, sprite generator, SVG rasteriser, font vendoring, stale-process reaper
tests/        unit/ assets/ browser/ build/
```

**Dependency rule, enforced by a test:** `sim → nothing`; `render → sim`; `ui → sim + render`;
`main.js` is the only composition root. The simulation imports no DOM, no `performance`, no
`Math.random` — it takes a seeded RNG (mulberry32) and a tick count, so a run is fully reproducible
from `seed + inputs`.

**Fixed timestep, interpolated render.** `src/ui/loop.js` accumulates real time, runs whole
simulation ticks (capped at 5 per frame so a backgrounded tab cannot spiral), and hands the renderer
an `alpha = acc / stepMs` used to interpolate the head and tail. Motion stays smooth even when the
tick is 60 ms and the display is 144 Hz.

**Input is queued, not applied.** Up to two turns are buffered and each is checked for reversal
against the *heading the queue will produce*, so a fast two-stage feint (`←` then `↑` while moving
right) registers correctly instead of being silently dropped.

**One palette, two consumers.** `src/render/palette.js` mirrors the CSS custom properties; the
canvas reads the applied values at runtime, so the dark/light/auto themes recolour the board
without a second source of truth. Contrast is tested.

**Assets are files, and every one is local.** Space Grotesk + Silkscreen (SIL OFL) are subset to
latin and vendored as woff2 with their licences and a checksummed manifest. All 14 icons are
hand-authored SVG on a 24×24 grid, generated into a sprite that tests keep in sync with the source
directory. The brand artwork (poster, logo, favicon, OG card) is pure vector, with raster exports
generated into `dist/brand/` for the contexts that require a bitmap.

**Storage is defensive.** Best scores per difficulty and settings (difficulty, mute, theme) live in
`localStorage` behind a versioned key; a corrupt value falls back to defaults rather than throwing.

## Tests

```bash
npm test          # 95 unit + asset + build tests, no browser, seconds
npm run test:browser   # 24 Playwright tests against the built bundle, the dev page and file://
npm run test:all       # both
```

`gameplay.spec.mjs` drives the **bundle** (`dist/snake-standalone.html`) over HTTP rather than the
dev page: one request instead of a thirty-module graph — which is the difference between a second
and a minute on a loaded machine — and it is the artifact that actually ships. `app.spec.mjs`
deliberately loads the multi-file dev page, because that page's module graph, sprite injection and
theme wiring are what it asserts. Both are served by the same static server on a random port;
nothing in the suite binds a fixed port.

Two defences against a contended CI host, both learned the hard way rather than designed in:
`warmUp()` opens one throwaway page per file so the cost of Chromium's cold input pipeline is not
charged to whichever test happens to run first (it is time-boxed, so a wedged warm-up cannot fail
the file), and every keystroke goes through `press()`, which waits for a delivery counter that the
test itself installs on `window` in the bubble phase — after the game's handler — so the wait proves
the key arrived and was processed, without excusing any behaviour the assertions check.

- **Unit** (`tests/unit`) — RNG determinism, state machine, every death rule and the
  tail-vacates exception, input buffering, food spawning away from the snake, difficulty curves,
  storage corruption, loop catch-up, and a layering guard that fails the build if `sim/` ever
  reaches for the DOM.
- **Asset** (`tests/assets`) — icon grid/colour/title/fill constraints, sprite ↔ source sync
  (regenerated and diffed), font manifest checksums, OFL licences present, CSS references resolve.
- **Build** (`tests/build`) — the bundle exists, is newer than its inputs, contains no network
  references, embeds fonts/sprite/favicon, and stays under size budget.
- **Browser** (`tests/browser`) — boots clean, paints, DPR-aware, a11y wiring, reduced motion,
  theme switching, and real gameplay: steering, buffered feints, eating, both death causes, pause,
  restart, difficulty, touch, tab-stall capping, and a seeded replay that proves the sim is
  reproducible in the shipped bundle.

## Design decisions

- **Deterministic core first.** The sim is a pure function of state + input + RNG, which is what
  makes a seeded replay test possible and keeps gameplay free of timing jitter.
- **Interpolation over variable steps.** Rendering never advances physics; it renders between two
  ticks. Variable-step physics would make gameplay frame-rate dependent.
- **Buffered input with a chain-aware reversal guard.** Players press two keys quickly; dropping the
  second because it looked like a reversal against the *current* heading feels like dropped input.
- **Files over inlining, bundle as output.** The repo is a normal multi-file project (reviewable,
  testable, lintable); the single-file artefact is a build output so the offline promise survives.
- **Canvas for the board, SVG for everything else.** Icons and artwork need to scale infinitely and
  be editable as text; the board needs a 60 fps pixel budget.
- **Colour is never the only signal.** Difficulty pills carry rank text, death messages name the
  cause, the apple carries a leaf and a halo, and the palette is checked for 4.5:1 text contrast.
- **Accessibility as plumbing, not a layer.** Skip link, `aria-live` status announcements, focus
  rings, `prefers-reduced-motion` (no pulse, no scanlines), touch targets ≥ 44 px, keyboard-first.

## Known limits

- The tab-stall cap means a long backgrounded pause fast-forwards at most 5 ticks, then pauses —
  deliberate, but it is a behaviour choice, not a law.
- `dist/brand/` rasters are generated; edit the SVG sources, not the PNGs.
- No service worker: the single-file bundle needs no cache because it is one file you already have.
- The browser suite is CPU-hungry (three Chromium instances). On a shared or throttled machine run it
  with `--test-concurrency=1`; `tools/reap-stale.mjs` clears browsers wedged by a killed run.

## Temporary preview

`https://select-respiratory-breakfast-cheapest.trycloudflare.com` — a throwaway `cloudflared`
tunnel to the dev server for review. It dies with this sandbox and is not a deployment; the game
itself has no server-side component.
