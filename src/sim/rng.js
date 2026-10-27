/**
 * Seeded PRNG (mulberry32), expressed as pure transitions over an integer state.
 * The sim carries `rngState` inside the game state so every run is reproducible:
 * the same seed always produces the same food sequence.
 */

const MULTIPLIER = 0x6d2b79f5;

/** Advance the generator by one step. Returns the next state plus a float in [0, 1). */
export function next(rngState) {
  const state = (rngState + MULTIPLIER) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state, value };
}

/** Integer in [0, maxExclusive). maxExclusive must be >= 1. */
export function nextInt(rngState, maxExclusive) {
  const { state, value } = next(rngState);
  return { state, value: Math.floor(value * maxExclusive) };
}

/** Turn an arbitrary string/number into a well-formed 32-bit seed. */
export function seedFrom(input) {
  if (typeof input === 'number' && Number.isFinite(input)) return input >>> 0;
  const text = String(input ?? '');
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

// Note: no entropy source lives in src/sim/. `src/main.js` supplies the initial
// seed (from ?seed= or the browser's crypto), which keeps the whole sim layer
// deterministic and lets tests import it without a browser. The layering guard
// test (tests/unit/layering.spec.mjs) enforces that rule.
