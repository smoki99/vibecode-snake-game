/**
 * Browser test scaffolding: an in-process static server plus a Chromium page wired to record
 * console errors and every request it makes.
 *
 * Requests are recorded so tests can assert the runtime stays network-silent (the whole point of
 * vendored fonts, icons and audio).
 */
import { createStaticServer } from '../../tools/static-server.mjs';
import { loadPlaywright } from '../../tools/load-playwright.mjs';

export const ROOT = new URL('../../', import.meta.url).pathname;

export async function startServer({ root = ROOT } = {}) {
  const app = createStaticServer({ root });
  const url = await app.listen(0, '127.0.0.1');
  return { url, close: () => app.close() };
}

export async function launchBrowser({ attempts = 3, retryDelayMs = 1500 } = {}) {
  const { chromium } = await loadPlaywright();
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    } catch (error) {
      // A saturated host can refuse the fork Chromium needs; that is a wait-and-retry, not a failure.
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }
  throw new Error(`Chromium refused to start after ${attempts} attempts: ${lastError?.message ?? lastError}`);
}

/**
 * Open a page and start recording.
 * @returns page, errors (console.error + pageerror + failed requests), requests (all URLs)
 */
export async function openPage(browser, url, { viewport, reducedMotion, permissions, colorScheme = 'dark' } = {}) {
  const context = await browser.newContext({
    viewport: viewport ?? { width: 1280, height: 900 },
    reducedMotion,
    colorScheme, // the page's default theme is 'auto', so pin what the system prefers means
    deviceScaleFactor: 1,
    permissions,
  });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()}`));
  page.on('request', (request) => requests.push({ url: request.url(), type: request.resourceType() }));
  // Generous on purpose: Playwright's 30 s default turns a CPU-starved host into a wall of
  // unrelated timeouts. The node --test-timeout is the real backstop.
  await page.goto(url, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForSelector('body[data-ready="1"]', { timeout: 90_000 });
  return {
    page,
    context,
    errors,
    requests,
    /** Requests that would leave the machine: http(s) origins other than the test server. */
    externalRequests: () =>
      requests.filter((entry) => /^https?:\/\//.test(entry.url) && !entry.url.startsWith(url.replace(/\/$/, ''))),
  };
}

/**
 * Cold-Chromium warm-up: open one page and send one real input event before any test runs.
 *
 * The first genuine input event dispatched into a freshly launched browser can take tens of
 * seconds on a contended host (the renderer has to come up, latch focus and ack the event), and
 * that cost used to land on whichever test happened to run first — looking exactly like a game that
 * ignores the space bar. Absorbing it here makes per-test timings comparable.
 */
export async function warmUp(browser, url, { budgetMs = 8_000 } = {}) {
  const work = (async () => {
    const { page } = await openPage(browser, url);
    await page.keyboard.press('Space').catch(() => {});
    await page.mouse.move(10, 10).catch(() => {});
    await page.close().catch(() => {});
  })();
  // Best effort, and never longer than the budget: a warm-up that itself wedges must not be able to
  // fail the whole file from inside the before hook.
  const budget = new Promise((resolve) => {
    const timer = setTimeout(resolve, budgetMs);
    if (timer.unref) timer.unref();
  });
  await Promise.race([work.catch(() => {}), budget]);
}

/**
 * Arm a keystroke delivery barrier on a page. Call once after opening it.
 *
 * The listener is added at boot time from the test, so it sits on `window` in the bubble phase
 * *after* the game's own handler: when the counter moves, the game has already processed the key.
 */
export async function armKeys(page) {
  await page.evaluate(() => {
    window.__keysSeen = 0;
    window.addEventListener('keydown', () => {
      window.__keysSeen += 1;
    });
  });
}

/**
 * Press a key and wait until the page has provably handled it, re-pressing if the wait expires.
 *
 * On a contended host Chromium's input acknowledgement can be late by tens of seconds and the first
 * press of a session is sometimes dropped outright — the keystroke never reaches any listener, which
 * looks exactly like a game that ignores the space bar. Waiting for the delivery counter (rather than
 * sleeping) keeps the test's own assertions strict: this only guarantees the key arrived, never that
 * the game behaved, and it costs ~1 ms when the browser is healthy.
 */
export async function press(page, keyName, { attempts = 3, timeoutMs = 30_000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const before = await page.evaluate(() => window.__keysSeen ?? 0);
    await page.keyboard.press(keyName);
    try {
      await page.waitForFunction((count) => (window.__keysSeen ?? 0) > count, before, { timeout: timeoutMs });
      return attempt;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`pressing ${keyName} ${attempts}× never reached the page: ${lastError?.message ?? lastError}`);
}

/** Read the game snapshot the page exposes at window.game (see src/main.js). */
export const readState = (page) =>
  page.evaluate(() => {
    const game = window.game;
    const state = game.state;
    return {
      status: state.status,
      score: state.score,
      eaten: state.eaten,
      ticks: state.ticks,
      length: state.snake.length,
      head: { ...state.snake[0] },
      snake: state.snake.map((cell) => ({ ...cell })),
      food: state.food ? { ...state.food } : null,
      dir: state.dir,
      pending: [...state.pending],
      difficulty: state.difficulty,
      tickMs: state.tickMs,
      tier: state.tier,
      best: state.best,
      seed: state.seed,
      theme: document.documentElement.dataset.theme,
      muted: game.muted,
    };
  });

/** One simulation tick, driven by hand rather than by the wall clock. */
export const pumpTick = (page) => page.evaluate(() => window.game.pump(window.game.state.tickMs));
export const pumpTicks = async (page, count) => {
  for (let i = 0; i < count; i += 1) await pumpTick(page);
};

/**
 * Advance the simulation inside a single `page.evaluate`, so the page's own animation loop cannot
 * interleave ticks between test actions. Scripted manoeuvres must run this way or the snake drifts
 * while the test is thinking.
 */
export async function pumpUntilInPage(page, predicateSource, maxTicks = 400) {
  return page.evaluate(
    ([source, max]) => {
      const predicate = new Function('state', `return Boolean((${source})(state))`);
      let ticks = 0;
      while (!predicate(window.game.state) && ticks < max) {
        window.game.pump(window.game.state.tickMs);
        ticks += 1;
      }
      return { satisfied: predicate(window.game.state), ticks };
    },
    [predicateSource, maxTicks],
  );
}

/**
 * Steer to and eat `count` apples entirely in-page, one legal turn per tick, pathing around the
 * snake's own body. An optional `then(game)` runs in the same evaluate, so a follow-up manoeuvre
 * cannot be disturbed by the page's own animation loop. Returns `{ eaten, after }`.
 */
export async function eatApples(page, count = 1, then = null) {
  return page.evaluate(
    ([n, followUp]) => {
    const game = window.game;
    const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
    const key = (cell) => `${cell.x},${cell.y}`;

    /** Breadth-first: the cell to step into first on a route from `from` to `to`. */
    function firstStep(from, to, blocked) {
      const queue = [from];
      const seen = new Map([[key(from), null]]);
      while (queue.length > 0) {
        const current = queue.shift();
        if (current.x === to.x && current.y === to.y) return seen.get(key(current));
        for (const [, d] of Object.entries(DIRS)) {
          const next = { x: current.x + d[0], y: current.y + d[1] };
          const inBoard =
            next.x >= 0 && next.y >= 0 && next.x < game.state.board.cols && next.y < game.state.board.rows;
          if (!inBoard || blocked.has(key(next)) || seen.has(key(next))) continue;
          seen.set(key(next), current === from ? next : seen.get(key(current)));
          queue.push(next);
        }
      }
      return null;
    }

    const trail = [];
    for (let apple = 0; apple < n && game.state.status === 'playing'; apple += 1) {
      // The apple is consumed and the next one spawns in the same tick, so "head sits on the
      // apple" is never observable. Watch the body grow instead — otherwise this loop keeps
      // hunting apples forever and the caller gets a 30-segment snake when they asked for one.
      const lengthBefore = game.state.snake.length;
      let ticks = 0;
      while (game.state.status === 'playing' && ticks < 600) {
        ticks += 1;
        const head = game.state.snake[0];
        const blocked = new Set(game.state.snake.slice(0, -1).map(key));
        const step = firstStep(head, game.state.food, blocked);
        if (step === null) break;
        const wanted =
          Object.keys(DIRS).find((k) => DIRS[k][0] === step.x - head.x && DIRS[k][1] === step.y - head.y) ??
          game.state.dir;
        game.steer(wanted === OPPOSITE[game.state.dir] ? game.state.dir : wanted);
        game.pump(game.state.tickMs);
        if (game.state.snake.length > lengthBefore) break;
      }
      trail.push({ length: game.state.snake.length, score: game.state.score, status: game.state.status, ticks });
    }
    const result = {
      trail,
      status: game.state.status,
      score: game.state.score,
      length: game.state.snake.length,
      head: { ...game.state.snake[0] },
    };
    return { eaten: result, after: followUp ? followUp(game) : null };
  },
    [count, then],
  );
}
