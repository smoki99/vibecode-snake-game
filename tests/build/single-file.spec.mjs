import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The single-file bundle is a build artefact with one job: open it from disk, offline, and play.
 * These tests assert it was regenerated from the current sources and that nothing in it would ask
 * the network for anything.
 */

const ROOT = new URL('../../', import.meta.url).pathname;
const BUNDLE = join(ROOT, 'dist/snake-standalone.html');

const SOURCES = [
  'index.html',
  'assets/styles/styles.css',
  'assets/icons/sprite.svg',
  'assets/brand/favicon.svg',
  'src/main.js',
  'src/sim/step.js',
  'src/render/canvas.js',
  'src/ui/controller.js',
];

const read = () => readFile(BUNDLE, 'utf8');

test('bundle: exists', async () => {
  const info = await stat(BUNDLE).catch(() => null);
  assert.ok(info, 'dist/snake-standalone.html missing — run: node tools/build-single.mjs');
});

test('bundle: is newer than every source it embeds', async () => {
  const built = await stat(BUNDLE);
  for (const source of SOURCES) {
    const info = await stat(join(ROOT, source));
    assert.ok(
      built.mtimeMs >= info.mtimeMs - 1000,
      `${source} changed after the bundle was built — run: node tools/build-single.mjs`,
    );
  }
});

test('bundle: contains no reference that would touch the network', async () => {
  const html = await read();
  const forbidden = [
    [/<link[^>]+rel="stylesheet"[^>]+href="(?!data:)/, 'external stylesheet'],
    [/<script[^>]+src=/, 'external script'],
    [/@import\s+url\((['"]?)(?!data:)/, 'css @import'],
    [/url\((['"]?)(?!data:)[^'")]*\)/, 'css url() pointing at a file'],
    [/href="assets\/|src="assets\//, 'relative asset reference'],
    [/url\((['"]?)https?:/, 'remote font or image'],
    [/<link[^>]+href="(?!data:)[^"]*favicon/, 'external favicon'],
  ];
  for (const [pattern, label] of forbidden) {
    assert.equal(pattern.test(html), false, `bundle still contains an ${label}`);
  }
});

test('bundle: fonts, icons and favicon are embedded', async () => {
  const html = await read();
  const fonts = html.match(/data:font\/woff2;base64,/g) ?? [];
  assert.equal(fonts.length, 5, `expected 5 embedded woff2 faces, found ${fonts.length}`);
  const symbols = html.match(/<symbol id="icon-[a-z0-9-]+"/g) ?? [];
  assert.ok(symbols.length >= 13, `expected the sprite inline, found ${symbols.length} symbols`);
  assert.match(html, /rel="icon" href="data:image\/svg\+xml;base64,/);
  assert.match(html, /data-build="single-file"/);
});

test('bundle: the module graph was flattened into one classic script', async () => {
  const html = await read();
  assert.equal(html.match(/<script>/g)?.length, 1, 'expected exactly one inline script');
  assert.doesNotMatch(html, /type="module"/, 'a module script would be blocked by CORS on file://');
  assert.doesNotMatch(html, /^import .* from/m, 'unbundled import statement survived');
  assert.doesNotMatch(html, /^export /m, 'unbundled export statement survived');
  // Names are minified away, so look for string literals that only the shipped code contains.
  assert.match(html, /snake\.best\.v1/, 'the persistence layer should be inlined');
  assert.match(html, /You met the wall/, 'the HUD copy should be inlined');
  assert.match(html, /icon-sound-off/, 'the icon wiring should be inlined');
});

test('bundle: stays a size a human will double-click', async () => {
  const info = await stat(BUNDLE);
  assert.ok(info.size < 900_000, `bundle is ${(info.size / 1024).toFixed(0)} KB`);
});
