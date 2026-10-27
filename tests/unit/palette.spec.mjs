import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CANVAS_EXTRA, CSS_DERIVED, PALETTE, color } from '../../src/render/palette.js';
import { CANVAS_TOKENS } from '../../src/render/canvas.js';

/**
 * One palette, two consumers.
 *
 * The DOM reads CSS custom properties; the canvas reads the *same* properties at runtime (see
 * CANVAS_TOKENS in src/render/canvas.js), and src/render/palette.js holds the literals that the
 * stylesheet is expected to declare. This test is the seam: it proves the dark :root block matches
 * palette.js token for token, that nothing references a token nobody declares, and that the theme
 * variants override the full set.
 */

const ROOT = new URL('../../', import.meta.url).pathname;
const cssText = () => readFile(join(ROOT, 'assets/styles/styles.css'), 'utf8');

/** Declarations inside one selector block, so theme overrides cannot masquerade as the default. */
function blockOf(css, selector) {
  const at = css.indexOf(selector);
  assert.notEqual(at, -1, `selector ${selector} not found in styles.css`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);
  const out = new Map();
  for (const [, name, value] of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(name.slice(2), value.trim().toUpperCase());
  }
  return out;
}

const ALL_TOKENS = { ...PALETTE, ...CANVAS_EXTRA, ...CSS_DERIVED };

test('palette: the dark :root block matches palette.js token for token', async () => {
  const declared = blockOf(await cssText(), ':root {');
  for (const [name, value] of Object.entries(ALL_TOKENS)) {
    assert.ok(declared.has(name), `--${name} is used by the canvas but never declared in :root`);
    assert.equal(declared.get(name), value.toUpperCase(), `--${name} differs between palette.js and styles.css`);
  }
  // Colour tokens belong to palette.js. Layout tokens (--space-*, --radius-*) may live only in CSS.
  const isColour = (name) => /^(ink|text|snake|apple|danger|grid|cell|line|focus)/.test(name);
  const invented = [...declared.keys()].filter((name) => isColour(name) && !(name in ALL_TOKENS));
  assert.deepEqual(invented, [], `colour tokens invented in :root and unknown to palette.js: ${invented.join(', ')}`);
});

test('palette: the light theme overrides every surface and text token', async () => {
  const css = await cssText();
  const dark = blockOf(css, ':root {');
  const light = blockOf(css, "[data-theme='light'] {");
  const auto = blockOf(css, "[data-theme='auto'] {");
  for (const name of Object.keys({ ...PALETTE, ...CSS_DERIVED })) {
    assert.ok(light.has(name), `--${name} has no light value`);
    assert.ok(auto.has(name), `--${name} has no auto (prefers-color-scheme) value`);
    assert.notEqual(light.get(name), dark.get(name), `--${name} is identical in both themes`);
    assert.equal(auto.get(name), light.get(name), `--${name} differs between light and auto`);
  }
  for (const name of Object.keys(CANVAS_EXTRA)) {
    assert.ok(light.has(name), `--${name} has no light value, so the canvas would paint dark`);
  }
});

test('palette: the renderer only asks for tokens that both sides declare', async () => {
  const css = await cssText();
  const declared = blockOf(css, ':root {');
  const names = Object.values(CANVAS_TOKENS);
  assert.ok(names.length >= 12, 'expected the renderer to declare its token list');
  for (const name of names) {
    assert.doesNotThrow(() => color(name), `canvas asks for a token palette.js does not know: ${name}`);
    assert.ok(declared.has(name), `canvas asks for --${name}, which :root never declares`);
  }
});

test('palette: color() fails loudly on an unknown token', () => {
  assert.throws(() => color('no-such-token'), /unknown palette token/);
  assert.equal(color('ink-0'), PALETTE['ink-0']);
  assert.equal(color('danger', { danger: '#000000' }), '#000000', 'overrides must win');
});

test('palette: the stylesheet never references an undeclared custom property', async () => {
  const css = await cssText();
  const declared = blockOf(css, ':root {');
  const used = new Set([...css.matchAll(/var\(\s*--([a-z0-9-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((name) => !declared.has(name));
  assert.deepEqual(missing, [], `styles.css uses undefined tokens: ${missing.join(', ')}`);
});

test('palette: the tokens carry the intended contrast relationships', () => {
  const lum = (value) => {
    const [r, g, b] = value
      .replace('#', '')
      .match(/../g)
      .map((part) => Number.parseInt(part, 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const x = lum(a);
    const y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  assert.ok(ratio(PALETTE['text-1'], PALETTE['ink-0']) >= 7, 'primary text should reach AAA on the board');
  assert.ok(ratio(PALETTE['text-2'], PALETTE['ink-0']) >= 4.5, 'secondary text should reach AA');
  assert.ok(ratio(PALETTE['text-3'], PALETTE['ink-0']) >= 4.5, 'muted text should still reach AA');
  assert.ok(ratio(PALETTE.apple, PALETTE['ink-1']) >= 3, 'the apple must be visible against the cell');
  assert.ok(ratio(PALETTE['snake-2'], PALETTE['ink-0']) >= 3, 'the snake body must be visible against the board');
});
