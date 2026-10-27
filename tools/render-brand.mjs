#!/usr/bin/env node
/**
 * Render every brand artifact from its SVG source into dist/brand/.
 *
 *   node tools/render-brand.mjs
 *
 * SVG is the source of truth; the PNG/JPG outputs exist for contexts that cannot use SVG
 * (open-graph scrapers, favicons on old browsers, app icons). Re-running is cheap and reproducible.
 */
import { renderSvg } from './render-svg.mjs';

const BRAND = new URL('../assets/brand/', import.meta.url).pathname;
const OUT = new URL('../dist/brand/', import.meta.url).pathname;

const JOBS = [
  { src: 'snake-poster.svg', name: 'snake-poster-1200x630', width: 1200, ext: 'png' },
  { src: 'snake-poster.svg', name: 'snake-poster-2400x1260', width: 2400, ext: 'png' },
  { src: 'og-card.svg', name: 'og-card-1200x630', width: 1200, ext: 'jpg', quality: 92 },
  { src: 'og-card.svg', name: 'og-card-1600x840', width: 1600, ext: 'jpg', quality: 92 },
  { src: 'logo.svg', name: 'logo-512x512', width: 512, ext: 'png' },
  { src: 'logo.svg', name: 'logo-96x96', width: 96, ext: 'png' },
  { src: 'favicon.svg', name: 'favicon-32x32', width: 32, ext: 'png' },
  { src: 'favicon.svg', name: 'favicon-180x180', width: 180, ext: 'png' },
  { src: 'favicon.svg', name: 'favicon-192x192', width: 192, ext: 'png' },
  { src: 'favicon.svg', name: 'favicon-512x512', width: 512, ext: 'png' },
];

for (const job of JOBS) {
  const output = `${OUT}${job.name}.${job.ext}`;
  const result = await renderSvg({
    input: `${BRAND}${job.src}`,
    output,
    width: job.width,
    quality: job.quality,
  });
  console.log(`${job.name}.${job.ext}  ${result.w}x${result.h}`);
}
console.log(`brand renders complete (${JOBS.length} files)`);
