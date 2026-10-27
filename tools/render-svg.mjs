#!/usr/bin/env node
/**
 * Render an SVG source file to PNG/JPG with the project's own fonts.
 *
 *   node tools/render-svg.mjs assets/brand/snake-poster.svg dist/brand/snake-poster-1200x630.png --width 1200
 *
 * The SVG markup is inlined into a scratch HTML page rather than loaded through an <img>, because
 * an SVG in an image element is an isolated document that will not load @font-face resources. The
 * scratch page lives in .build/render so relative font URLs resolve.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPlaywright } from './load-playwright.mjs';

const BUILD = new URL('../.build/render/', import.meta.url).pathname;

function parseArgs(argv) {
  const args = { fonts: 'assets/brand/brand-fonts.css' };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--width') args.width = Number(argv[++i]);
    else if (token === '--height') args.height = Number(argv[++i]);
    else if (token === '--quality') args.quality = Number(argv[++i]);
    else if (token === '--fonts') args.fonts = argv[++i];
    else positional.push(token);
  }
  [args.input, args.output] = positional;
  if (!args.input || !args.output) {
    throw new Error('usage: render-svg.mjs <in.svg> <out.png|jpg> [--width N] [--height N] [--quality N]');
  }
  return args;
}

function viewBoxOf(svg) {
  const match = svg.match(/<svg\b[^>]*\bviewBox="([-\d.\s]+)"/);
  if (!match) throw new Error('svg has no viewBox; pass --width and --height');
  const [x, y, w, h] = match[1].trim().split(/[\s,]+/).map(Number);
  return { x, y, w, h };
}

/**
 * The SVG is pasted into a scratch page, so a relative `url(./fonts/x.woff2)` inside it would
 * resolve against that page instead of the artwork. Rewrite them to file URLs of the source.
 */
function localizeFontUrls(markup, baseDir) {
  return markup.replace(/url\(([^)]+)\)/g, (all, raw) => {
    const rel = raw.trim().replace(/^['"]|['"]$/g, '');
    if (rel === '' || rel.startsWith('data:') || rel.startsWith('file:')) return all;
    return `url("${pathToFileURL(resolve(baseDir, rel)).href}")`;
  });
}

async function inlineFontCss(fontsPath) {
  return localizeFontUrls(await readFile(fontsPath, 'utf8'), dirname(resolve(fontsPath)));
}

export async function renderSvg({ input, output, width, height, quality, fonts }) {
  const svg = localizeFontUrls(
    (await readFile(input, 'utf8'))
      .replace(/<\?xml[\s\S]*?\?>/, '')
      .replace(/<!--[\s\S]*?-->/g, ''),
    dirname(resolve(input)),
  );
  const box = viewBoxOf(svg);
  const w = width || Math.round(box.w);
  const h = height || Math.round((w * box.h) / box.w);
  if (!Number.isInteger(w) || !Number.isInteger(h)) {
    throw new Error(`bad render size ${w}x${h} (box ${JSON.stringify(box)}, args ${JSON.stringify({ width, height })})`);
  }

  await mkdir(BUILD, { recursive: true });
  await mkdir(dirname(resolve(output)), { recursive: true });

  const fontCss = fonts ? await inlineFontCss(resolve(fonts)) : '';
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
${fontCss}
html,body{margin:0;padding:0;background:#0000}
svg{display:block;width:${w}px;height:${h}px}
</style></head><body>
${svg}
</body></html>
`;
  const scratch = join(BUILD, `${basename(input).replace(/\.svg$/, '')}.html`);
  await writeFile(scratch, html);

  const fontFamilies = [...new Set([...svg.matchAll(/font-family="'([^']+)'/g)].map((m) => m[1]))];
  const fontWeights = [...new Set([...svg.matchAll(/font-weight="(\d+)"/g)].map((m) => m[1]))];

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(pathToFileURL(scratch).href, { waitUntil: 'load' });
    // Fonts only download when something asks for them; ask explicitly for every family/weight the
    // artwork names, then fail loudly rather than rendering a silent fallback.
    const missing = await page.evaluate(
      async ({ families, weights }) => {
        const wanted = [];
        for (const family of families) {
          for (const weight of weights.length ? weights : ['400']) {
            wanted.push(`${weight} 48px "${family}"`);
          }
        }
        const results = await Promise.all(wanted.map((spec) => document.fonts.load(spec, 'SNAKE0123')));
        await document.fonts.ready;
        return wanted.filter((_, index) => results[index].length === 0);
      },
      { families: fontFamilies, weights: fontWeights },
    );
    if (missing.length) throw new Error(`fonts failed to load: ${missing.join(', ')}`);
    const isJpg = /\.jpe?g$/i.test(output);
    await page.locator('svg').screenshot({
      path: resolve(output),
      type: isJpg ? 'jpeg' : 'png',
      quality: isJpg ? quality || 92 : undefined,
      omitBackground: !isJpg,
    });
  } finally {
    await browser.close();
  }
  return { w, h, output: resolve(output) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  renderSvg(args)
    .then(({ w, h, output }) => console.log(`rendered ${w}x${h} -> ${output}`))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
}
