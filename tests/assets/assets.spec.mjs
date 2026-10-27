import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ICON_ID_PATTERN, buildSprite, loadIcons } from '../../tools/sprite.mjs';

/**
 * Icon and font asset contract.
 *
 * Icons are source files; sprite.svg is a build artefact. These tests keep the artefact in sync,
 * keep every icon on the same 24x24 grid with currentColor (so CSS controls colour), forbid text
 * inside icons, and verify the vendored fonts are the files the manifest says they are.
 */

const ROOT = new URL('../../', import.meta.url).pathname;
const ICONS = join(ROOT, 'assets/icons');
const FONTS = join(ROOT, 'assets/fonts');

const listIcons = async () => (await readdir(ICONS)).filter((name) => /^icon-[a-z0-9-]+\.svg$/.test(name)).sort();

test('icons: every icon is a 24x24 currentColor line icon with a title', async () => {
  const names = await listIcons();
  assert.ok(names.length >= 12, `expected a full icon set, found ${names.length}`);
  for (const name of names) {
    const svg = await readFile(join(ICONS, name), 'utf8');
    assert.match(svg, /viewBox="0 0 24 24"/, `${name} must use the 24px grid`);
    assert.match(svg, /stroke="currentColor"/, `${name} must inherit its colour`);
    assert.match(svg, /<title>[^<]+<\/title>/, `${name} needs a title for accessible names`);
    assert.doesNotMatch(svg, /<text|font-family|xlink:href|<image/, `${name} must be pure geometry`);
    assert.doesNotMatch(svg, /fill="(?!none|currentColor)[^"]*"/, `${name} should be stroked, not hard-filled`);
    assert.match(svg, /stroke-width="1\.75"/, `${name} should use the shared stroke weight`);
  }
});

test('icons: filenames are valid symbol ids and unique', async () => {
  const names = await listIcons();
  const ids = names.map((name) => name.replace(/\.svg$/, ''));
  assert.equal(new Set(ids).size, ids.length, 'duplicate icon names');
  for (const id of ids) assert.ok(ICON_ID_PATTERN.test(id), `${id} is not a valid symbol id`);
});

test('icons: sprite.svg is exactly what the sources generate', async () => {
  const generated = await buildSprite(await loadIcons(ICONS));
  const committed = await readFile(join(ICONS, 'sprite.svg'), 'utf8');
  assert.equal(committed, generated, 'sprite.svg is stale — run: node tools/sprite.mjs');
});

test('icons: sprite symbols match the names the UI says it will use', async () => {
  const { ICON_NAMES } = await import('../../src/ui/icons.js');
  const sprite = await readFile(join(ICONS, 'sprite.svg'), 'utf8');
  const symbols = [...sprite.matchAll(/<symbol id="icon-([a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(symbols.sort(), [...ICON_NAMES].sort(), 'sprite and ICON_NAMES drifted apart');
});

test('icons: the page only references icons that exist', async () => {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  const { ICON_NAMES } = await import('../../src/ui/icons.js');
  const used = [...html.matchAll(/#icon-([a-z0-9-]+)/g)].map((m) => m[1]);
  assert.ok(used.length >= 8, 'expected the markup to use the sprite');
  for (const name of used) assert.ok(ICON_NAMES.includes(name), `index.html references unknown icon "${name}"`);
});

test('icons: a file name that cannot be a symbol id is refused, not skipped', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'icons-'));
  await writeFile(join(dir, 'icon-bad_name.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await assert.rejects(async () => buildSprite(await loadIcons(dir)), /invalid icon file name/);
  const other = await mkdtemp(join(tmpdir(), 'icons-'));
  await writeFile(join(other, 'stray.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await assert.rejects(async () => buildSprite(await loadIcons(other)), /invalid icon file name "stray\.svg"/);
});

test('fonts: the manifest matches the files on disk', async () => {
  const manifest = JSON.parse(await readFile(join(FONTS, 'FONTS-MANIFEST.json'), 'utf8'));
  const { createHash } = await import('node:crypto');
  const files = (await readdir(FONTS)).filter((name) => name.endsWith('.woff2'));
  const entries = manifest.families.flatMap((fam) => fam.files.map((f) => ({ ...f, pkg: fam.pkg })));
  assert.deepEqual(
    entries.map((e) => e.name).sort(),
    files.sort(),
    'the manifest and the fonts folder drifted apart',
  );
  for (const entry of entries) {
    const buf = await readFile(join(FONTS, entry.name));
    assert.equal(buf.length, entry.bytes, `${entry.name} size drifted from the manifest`);
    const digest = createHash('sha256').update(buf).digest('hex');
    assert.equal(digest, entry.sha256, `${entry.name} content drifted from the manifest`);
    assert.match(entry.name, /-latin-\d{3}-normal\.woff2$/, `${entry.name} should be a latin subset`);
  }
  assert.deepEqual(
    manifest.families.map((f) => f.pkg).sort(),
    ['@fontsource/silkscreen', '@fontsource/space-grotesk'],
  );
  assert.equal(manifest.license, 'SIL OFL 1.1');
  for (const family of manifest.families) {
    const licence = await readFile(join(FONTS, family.licenseFile), 'utf8');
    assert.match(licence, /SIL OPEN FONT LICENSE/i, `${family.licenseFile} is not the OFL text`);
    assert.ok(family.version, `${family.pkg} should record the version it came from`);
  }
});

test('fonts: licence text ships next to the binaries', async () => {
  const files = await readdir(FONTS);
  const licences = files.filter((name) => /OFL.*\.txt$/.test(name));
  assert.equal(licences.length, 2, 'both families need their OFL text');
  for (const name of licences) {
    const text = await readFile(join(FONTS, name), 'utf8');
    assert.match(text, /SIL OPEN FONT LICENSE Version 1\.1/);
    assert.match(text, /Permission is hereby granted, free of charge/);
  }
});

test('fonts: the stylesheet only references files that exist, and only woff2', async () => {
  const css = await readFile(join(ROOT, 'assets/styles/styles.css'), 'utf8');
  const refs = [...css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map((m) => m[1]);
  assert.ok(refs.length >= 5, 'expected @font-face declarations');
  for (const ref of refs) {
    assert.match(ref, /\.woff2$/, `font reference should be woff2, got ${ref}`);
    assert.doesNotMatch(ref, /^https?:|^\/\//, 'no network fonts');
    const buf = await readFile(join(ROOT, 'assets/styles', ref));
    assert.ok(buf.length > 1000, `${ref} looks truncated`);
  }
  assert.doesNotMatch(css, /@import/, 'no @import: the page must issue zero requests');
});
