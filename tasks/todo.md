# Todo — Snake, production-grade

Tick boxes are the working state; `[x]` means the code exists, is tested and is green.

## Phase 0 — Brief, plan, skills
- [x] Read the addy-osmani skill pack; wire all 25 skills for Claude Code and `pi`
- [x] SPEC.md v2 (multi-file + zero-runtime-network reconciliation, assets, a11y, perf budget)
- [x] tasks/plan.md, tasks/todo.md, SKILLS-ENABLED.md

## Phase 1 — Deterministic core
- [x] `constants.js` — 24×18 board, directions, statuses, death reasons, THEMES, storage keys
- [x] `rng.js` — mulberry32 + FNV-1a seed hashing; no `Math.random` below `main.js`
- [x] `difficulty.js` — chill/classic/frantic tick ramps, tiers, ranks
- [x] `steering.js` — buffered queue, chain-aware reversal guard
- [x] `food.js` — spawn on a free cell, deterministic
- [x] `state.js` — createState/start/restartWith, snake head-first
- [x] `step.js` — movement, growth, wall/self/tail-vacates, score, tick ramp
- [x] `storage.js` — best per difficulty, settings, corrupt-value fallback
- [x] `ui/loop.js` — fixed timestep, ≤5 catch-up ticks, `pump()` for tests
- [x] Unit tests for all of the above, including a layering guard

## Phase 2 — Assets
- [x] Fonts vendored: Space Grotesk 400/500/700 + Silkscreen 400/700, latin woff2, OFL licences,
      checksummed manifest (`npm run setup`, idempotent)
- [x] 14 hand-authored SVG icons (24×24, stroke, `currentColor`, `<title>`), sprite generated and
      kept in sync by a test that regenerates and diffs it
- [x] Brand artwork: poster, logo, favicon, OG card — pure vector, accessible, self-contained
- [x] Raster exports generated into `dist/brand/` (poster 1200/2400, card 1200×840, logo 512/96,
      favicon 32/180/192/512)

## Phase 3 — Rendering & UI
- [x] `palette.js` mirrors CSS custom properties; canvas reads the applied theme at runtime
- [x] `canvas.js` — DPR-aware, cached backdrop, interpolated segments, gradient body, apple with
      halo + leaf, eyes, death flash, `invalidate()` on theme change
- [x] `controller.js` — owns state, drives the loop, reacts to events, theme get/set
- [x] `hud.js` — overlay copy per status and death reason, score/best/apples/speed, ranks, live region
- [x] `input.js` — keyboard (arrows/WASD/HJKL, Space/P/R/M/T, 1/2/3), d-pad, swipe, visibility pause
- [x] `audio.js` — WebAudio blips, muted by default, unmuted only by a gesture
- [x] `main.js` — composition root, URL overrides, ResizeObserver, `window.game` test surface
- [x] `index.html` + `styles.css` — full design system, three themes, reduced motion, skip link

## Phase 4 — Build
- [x] `tools/build-single.mjs` — esbuild + inline CSS/fonts/sprite/favicon → 134 KB single file
- [x] `tools/serve.mjs` + `tools/static-server.mjs` — dev server, also used in-process by tests
- [x] `tools/sprite.mjs`, `tools/render-svg.mjs`, `tools/render-brand.mjs`, `tools/vendor-fonts.mjs`

## Phase 5 — Tests
- [x] `tests/unit` — sim, loop, palette, layering
- [x] `tests/assets` — icon/sprite/font/licence integrity
- [x] `tests/build` — bundle freshness, no network refs, embedded assets, size budget
- [x] `tests/browser` — 25 Playwright tests: boot, paint, DPR, a11y, contrast, reduced motion,
      themes, steering, feints, eating, both deaths, pause, restart, difficulty, touch, stall cap,
      seeded replay, and the `file://` bundle
- [x] Scripted manoeuvres run inside a single `page.evaluate` (`eatApples`, `pumpUntilInPage`) so the
      page's live loop cannot interleave ticks mid-test

## Phase 6 — Ship
- [x] README (run, controls, architecture, testing, decisions, limits)
- [x] SPEC.md §11 manual verification record
- [x] tasks/todo.md final state
- [x] Temporary Cloudflare preview (throwaway, documented as such)
- [x] Scratch/diagnostic tools removed
