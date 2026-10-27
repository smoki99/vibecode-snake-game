import { STORAGE_KEYS, THEMES } from './constants.js';
import { PRESET_IDS, presetFor } from './difficulty.js';

/**
 * Persistence, written against an *injected* storage object so the sim layer never names
 * `localStorage` (see tests/unit/layering.spec.mjs). `src/main.js` passes the real thing.
 *
 * Every read is defensive: private-mode throws, stale JSON from an older version, hand-edited
 * values and wrong types all degrade to defaults rather than breaking the game.
 */

const DEFAULT_SETTINGS = Object.freeze({ difficulty: 'classic', muted: true, theme: 'auto' });

function readRaw(store, key) {
  if (!store || typeof store.getItem !== 'function') return null;
  try {
    return store.getItem(key);
  } catch {
    return null; // SecurityError in some private-mode configurations
  }
}

function writeRaw(store, key, value) {
  if (!store || typeof store.setItem !== 'function') return false;
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false; // quota exceeded / disabled storage
  }
}

function parseObject(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

const nonNegInt = (value, fallback = 0) =>
  Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.trunc(Number(value)) : fallback;

/** Best score per preset: { chill, classic, frantic }. */
export function readScores(store) {
  const parsed = parseObject(readRaw(store, STORAGE_KEYS.best));
  const out = {};
  for (const id of PRESET_IDS) out[id] = parsed ? nonNegInt(parsed[id], 0) : 0;
  return out;
}

export function readBest(store, difficultyId) {
  return readScores(store)[presetFor(difficultyId).id] ?? 0;
}

/** Records a score only if it beats the stored one. Returns the (possibly unchanged) best. */
export function writeBest(store, difficultyId, score) {
  const id = presetFor(difficultyId).id;
  const scores = readScores(store);
  const nextScore = nonNegInt(score, scores[id]);
  if (nextScore <= scores[id]) return scores[id];
  const updated = { ...scores, [id]: nextScore };
  writeRaw(store, STORAGE_KEYS.best, JSON.stringify(updated));
  return nextScore;
}

export function readSettings(store) {
  const parsed = parseObject(readRaw(store, STORAGE_KEYS.settings)) ?? {};
  return {
    difficulty: presetFor(parsed.difficulty).id,
    muted: parsed.muted === false ? false : DEFAULT_SETTINGS.muted,
    theme: THEMES.includes(parsed.theme) ? parsed.theme : DEFAULT_SETTINGS.theme,
  };
}

export function writeSettings(store, patch = {}) {
  const current = readSettings(store);
  const next = {
    difficulty:
      patch.difficulty && PRESET_IDS.includes(patch.difficulty) ? patch.difficulty : current.difficulty,
    muted: typeof patch.muted === 'boolean' ? patch.muted : current.muted,
    theme: THEMES.includes(patch.theme) ? patch.theme : current.theme,
  };
  writeRaw(store, STORAGE_KEYS.settings, JSON.stringify(next));
  return next;
}
