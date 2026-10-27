import { POINTS_PER_FOOD } from './constants.js';

/**
 * Difficulty presets. `baseMs` is the tick length for a 3-cell snake, `minMs` the floor it
 * eases toward, and `ramp` how many ms come off per food eaten.
 */
export const PRESETS = Object.freeze({
  chill: Object.freeze({ id: 'chill', label: 'Chill', baseMs: 150, minMs: 90, ramp: 2.0 }),
  classic: Object.freeze({ id: 'classic', label: 'Classic', baseMs: 120, minMs: 60, ramp: 2.5 }),
  frantic: Object.freeze({ id: 'frantic', label: 'Frantic', baseMs: 90, minMs: 45, ramp: 3.0 }),
});

export const PRESET_IDS = Object.freeze(Object.keys(PRESETS));

/** Unknown or missing ids fall back to classic instead of throwing. */
export function presetFor(id) {
  return PRESETS[id] ?? PRESETS.classic;
}

/** Tick length in ms. Monotonically non-increasing in `eaten`, floored at preset.minMs. */
export function tickMsFor(preset, eaten) {
  const count = Number.isFinite(eaten) && eaten > 0 ? eaten : 0;
  const raw = preset.baseMs - count * preset.ramp;
  return Math.max(preset.minMs, Math.round(raw));
}

/** 0..1 progress toward the floor. Drives the HUD speed meter. */
export function speedProgress(preset, eaten) {
  const span = preset.baseMs - preset.minMs;
  if (span <= 0) return 1;
  return Math.min(1, (preset.baseMs - tickMsFor(preset, eaten)) / span);
}

/** 1 = base speed, 3 = at the floor. Drives the score multiplier and HUD pips. */
export function tierFor(preset, eaten) {
  const progress = speedProgress(preset, eaten);
  if (progress >= 0.999) return 3;
  if (progress > 0.33) return 2;
  return 1;
}

export function scoreGain(preset, eaten) {
  return POINTS_PER_FOOD * tierFor(preset, eaten);
}
