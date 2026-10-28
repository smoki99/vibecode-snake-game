import test from 'node:test';
import assert from 'node:assert/strict';
import {
  armKeys,
  eatApples,
  launchBrowser,
  openPage,
  pumpTick,
  pumpTicks,
  press,
  pumpUntilInPage,
  readState,
  startServer,
  warmUp,
} from '../helpers/browser.mjs';

/**
 * End-to-end gameplay through the real browser stack: keyboard events, the fixed-timestep loop,
 * canvas rendering and localStorage.
 *
 * Scripted manoeuvres run inside a single page.evaluate (see eatApples / pumpUntilInPage): the page
 * owns a live animation loop, so anything split across several round-trips would keep ticking while
 * the test was thinking. Real input events are used where the input pipeline itself is the subject.
 */

let server;
let browser;

test.before(async () => {
  server = await startServer();
  browser = await launchBrowser();
  await warmUp(browser, APP());
});

// Gameplay runs against the single-file bundle, not the dev page: one HTTP request instead of a
// thirty-module graph, which is the difference between a second and a minute on a loaded machine —
// and it means these tests exercise the artifact that actually ships. `npm run build` is part of
// npm test, so the bundle under test is always the current source.
const APP = () => `${server.url}/dist/snake-standalone.html`;

test.afterEach(async () => {
  // A failing assertion returns before page.close(); reclaim the context so one failure cannot
  // starve the rest of the file.
  for (const context of browser?.contexts() ?? []) await context.close().catch(() => {});
});

test.after(async () => {
  await browser?.close();
  await server?.close();
});

const pad4 = (value) => String(value).padStart(4, '0');

test('game: Space starts the run and the HUD goes live', async () => {
  const { page } = await openPage(browser, `${APP()}/?seed=play&theme=dark`);
  await armKeys(page);
  await press(page, 'Space');
  const state = await readState(page);
  assert.equal(state.status, 'playing');
  assert.equal(await page.getAttribute('#overlay', 'data-status'), 'playing', 'the overlay tracks the live status even while hidden');
  assert.equal(await page.isVisible('#overlay'), false, 'the overlay must leave the board alone while playing');
  assert.match(await page.getAttribute('#board', 'aria-label'), /snake board/i);
  await page.close();
});

test('game: arrow keys steer and a 180° reversal is refused', async () => {
  const { page } = await openPage(browser, `${APP()}/?seed=steer&theme=dark`);
  await armKeys(page);
  await press(page, 'Space');
  await press(page, 'ArrowUp');
  await pumpTick(page);
  let state = await readState(page);
  assert.equal(state.dir, 'up');
  const headAfterUp = state.head;

  await press(page, 'ArrowDown'); // straight back into the neck: must be ignored
  await pumpTick(page);
  state = await readState(page);
  assert.equal(state.dir, 'up');
  assert.deepEqual(state.head, { x: headAfterUp.x, y: headAfterUp.y - 1 });
  await page.close();
});

test('game: a two-stage feint queued in one frame both lands', async () => {
  const { page } = await openPage(browser, `${APP()}/?seed=feint&theme=dark`);
  await armKeys(page);
  await press(page, 'Space'); // heading right
  await press(page, 'ArrowUp');
  await press(page, 'ArrowLeft');
  await pumpTicks(page, 2);
  const state = await readState(page);
  assert.equal(state.dir, 'left', 'the buffered turn must survive the tick that consumed the first');
  await page.close();
});

test('game: eating an apple grows the snake and updates the HUD', async () => {
  const { page } = await openPage(browser, `${APP()}/?seed=eat&theme=dark`);
  await armKeys(page);
  await press(page, 'Space');
  const { eaten } = await eatApples(page, 1);
  assert.equal(
    eaten.status,
    'playing',
    `the trip to the apple should be survivable, got ${JSON.stringify(eaten.trail)}`,
  );
  assert.equal(eaten.length, 4, 'one apple is one segment');
  assert.ok(eaten.score >= 10, `an apple scores at least 10, got ${eaten.score}`);
  assert.equal(await page.textContent('#apples'), '1');
  assert.equal((await page.textContent('#score')).trim(), pad4(eaten.score));
  await page.close();
});

test('game: hitting a wall ends the run, stores the best and offers a restart', async () => {
  const { page } = await openPage(browser, `${APP()}/?seed=wall&difficulty=frantic&theme=dark`);
  await armKeys(page);
  await press(page, 'Space');
  // Eat first: a scoreless run is never stored, so it would prove nothing about the best-score card.
  const { eaten } = await eatApples(page, 1);
  assert.equal(eaten.status, 'playing', `the apple should be reachable, got ${JSON.stringify(eaten.trail)}`);

  const { satisfied } = await pumpUntilInPage(page, "state.status !== 'playing'");
  assert.ok(satisfied, 'running straight ahead must end at a wall');
  const after = await readState(page);

  assert.ok(after.score > 0, `the run should have scored before it ended, got ${after.score}`);
  assert.equal(after.status, 'over');
  assert.equal(after.reason, 'wall', 'running straight ahead can only end at a wall');
  assert.equal(await page.textContent('#overlay-title'), 'You met the wall');
  assert.equal(await page.textContent('#best'), pad4(after.score));

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('snake.best.v1')));
  assert.equal(stored.frantic, after.score);

  await press(page, 'KeyR');
  const restarted = await readState(page);
  assert.equal(restarted.status, 'playing');
  assert.equal(restarted.score, 0);
  assert.equal(restarted.length, 3);
  assert.equal(await page.textContent('#best'), pad4(after.score), 'best survives the run');
  await page.close();
});

test('game: self-collision is fatal and says so', async () => {
  const { page } = await openPage(browser, `${APP()}/?seed=self&theme=dark`);
  await armKeys(page);
  await press(page, 'Space');
  const { eaten, after } = await eatApples(page, 2, (game) => {
    const { cols, rows } = game.state.board;
    const marginOf = (cell) => Math.min(cell.x, cell.y, cols - 1 - cell.x, rows - 1 - cell.y);
    const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
    const key = (cell) => `${cell.x},${cell.y}`;

    // Walk into open water: legal turns only, in bounds, off our own body, preferring the roomier
    // cell, so the box below cannot be pre-empted by a wall.
    let ticks = 0;
    while (game.state.status === 'playing' && marginOf(game.state.snake[0]) < 5 && ticks < 200) {
      const head = game.state.snake[0];
      const blocked = new Set(game.state.snake.slice(0, -1).map(key));
      const options = Object.entries(DIRS)
        .filter(([dir]) => dir !== OPPOSITE[game.state.dir])
        .map(([dir, d]) => {
          const next = { x: head.x + d[0], y: head.y + d[1] };
          const open =
            next.x >= 0 &&
            next.y >= 0 &&
            next.x < cols &&
            next.y < rows &&
            !blocked.has(key(next));
          return { dir, margin: open ? marginOf(next) : -99 };
        })
        .filter((option) => option.margin > 1)
        .sort((a, b) => b.margin - a.margin);
      if (options.length === 0) break;
      game.steer(options[0].dir);
      game.pump(game.state.tickMs);
      ticks += 1;
    }
    // Recorded for the failure message only: how much room the escape walk happened to find depends
    // on where the apples spawned, so it is diagnostic rather than an assertion.
    const parked = game.state.status === 'playing' && marginOf(game.state.snake[0]) >= 5;

    // Keep turning clockwise: the head ends up circling a single cell and meets a body segment that
    // is genuinely still there. Relative turns, so nothing degenerates into a dropped reversal.
    const CLOCKWISE = ['up', 'right', 'down', 'left'];
    for (let i = 0; i < 12 && game.state.status === 'playing'; i += 1) {
      game.steer(CLOCKWISE[(CLOCKWISE.indexOf(game.state.dir) + 1) % 4]);
      game.pump(game.state.tickMs);
    }
    return {
      parked,
      length: game.state.snake.length,
      status: game.state.status,
      reason: game.state.lastEvent ? game.state.lastEvent.reason : null,
    };
  });

  assert.ok(
    eaten.length >= 5,
    `the box needs a body of at least five to collide with, got ${JSON.stringify(eaten)}`,
  );
  // The manoeuvre is a *suicide box*: the snake must be long enough to have a body to hit, and it has
  // to die by its own tail rather than by luck. Which open-water cell it reached depends on where the
  // apples spawned, so that is not asserted — see `parked` below for what it used to claim.
  assert.ok(after.length >= 5, `a self-collision needs a body of five, got ${JSON.stringify(after)}`);
  assert.equal(after.status, 'over', 'turning into your own body is fatal');
  assert.equal(after.reason, 'self', 'and it must be reported as a self collision, not a wall');
  assert.equal(await page.textContent('#overlay-title'), 'You met yourself');
  await page.close();
});

test('game: P pauses, P resumes, and the overlay explains it', async () => {
  const { page } = await openPage(browser, `${APP()}/?seed=pause&theme=dark`);
  await armKeys(page);
  await press(page, 'Space');
  await press(page, 'KeyP');
  assert.equal((await readState(page)).status, 'paused');
  assert.equal(await page.textContent('#overlay-title'), 'Paused');
  assert.ok(
    (await page.textContent('#overlay-hint')).includes('P'),
    'the overlay must say how to resume (the hint line carries the key, not the body copy)',
  );

  await press(page, 'Space');
  assert.equal((await readState(page)).status, 'playing');
  assert.equal(await page.isVisible('#overlay'), false);
  await page.close();
});

test('game: R restarts and keeps the chosen difficulty', async () => {
  const { page } = await openPage(browser, `${APP()}/?seed=again&difficulty=frantic&theme=dark`);
  await armKeys(page);
  await press(page, 'Space');
  await press(page, 'KeyR');
  const state = await readState(page);
  assert.equal(state.status, 'playing');
  assert.equal(state.difficulty, 'frantic');
  assert.equal(state.length, 3);
  await page.close();
});

test('game: changing difficulty mid-run restarts at that pace and keeps best scores separate', async () => {
  const { page } = await openPage(browser, `${APP()}/?seed=diff&theme=dark`);
  await armKeys(page);
  await press(page, 'Space');
  const classic = await readState(page);
  await page.click('input[value="frantic"]');
  const frantic = await readState(page);
  assert.equal(frantic.difficulty, 'frantic');
  assert.equal(frantic.status, 'playing', 'picking a difficulty means you want to play it now');
  assert.ok(frantic.tickMs < classic.tickMs, 'frantic has to be faster');
  assert.equal(frantic.length, 3, 'and it starts a clean run');
  // Changing pace starts a fresh run at that pace (documented behaviour), so the score resets while
  // the seed carries over — which is exactly why bests stay comparable and separable per preset.
  assert.equal(frantic.eaten, 0, 'a new pace means a new run');

  // Bests are per preset and must not leak between them: score under frantic, then play on chill.
  const scoreUnderFrantic = frantic.score;
  await eatApples(page, 1);
  await press(page, 'KeyR');
  await page.click('input[value="chill"]');
  const chill = await readState(page);
  assert.equal(chill.difficulty, 'chill');
  assert.ok(chill.tickMs > frantic.tickMs);
  assert.equal(chill.best, scoreUnderFrantic, 'the chill best must not inherit a frantic score');

  await page.click('input[value="frantic"]');
  const back = await readState(page);
  assert.equal(back.best, scoreUnderFrantic, 'and the frantic best must survive the detour');
  await page.close();
});

test('game: the sound toggle persists across a reload', async () => {
  const { page, context } = await openPage(browser, `${APP()}/?seed=sound&theme=dark`);
  await armKeys(page);
  await page.click('#sound-btn');
  assert.equal(await page.getAttribute('#sound-btn', 'aria-pressed'), 'true');
  const second = await context.newPage();
  await second.goto(`${APP()}/?seed=sound&theme=dark`, { timeout: 90_000 });
  await second.waitForSelector('body[data-ready]', { timeout: 90_000 });
  assert.equal(await second.getAttribute('#sound-btn', 'aria-pressed'), 'true', 'the choice must stick');
  await second.close();
  await page.close();
});

test('game: the theme button and the T key both cycle and persist', async () => {
  const { page, context } = await openPage(browser, `${APP()}/?seed=theme&theme=dark`);
  await armKeys(page);
  assert.equal(await page.getAttribute('#theme-btn', 'data-active'), 'dark');
  await page.click('#theme-btn');
  assert.equal(await page.getAttribute('#theme-btn', 'data-active'), 'light');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
  await press(page, 'KeyT');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'auto');
  await press(page, 'KeyT');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');

  await press(page, 'KeyT'); // → light, and this time it is remembered
  const second = await context.newPage();
  await second.goto(`${APP()}/?seed=theme`, { timeout: 90_000 });
  await second.waitForSelector('body[data-ready]', { timeout: 90_000 });
  assert.equal(await second.getAttribute('html', 'data-theme'), 'light', 'the choice must stick');
  await second.close();
  await page.close();
});

test('game: the d-pad and a swipe both drive the board on a touch viewport', async () => {
  // The d-pad is revealed by `@media (hover: none) and (pointer: coarse)`, which needs the context
  // to report a coarse pointer — `isMobile` alone does not change that media query.
  const { page } = await openPage(browser, `${APP()}/?seed=touch&theme=dark`, {
    viewport: { width: 420, height: 820 },
    hasTouch: true,
    isMobile: true,
  });
  await armKeys(page);
  assert.equal(await page.isVisible('[data-dir="up"]'), true, 'the d-pad must appear on small screens');

  // A d-pad tap while idle starts the run AND leaves the tapped heading in the queue, so the snake
  // visibly turns the way it was tapped instead of carrying on right. `pump` drives the sim by hand,
  // which keeps the page's own frame from racing the assertion.
  await page.tap('[data-dir="down"]');
  const armed = await readState(page);
  assert.equal(armed.status, 'playing', 'a d-pad tap starts the run');
  assert.deepEqual(armed.pending, ['down'], 'the tapped heading is queued, not swallowed by the start');
  const turned = await pumpUntilInPage(page, "state.dir === 'down'", 40);
  assert.ok(turned.satisfied, 'the tapped heading drives the snake');

  // A reversal must be refused rather than killing the run at tick one. The snake starts facing right,
  // so `left` is illegal and `up` is legal: only `up` may reach the queue. Frozen with P first, so the
  // real frame cannot drain the queue while it is being inspected.
  await press(page, 'KeyR');
  const refused = await page.evaluate(() => {
    window.game.pause(); // freeze it so the real frame cannot drain the queue mid-check
    window.game.steer('left'); // opposite of the heading: dropped
    window.game.steer('up'); // legal: queued
    return { pending: [...window.game.state.pending], status: window.game.state.status };
  });
  assert.equal(refused.status, 'playing', 'a refused reversal does not end the run');
  assert.deepEqual(refused.pending, ['up'], 'a reversal is dropped while a legal turn still queues');
  const upped = await pumpUntilInPage(page, "state.dir === 'up'", 40);
  assert.ok(upped.satisfied, 'the queued turn takes effect on the next tick');

  // A swipe queues its heading; driving the sim by hand then proves it lands. Deliberately not
  // asserting `dir` straight after pointerup: the queue is consumed on the next tick, so that would be
  // a race with the page's own frame rather than a check of behaviour.
  const box = await page.locator('#board').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const queued = await page.evaluate(() => [...window.game.state.pending]);
  assert.deepEqual(queued, ['left'], 'a left swipe queues a turn');
  const swiped = await pumpUntilInPage(page, "state.dir === 'left'", 40);
  assert.ok(swiped.satisfied, 'the swiped heading takes effect on the next tick');
  await page.close();
});

test('game: a long tab stall does not fast-forward the snake into a wall', async () => {
  const { page } = await openPage(browser, `${APP()}/?seed=stall&difficulty=chill&theme=dark`);
  await armKeys(page);
  await press(page, 'Space');
  const before = await readState(page);
  // One enormous frame: the loop must cap the catch-up instead of simulating nine seconds.
  const ticks = await page.evaluate(() => {
    const game = window.game;
    game.pump(9000);
    return game.state.ticks;
  });
  assert.ok(ticks <= 5, `a 9 s stall must run at most 5 catch-up ticks, ran ${ticks}`);
  const after = await readState(page);
  assert.equal(after.status, 'playing');
  assert.equal(after.length, before.length, 'a pause must not move the snake');
  await page.close();
});

test('game: the same seed replays identically in the shipped bundle', async () => {
  const { page } = await openPage(browser, `${APP()}/?seed=replay&difficulty=frantic&theme=dark`);
  await armKeys(page);
  const script = [
    'up', 'pump', 'pump', 'left', 'pump', 'pump', 'down', 'pump', 'pump', 'right', 'pump', 'pump',
    'up', 'pump', 'pump', 'left', 'pump', 'pump', 'down', 'pump', 'pump', 'pump', 'pump', 'right',
    'pump', 'pump', 'up', 'pump', 'pump', 'left', 'pump', 'pump', 'pump', 'pump',
  ];
  const play = () =>
    page.evaluate((moves) => {
      const game = window.game;
      const trace = [];
      for (const move of moves) {
        if (move === 'pump') game.pump(game.state.tickMs);
        else game.steer(move);
        trace.push([game.state.snake[0].x, game.state.snake[0].y, game.state.snake.length, game.state.score]);
      }
      return JSON.stringify({ trace, head: game.state.snake[0], length: game.state.snake.length, score: game.state.score });
    }, script);

  await press(page, 'Space');
  const first = await play();
  await press(page, 'KeyR');
  const second = await play();
  assert.equal(second, first, 'identical seed + identical inputs must produce an identical run');
  await page.close();
});
