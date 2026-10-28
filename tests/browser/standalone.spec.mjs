import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, readState, startServer, warmUp } from '../helpers/browser.mjs';

/**
 * The offline promise: open dist/snake-standalone.html straight from the filesystem, with no server
 * and no network, and confirm it plays.
 */

const FILE_URL = new URL('../../dist/snake-standalone.html', import.meta.url).href;

let browser;
let server;

test.before(async () => {
  browser = await launchBrowser();
  server = await startServer(); // only used to prove the page never asks it for anything
  await warmUp(browser, FILE_URL);
});

test.afterEach(async () => {
  // A failing assertion returns before page.close(); reclaim the context so one failure cannot
  // starve the rest of the file.
  for (const context of browser?.contexts() ?? []) await context.close().catch(() => {});
});

test.after(async () => {
  await browser?.close();
  await server?.close();
});

test('standalone: opens from file:// and boots with no console errors', async () => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('request', (request) => requests.push(request.url()));

  await page.goto(FILE_URL, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForSelector('body[data-ready="1"]', { timeout: 90_000 });

  assert.deepEqual(errors, [], 'the offline build must boot clean');
  const served = requests.filter((url) => url.startsWith(server.url));
  assert.deepEqual(served, [], 'the offline build must not request anything from a server');
  assert.ok(requests.every((url) => url.startsWith('file://') || url.startsWith('data:')), 'only file/data requests allowed');
  assert.equal(requests.length, 1, `expected a single document request, got ${requests.length}`);
  assert.ok(await page.evaluate(() => document.fonts.check('16px "Silkscreen"')), 'fonts must come from data URIs');
  await context.close();
});

test('standalone: playable from file://', async () => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  const page = await context.newPage();
  await page.goto(FILE_URL, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForSelector('body[data-ready="1"]', { timeout: 90_000 });

  // One gesture: Space starts the run. Digit3 would already start it, which makes the following
  // Space a *pause* — and a player pressing space to check "is this thing on" would then find the
  // game frozen at tick zero. That interaction was the real defect behind this test failing.
  await page.keyboard.press('Space');
  const state = await page.evaluate(() => {
    const game = window.game;
    for (let i = 0; i < 8; i += 1) game.pump(game.state.tickMs);
    return {
      status: game.state.status,
      head: { x: game.state.snake[0].x, y: game.state.snake[0].y },
      difficulty: game.state.difficulty,
      length: game.state.snake.length,
      spriteSymbols: document.querySelectorAll('#sprite symbol').length,
    };
  });
  assert.equal(state.status, 'playing', 'space from the start screen must run, not pause');
  assert.equal(state.difficulty, 'classic', 'the offline page boots on the default preset');
  assert.equal(state.head.x, 12 + 8, 'eight classic ticks advance the head eight cells');
  assert.ok(state.spriteSymbols >= 13, 'the icon sprite must be embedded');

  // The difficulty shortcut is the only way to choose a preset from file:// (no URL params there), so
  // it has to work and it must leave the game running rather than needing another key press.
  await page.keyboard.press('Digit3');
  const afterKey = await readState(page);
  assert.equal(afterKey.difficulty, 'frantic', 'the 1/2/3 keys pick a preset offline');
  assert.equal(afterKey.status, 'playing', 'and switching preset keeps the game running');
  assert.equal(afterKey.length, 3, 'a new pace means a fresh run');
  assert.equal(await page.isVisible('#overlay'), false, 'the overlay should clear once playing');
  await context.close();
});
