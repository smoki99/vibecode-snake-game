import { MAX_CATCHUP_TICKS } from '../sim/constants.js';

/**
 * Fixed-timestep loop maths, split out from the browser glue so it can be proven with an
 * injected clock.
 *
 * Two rules matter:
 *  - ticks are consumed in whole `stepMs` units, so simulation speed is refresh-rate independent;
 *  - a stalled tab may never spend more than `maxTicks` ticks catching up. The leftover backlog is
 *    discarded, because "you were backgrounded for 3 seconds" must never mean "you died".
 */
export function advance(accumulator, elapsedMs, stepMs, maxTicks = MAX_CATCHUP_TICKS) {
  const clampedElapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  if (!(stepMs > 0) || !(maxTicks > 0)) return { acc: 0, ticks: 0, alpha: 0 };
  let acc = (Number.isFinite(accumulator) ? accumulator : 0) + clampedElapsed;
  let ticks = 0;
  while (acc >= stepMs && ticks < maxTicks) {
    acc -= stepMs;
    ticks += 1;
  }
  if (acc >= stepMs) acc = 0; // drop the unrunnable backlog
  return { acc, ticks, alpha: stepMs > 0 ? Math.min(1, acc / stepMs) : 0 };
}

/** Manual clock for tests and for deterministic replays. */
export function createClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
      return t;
    },
    set(ms) {
      t = ms;
      return t;
    },
  };
}

/**
 * requestAnimationFrame driver.
 *
 * `onTick(dt)` runs the simulation, `onRender(alpha, dt)` draws. The loop never touches game
 * state itself — it only decides how many ticks the frame is worth.
 */
export function createLoop({ onTick, onRender, getStepMs, now = () => performance.now(), requestFrame, cancelFrame }) {
  let accumulator = 0;
  let last = 0;
  let running = false;
  let handle = 0;
  let baselinePending = false;
  const schedule = requestFrame ?? ((cb) => requestAnimationFrame(cb));
  const unschedule = cancelFrame ?? ((h) => cancelAnimationFrame(h));

  function frame(timestamp) {
    if (!running) return;
    const t = typeof timestamp === 'number' ? timestamp : now();
    // The first frame after start()/reset() is a baseline, not elapsed time. requestAnimationFrame can
    // be held back for seconds while a page is unfocused or the machine is loaded, and that gap is not
    // game time: treating it as such fast-forwarded the snake the instant it began, which at frantic
    // speed meant a fresh run died before the player saw a frame. The loop already refuses to charge
    // for paused time on resume (reset()); this is the same rule applied to the first frame.
    if (baselinePending) {
      baselinePending = false;
      last = t;
      // Still paint this frame: the player must see the current state even on a frame that is not
      // allowed to advance the simulation.
      onRender(0, 0);
      handle = schedule(frame);
      return;
    }
    const elapsed = Math.max(0, t - last);
    last = t;
    const stepMs = getStepMs();
    const result = advance(accumulator, elapsed, stepMs);
    accumulator = result.acc;
    for (let i = 0; i < result.ticks; i += 1) onTick(stepMs);
    onRender(result.alpha, elapsed);
    handle = schedule(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      accumulator = 0;
      baselinePending = true; // the first frame only establishes `last`
      last = now();
      handle = schedule(frame);
    },
    stop() {
      running = false;
      if (handle) unschedule(handle);
      handle = 0;
    },
    /** Drop accumulated time: used on resume so a pause never fast-forwards the snake. */
    reset() {
      accumulator = 0;
      baselinePending = true; // ditto: the next frame re-baselines instead of charging the gap
      last = now();
    },
    /** Drive one frame by hand (tests, deterministic replays). */
    pump(elapsedMs, timestamp = now()) {
      const elapsed = Math.max(0, elapsedMs);
      const stepMs = getStepMs();
      const result = advance(accumulator, elapsed, stepMs);
      accumulator = result.acc;
      for (let i = 0; i < result.ticks; i += 1) onTick(stepMs);
      onRender(result.alpha, elapsed);
      return result;
    },
    get running() {
      return running;
    },
  };
}
