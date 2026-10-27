import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, startServer, warmUp } from '../helpers/browser.mjs';

/**
 * Boot, presentation and accessibility smoke tests.
 *
 * These assert the promises that only a browser can check: the page renders with real fonts, the
 * icon sprite is present, the canvas actually paints, nothing calls out to the network, and the
 * assistive-tech surface (labels, live region, focus, contrast) is intact.
 */

let server;
let browser;

test.before(async () => {
  server = await startServer();
  browser = await launchBrowser();
  await warmUp(browser, `${server.url}/`);
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

test('app: boots clean with no console errors and no external requests', async () => {
  const { page, errors, externalRequests } = await openPage(browser, `${server.url}/`);
  assert.deepEqual(errors, [], 'console should be silent');
  assert.deepEqual(externalRequests(), [], 'runtime must not reach outside the origin');
  assert.equal(await page.getAttribute('body', 'data-ready'), '1');
  assert.ok(await page.evaluate(() => document.fonts.check('16px "Space Grotesk"')));
  assert.ok(await page.evaluate(() => document.fonts.check('16px "Silkscreen"')));
  await page.close();
});

test('app: the icon sprite is in the document and every declared icon resolves', async () => {
  const { page } = await openPage(browser, `${server.url}/`);
  const symbols = await page.evaluate(() => [...document.querySelectorAll('#sprite symbol')].map((s) => s.id));
  assert.ok(symbols.length >= 13, `expected the full sprite, got ${symbols.length}`);
  const missing = await page.evaluate((ids) => {
    const out = [];
    document.querySelectorAll('svg use').forEach((use) => {
      const ref = use.getAttribute('href');
      if (ref?.startsWith('#icon-') && !document.querySelector(`#sprite ${ref}`)) out.push(ref);
    });
    return out;
  }, symbols);
  assert.deepEqual(missing, [], 'every <use> must point at a symbol that exists');
  await page.close();
});

test('app: the canvas paints the board, snake and apple', async () => {
  const { page } = await openPage(browser, `${server.url}/?seed=paint&theme=dark`);
  // Sample the cell each element is supposed to occupy instead of scanning the whole canvas for a
  // colour: a fixed stride over ~450k pixels can miss a 24-pixel apple outright.
  const probe = await page.evaluate(() => {
    const canvas = document.getElementById('board');
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    const state = window.game.state;
    const pad = Math.round(Math.min(width, height) * 0.02);
    const cell = Math.min((width - pad * 2) / state.board.cols, (height - pad * 2) / state.board.rows);
    const originX = (width - cell * state.board.cols) / 2;
    const originY = (height - cell * state.board.rows) / 2;
    const swatch = (gx, gy) => {
      const hits = [];
      for (let dy = -6; dy <= 6; dy += 3) {
        for (let dx = -6; dx <= 6; dx += 3) {
          const x = Math.round(originX + (gx + 0.5) * cell + dx);
          const y = Math.round(originY + (gy + 0.5) * cell + dy);
          const i = 4 * (y * width + x);
          hits.push([data[i], data[i + 1], data[i + 2]]);
        }
      }
      return hits;
    };
    const occupied = new Set([...state.snake.map((c) => `${c.x},${c.y}`), `${state.food.x},${state.food.y}`]);
    let empty = null;
    for (let y = 0; y < state.board.rows && empty === null; y += 1) {
      for (let x = 0; x < state.board.cols && empty === null; x += 1) {
        if (!occupied.has(`${x},${y}`)) empty = { x, y };
      }
    }
    const swatchSize = 25;
    const distinct = new Set();
    for (let i = 0; i < data.length; i += 4 * 97) distinct.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return {
      distinct: distinct.size,
      width,
      height,
      apple: swatch(state.food.x, state.food.y).filter(([r, g, b]) => r > g + 40 && r > b + 40).length,
      head: swatch(state.snake[0].x, state.snake[0].y).filter(([r, g, b]) => g > r + 30 && g > b + 30).length,
      emptyCell: swatch(empty.x, empty.y).filter(([r, g, b]) => r < 40 && g < 40 && b < 40).length,
      swatchSize,
    };
  });
  assert.ok(probe.width > 100 && probe.height > 100, 'canvas has a backing store');
  assert.ok(probe.distinct > 6, `expected a painted scene, saw ${probe.distinct} colours`);
  assert.ok(probe.apple >= 3, `the apple should be red at its own cell, got ${probe.apple}/${probe.swatchSize}`);
  assert.ok(
    probe.head >= 3,
    `the head should be green at its own cell, got ${probe.head}/${probe.swatchSize}`,
  );
  assert.ok(
    probe.emptyCell >= 20,
    `an empty cell should read as the dark board, got ${probe.emptyCell}/${probe.swatchSize}`,
  );
  await page.close();
});

test('app: canvas backing store follows devicePixelRatio', async () => {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${server.url}/`, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForSelector('body[data-ready="1"]', { timeout: 90_000 });
  const metrics = await page.evaluate(() => {
    const canvas = document.getElementById('board');
    return {
      dpr: window.devicePixelRatio,
      backing: canvas.width,
      css: Math.round(canvas.getBoundingClientRect().width),
    };
  });
  assert.equal(metrics.dpr, 2);
  assert.ok(Math.abs(metrics.backing - metrics.css * 2) <= 2, `backing ${metrics.backing} vs css ${metrics.css}`);
  await context.close();
});

test('app: accessibility surface — labels, live region, focus, contrast', async () => {
  const { page } = await openPage(browser, `${server.url}/`);

  const unlabeled = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((button) => {
        const text = `${button.textContent ?? ''}`.trim();
        return !text && !button.getAttribute('aria-label');
      })
      .map((button) => button.id || button.className),
  );
  assert.deepEqual(unlabeled, [], 'every control needs an accessible name');

  const live = await page.evaluate(() => {
    const region = document.getElementById('live');
    return { present: Boolean(region), polite: region?.getAttribute('aria-live') ?? region?.getAttribute('role') };
  });
  assert.equal(live.present, true);
  assert.equal(live.polite, 'polite');

  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName,
      isBody: el === document.body,
      outline: style.outlineStyle,
      width: style.outlineWidth,
      name: el.id || el.className,
    };
  });
  assert.equal(focused.isBody, false, `focus should land on a control, not ${focused.name}`);
  assert.notEqual(focused.outline, 'none', 'focus must be visible');
  assert.notEqual(parseFloat(focused.width), 0, 'the focus ring must have a width');

  const contrast = await page.evaluate(() => {
    const lum = (color) => {
      const [r, g, b] = color.match(/\d+/g).slice(0, 3).map((v) => {
        const c = Number(v) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (fg, bg) => {
      const a = lum(fg);
      const b = lum(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const bgOf = (el) => {
      let node = el;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && !bg.includes('0)') && bg !== 'transparent') return bg;
        node = node.parentElement;
      }
      return 'rgb(6, 11, 8)';
    };
    const check = (selector) => {
      const el = document.querySelector(selector);
      const style = getComputedStyle(el);
      return { selector, ratio: Number(ratio(style.color, bgOf(el)).toFixed(2)) };
    };
    return [check('#score'), check('.stat-label'), check('.overlay-body'), check('.foot'), check('.pill-spec')];
  });
  for (const entry of contrast) {
    assert.ok(entry.ratio >= 4.5, `${entry.selector} contrast ${entry.ratio}:1 is below 4.5:1`);
  }
  await page.close();
});

test('app: reduced motion removes the animations', async () => {
  const { page } = await openPage(browser, `${server.url}/`, { reducedMotion: 'reduce' });
  const durations = await page.evaluate(() => {
    const card = document.querySelector('.overlay-card');
    const btn = document.querySelector('.icon-btn');
    return {
      card: getComputedStyle(card).animationDuration,
      btn: getComputedStyle(btn).transitionDuration,
    };
  });
  assert.ok(parseFloat(durations.card) <= 0.01, `card animation still ${durations.card}`);
  assert.ok(parseFloat(durations.btn) <= 0.01, `button transition still ${durations.btn}`);
  await page.close();
});

test('app: the theme control is labelled and the audio icon reflects the muted default', async () => {
  const { page } = await openPage(browser, `${server.url}/?seed=theme`);
  assert.equal(await page.getAttribute('#theme-btn use', 'href'), '#icon-theme');
  assert.match(await page.getAttribute('#theme-btn', 'aria-label'), /theme|system/i);
  assert.equal(await page.getAttribute('#sound-btn use', 'href'), '#icon-sound-off', 'muted by default');
  assert.equal(await page.getAttribute('#sound-btn', 'aria-pressed'), 'false');
  assert.equal(await page.getAttribute('#pause-btn', 'aria-pressed'), 'false');
  await page.close();
});

test('app: the ?theme parameter applies without writing a setting', async () => {
  const { page } = await openPage(browser, `${server.url}/?theme=light`);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('snake.settings.v1') ?? 'null'));
  assert.notEqual(stored?.theme, 'light', 'a URL override must not overwrite the saved preference');
  await page.close();
});
