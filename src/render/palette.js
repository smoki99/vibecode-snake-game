/**
 * The palette, in one place.
 *
 * The canvas renderer reads these values from here; assets/styles/styles.css declares the same
 * tokens as custom properties. tests/unit/palette.spec.mjs asserts the two lists stay identical,
 * so a recolour is one edit with a test telling you which file to update.
 */

/** @typedef {'ink-0'|'ink-1'|'ink-2'|'line'|'snake-1'|'snake-2'|'snake-3'|'apple'|'apple-deep'|'text-1'|'text-2'|'text-3'|'danger'} Token */

export const PALETTE = {
  'ink-0': '#060B08',
  'ink-1': '#0A120E',
  'ink-2': '#0F1D16',
  'line': '#1B2E24',
  'snake-1': '#157F47',
  'snake-2': '#3FD07A',
  'snake-3': '#8FF9B8',
  'apple': '#FF6B57',
  'apple-deep': '#B81F2A',
  'text-1': '#EAF6EC',
  'text-2': '#A7C3B0',
  'text-3': '#6FA37E',
  'danger': '#FF8A73',
};

/** Named variants the canvas needs that CSS spells differently (or not at all). */
export const CANVAS_EXTRA = {
  'snake-eye': '#061209',
  'apple-leaf': '#2F8F55',
  'cell-line': '#12211A',
  'grid-glow': 'rgba(63, 208, 122, 0.16)',
  'danger-glow': 'rgba(255, 107, 87, 0.22)',
};

/**
 * Colours the shell derives for itself (a raised surface, text on an accent, the focus ring).
 * They live in CSS, but they are still colours, so they are listed here to keep the stylesheet from
 * quietly inventing new ones.
 */
export const CSS_DERIVED = {
  'ink-3': '#132420',
  'text-1-invert': '#06120B',
  'focus': '#8FF9B8',
};

export const cssVarName = (token) => `--${token}`;

export function color(token, overrides = {}) {
  const value = overrides[token] ?? PALETTE[token] ?? CANVAS_EXTRA[token];
  if (!value) throw new Error(`unknown palette token "${token}"`);
  return value;
}
