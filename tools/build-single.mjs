#!/usr/bin/env node
/**
 * Single-file build.
 *
 *   node tools/build-single.mjs [--minify]  ->  dist/snake-standalone.html
 *
 * The multi-file source is the thing under test; this bundle exists so the "download one file,
 * double-click it, play on a plane" promise survives. Everything is inlined: esbuild flattens the
 * ES modules into one script, the stylesheet is embedded with the woff2 fonts as base64 data URIs,
 * the icon sprite is injected into #sprite (so the page issues zero requests at runtime), and the
 * favicon becomes a data URI.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'dist/snake-standalone.html');

function requireGlobal(name) {
  const roots = ['/opt/shared-tooling/npm/lib/node_modules'];
  if (process.env.NODE_PATH) roots.push(...process.env.NODE_PATH.split(':').filter(Boolean));
  try {
    roots.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim());
  } catch {
    /* ignore */
  }
  roots.unshift(dirname(fileURLToPath(import.meta.url)));
  for (const root of roots) {
    try {
      return createRequire(join(root, 'noop.js'))(name);
    } catch {
      /* try the next root */
    }
  }
  throw new Error(`cannot resolve "${name}". Try: npm i -g --prefix /opt/shared-tooling/npm ${name}`);
}

const dataUri = (path, mime) => `data:${mime};base64,${readFileSync(path).toString('base64')}`;

async function inlineCss(cssPath) {
  const css = await readFile(cssPath, 'utf8');
  const base = dirname(cssPath);
  return css.replace(/url\((['"]?)([^'")]+)\1\)/g, (all, quote, ref) => {
    if (ref.startsWith('data:')) return all;
    const file = resolve(base, ref);
    if (!existsSync(file)) throw new Error(`stylesheet references a missing file: ${ref}`);
    const mime = file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.woff') ? 'font/woff' : 'application/octet-stream';
    return `url("${dataUri(file, mime)}")`;
  });
}

async function main() {
  const esbuild = requireGlobal('esbuild');
  const minify = process.argv.includes('--minify');

  const bundle = await esbuild.build({
    entryPoints: [join(ROOT, 'src/main.js')],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    write: false,
    minify,
    legalComments: 'none',
    charset: 'utf8',
  });
  const js = bundle.outputFiles[0].text;

  const css = await inlineCss(join(ROOT, 'assets/styles/styles.css'));
  const sprite = await readFile(join(ROOT, 'assets/icons/sprite.svg'), 'utf8');
  const faviconSvg = dataUri(join(ROOT, 'assets/brand/favicon.svg'), 'image/svg+xml');
  let html = await readFile(join(ROOT, 'index.html'), 'utf8');

  const swap = (from, to, label) => {
    if (!html.includes(from)) throw new Error(`build anchor missing: ${label}`);
    html = html.replace(from, to);
  };

  swap(
    '<link rel="stylesheet" href="assets/styles/styles.css" />',
    `<style>\n${css}\n</style>`,
    'stylesheet',
  );
  swap(
    '<script type="module" src="src/main.js"></script>',
    `<script>\n${js}\n</script>`,
    'module script',
  );
  swap(
    '<div id="sprite" hidden aria-hidden="true"></div>',
    `<div id="sprite" hidden aria-hidden="true">${sprite.replace(/^<\?xml[^>]*\?>\s*/, '').replace(/<!--[\s\S]*?-->/g, '')}</div>`,
    'sprite container',
  );
  swap(
    '<link rel="icon" href="assets/brand/favicon.svg" type="image/svg+xml" />',
    `<link rel="icon" href="${faviconSvg}" type="image/svg+xml" />`,
    'favicon',
  );
  const touchIcon = join(ROOT, 'dist/brand/favicon-180x180.png');
  if (existsSync(touchIcon)) {
    swap(
      '<link rel="apple-touch-icon" href="dist/brand/favicon-180x180.png" />',
      `<link rel="apple-touch-icon" href="${dataUri(touchIcon, 'image/png')}" />`,
      'apple touch icon',
    );
  }
  swap(
    '<html lang="en" data-theme="dark">',
    '<html lang="en" data-theme="dark" data-build="single-file">',
    'html marker',
  );

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
  console.log(`dist/snake-standalone.html  ${kb} KB  (js ${js.length} B, css ${css.length} B, sprite ${sprite.length} B)`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
