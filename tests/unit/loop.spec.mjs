import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, createClock, createLoop } from '../../src/ui/loop.js';
import { MAX_CATCHUP_TICKS } from '../../src/sim/constants.js';

test('loop: a full second of frame time at 120 ms/tick is 8 ticks when the cap allows it', () => {
  // The cap is a parameter: with room to catch up, ticks track elapsed time exactly.
  const result = advance(0, 1000, 120, 8);
  assert.equal(result.ticks, 8);
  assert.equal(result.acc, 40);
  assert.ok(result.alpha >= 0 && result.alpha < 1);
});

test('loop: a normal 60 fps frame is one tick, a 250 ms hitch is two', () => {
  assert.equal(advance(0, 16.7, 120).ticks, 0);
  assert.equal(advance(104, 16.7, 120).ticks, 1);
  assert.equal(advance(0, 250, 120).ticks, 2);
});

test('loop: leftover time carries into the next frame instead of being lost', () => {
  const first = advance(0, 70, 120);
  assert.equal(first.ticks, 0);
  const second = advance(first.acc, 70, 120);
  assert.equal(second.ticks, 1, '140 ms of accumulated time pays for one tick');
  const third = advance(second.acc, 120, 120);
  assert.equal(third.ticks, 1);
});

test('loop: a 3 second stall costs at most MAX_CATCHUP_TICKS ticks and never a backlog', () => {
  const result = advance(0, 3000, 120, MAX_CATCHUP_TICKS);
  assert.equal(result.ticks, MAX_CATCHUP_TICKS);
  assert.equal(result.acc, 0, 'the unrunnable backlog is dropped, not banked');
});

test('loop: alpha stays inside [0, 1) for any elapsed time', () => {
  for (const elapsed of [0, 1, 16.7, 119, 120, 121, 999, 60000, -50, Number.NaN]) {
    const { alpha } = advance(0, elapsed, 120);
    assert.ok(alpha >= 0 && alpha < 1, `alpha out of range for ${elapsed}: ${alpha}`);
  }
});

test('loop: a zero or negative step length cannot spin the machine', () => {
  assert.equal(advance(0, 1000, 0).ticks, 0);
  assert.equal(advance(0, 1000, -10).ticks, 0);
});

test('loop: createLoop drives ticks and renders once per frame', () => {
  const clock = createClock(1000);
  let ticks = 0;
  const alphas = [];
  const loop = createLoop({
    getStepMs: () => 120,
    now: clock.now,
    requestFrame: () => 1,
    cancelFrame: () => {},
    onTick: () => {
      ticks += 1;
    },
    onRender: (alpha) => alphas.push(alpha),
  });

  loop.pump(250);
  assert.equal(ticks, 2);
  assert.equal(alphas.length, 1, 'one render per frame');
  loop.pump(120);
  assert.equal(ticks, 3);
  loop.stop();
  assert.equal(loop.running, false);
});

test('loop: reset() drops accumulated time so a pause never fast-forwards the snake', () => {
  const clock = createClock(0);
  let ticks = 0;
  const loop = createLoop({
    getStepMs: () => 120,
    now: clock.now,
    requestFrame: () => 1,
    cancelFrame: () => {},
    onTick: () => {
      ticks += 1;
    },
    onRender: () => {},
  });
  loop.pump(119);
  assert.equal(ticks, 0);
  loop.reset();
  loop.pump(119);
  assert.equal(ticks, 0, 'the pre-pause leftover must not count');
  loop.pump(1);
  assert.equal(ticks, 1, 'the next full step still ticks normally');
});

test('loop: the first frame after start() only sets a baseline, it never fast-forwards', () => {
  // The bug this guards: rAF can be held back for seconds while a page is unfocused or the host is
  // loaded. If that gap is charged as elapsed time, a fresh run ticks dozens of times before the
  // player sees anything — at frantic speed a brand-new snake dies before its first visible frame.
  const clock = createClock(0);
  let ticks = 0;
  const renders = [];
  const loop = createLoop({
    getStepMs: () => 100,
    now: clock.now,
    requestFrame: (cb) => {
      // Deliver the frame by hand so the test controls how long rAF took to come back.
      loop.__frame = cb;
      return 1;
    },
    cancelFrame: () => {},
    onTick: () => {
      ticks += 1;
    },
    onRender: (alpha) => renders.push(alpha),
  });

  loop.start();
  clock.set(4000); // rAF came back four seconds later
  loop.__frame(clock.now());
  assert.equal(ticks, 0, 'the start-to-first-frame gap is not game time');
  assert.equal(renders.length, 1, 'it still renders the frame');

  clock.set(4100); // one honest step after the baseline
  loop.__frame(clock.now());
  assert.equal(ticks, 1, 'normal stepping resumes from the new baseline');
  loop.stop();
});

test('loop: reset() re-baselines the next frame too', () => {
  const clock = createClock(0);
  let ticks = 0;
  const loop = createLoop({
    getStepMs: () => 100,
    now: clock.now,
    requestFrame: (cb) => {
      loop.__frame = cb;
      return 1;
    },
    cancelFrame: () => {},
    onTick: () => {
      ticks += 1;
    },
    onRender: () => {},
  });
  loop.start();
  loop.__frame(clock.now());
  clock.set(9000); // a long stall, then an explicit resume
  loop.reset();
  loop.__frame(clock.now());
  assert.equal(ticks, 0, 'the gap around a resume must not be charged');
  clock.set(9100);
  loop.__frame(clock.now());
  assert.equal(ticks, 1);
  loop.stop();
});

test('loop: start() uses the injected scheduler and is idempotent', () => {
  const clock = createClock(5);
  let scheduled = 0;
  let frames = 0;
  const loop = createLoop({
    getStepMs: () => 100,
    now: clock.now,
    requestFrame: () => {
      scheduled += 1;
      return scheduled;
    },
    cancelFrame: () => {},
    onTick: () => {},
    onRender: () => {
      frames += 1;
    },
  });
  loop.start();
  loop.start();
  assert.equal(scheduled, 1, 'double start does not double-schedule');
  assert.equal(loop.running, true);
  clock.set(160);
  loop.stop();
  assert.equal(loop.running, false);
});

test('loop: createClock is a plain deterministic clock', () => {
  const clock = createClock(10);
  assert.equal(clock.now(), 10);
  assert.equal(clock.advance(5), 15);
  assert.equal(clock.set(0), 0);
});
