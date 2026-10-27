import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, restartWith } from '../../src/sim/state.js';
import { DIRS, STATUS, inBoard, cellKey } from '../../src/sim/constants.js';
import { hitsBody, pause, resume, start, step, togglePause, turn } from '../../src/sim/step.js';

/** A running game with an optional hand-placed snake/food, so tests can pin exact scenarios. */
function playing(overrides = {}) {
  const base = start(createState({ seed: 'scenario' }));
  return { ...base, status: STATUS.playing, ...overrides };
}

const headOf = (state) => state.snake[0];

test('step: advances one cell per tick and records prev for interpolation', () => {
  const state = playing({ snake: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], food: { x: 20, y: 2 }, pending: [] });
  const next = step(state);
  assert.deepEqual(headOf(next), { x: 6, y: 5 });
  assert.deepEqual(next.prev[0], { x: 5, y: 5 });
  assert.equal(next.ticks, state.ticks + 1);
});

test('step: only a playing state advances (idle, paused and over are frozen)', () => {
  const idle = createState({ seed: 'frozen' });
  assert.equal(step(idle), idle, 'idle must not move');
  const paused = pause(playing());
  assert.equal(step(paused), paused, 'paused must not move');
  const dead = { ...playing(), status: STATUS.over };
  assert.equal(step(dead), dead, 'a finished game must not move');
});

test('step: eating an apple adds exactly one segment, one apple and points', () => {
  const state = playing({ snake: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], food: { x: 6, y: 5 }, eaten: 0, score: 0 });
  const next = step(state);
  assert.equal(next.snake.length, 4, 'length grows by exactly one');
  assert.equal(next.eaten, 1);
  assert.equal(next.score, 10, 'tier-1 apple is worth 10');
  assert.deepEqual(headOf(next), { x: 6, y: 5 });
  assert.ok(next.food, 'a new apple appears');
  assert.equal(next.snake.map(cellKey).includes(cellKey(next.food)), false, 'apple never spawns on the snake');
  assert.deepEqual(next.lastEvent, { type: 'eat', at: next.ticks, cell: { x: 6, y: 5 } });
});

test('step: the tail lifts when nothing is eaten, so length is constant', () => {
  const state = playing({ snake: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], food: { x: 20, y: 2 } });
  const next = step(state);
  assert.equal(next.snake.length, 3);
  assert.equal(next.snake.map(cellKey).includes('3,5'), false, 'the vacated tail cell is free');
});

test('step: hitting a wall ends the run and banks the score', () => {
  const board = createState({ seed: 'w' }).board;
  const state = playing({
    board,
    snake: [
      { x: board.cols - 1, y: 5 },
      { x: board.cols - 2, y: 5 },
      { x: board.cols - 3, y: 5 },
    ],
    food: { x: 1, y: 1 },
    score: 250,
    best: 100,
  });
  const next = step(state);
  assert.equal(next.status, STATUS.over);
  assert.equal(next.best, 250, 'best picks up the higher score');
  assert.equal(next.lastEvent.type, 'die');
});

test('step: a lower score never lowers the stored best', () => {
  const board = createState({ seed: 'w' }).board;
  const state = playing({
    board,
    snake: [
      { x: board.cols - 1, y: 9 },
      { x: board.cols - 2, y: 9 },
      { x: board.cols - 3, y: 9 },
    ],
    score: 10,
    best: 5000,
  });
  assert.equal(step(state).best, 5000);
});

test('step: running into your own body ends the run', () => {
  // A 2x2 hook: heading down into the body that sits below the head.
  const state = playing({
    snake: [
      { x: 5, y: 4 },
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 4, y: 4 },
    ],
    dir: 'left',
    pending: ['down'],
    food: { x: 20, y: 1 },
  });
  const next = step(state);
  assert.equal(headOf(next), state.snake[0], 'head unchanged on death');
  assert.equal(next.status, STATUS.over);
});

test('step: moving into the cell the tail is vacating is legal (classic forgiveness)', () => {
  // Square loop: the head's next cell (5,5) is exactly the tail's current cell.
  const state = playing({
    snake: [
      { x: 5, y: 4 },
      { x: 6, y: 4 },
      { x: 6, y: 5 },
      { x: 5, y: 5 },
    ],
    dir: 'down',
    food: { x: 20, y: 1 },
  });
  const next = step(state);
  assert.equal(next.status, STATUS.playing, 'must survive');
  assert.deepEqual(headOf(next), { x: 5, y: 5 });
  assert.equal(new Set(next.snake.map(cellKey)).size, next.snake.length, 'no duplicated cells');
});

test('step: growth removes the tail-vacate forgiveness (tail stays, so it is a wall)', () => {
  const growing = {
    ...playing({
      snake: [
        { x: 5, y: 4 },
        { x: 6, y: 4 },
        { x: 6, y: 5 },
        { x: 5, y: 5 },
      ],
      dir: 'down',
      food: { x: 5, y: 5 }, // the tail cell is also the apple: eating keeps the tail ⇒ collision
      grows: 0,
    }),
  };
  const next = step(growing);
  assert.equal(next.status, STATUS.over, 'a staying tail occupies its cell');
});

test('step: intents are legal-transition only', () => {
  const state = playing();
  const paused = pause(state);
  assert.equal(start(state), state, 'start on a running game is a no-op');
  assert.equal(paused.status, STATUS.paused);
  assert.equal(step(paused), paused, 'a paused state does not advance');
  assert.equal(resume(paused).status, STATUS.playing);
  assert.equal(resume(state), state, 'resume on a running game is a no-op');
  assert.equal(togglePause(state).status, STATUS.paused);
  assert.equal(togglePause(paused).status, STATUS.playing);
  const dead = { ...state, status: STATUS.over };
  assert.equal(togglePause(dead), dead, 'you cannot pause a dead run');
  assert.equal(pause(dead), dead);
  assert.equal(resume(dead), dead);
});

test('step: turn() queues legal turns and drops reversals', () => {
  const state = playing({ dir: 'right', pending: [] });
  assert.deepEqual(turn(state, 'up').pending, ['up']);
  assert.deepEqual(turn(state, 'left').pending, [], 'reversal is rejected');
  assert.deepEqual(turn(state, 'right').pending, [], 'same-direction key is a no-op');
  assert.deepEqual(turn(pause(state), 'up').pending, [], 'no queueing while paused');
});

test('step: a stalled frame cannot corrupt a dead game (repeat stepping is idempotent)', () => {
  const board = createState({ seed: 'w' }).board;
  let state = playing({
    board,
    snake: [
      { x: board.cols - 1, y: 3 },
      { x: board.cols - 2, y: 3 },
      { x: board.cols - 3, y: 3 },
    ],
  });
  state = step(state);
  assert.equal(state.status, STATUS.over);
  const frozen = state;
  for (let i = 0; i < 10; i += 1) assert.equal(step(frozen), frozen);
});

test('step: 500 ticks of scripted play keep every invariant', () => {
  let state = start(createState({ seed: 'marathon' }));
  let apples = 0;
  for (let tick = 0; tick < 500; tick += 1) {
    const dir = safeDir(state);
    state = step(state, { turns: [dir] });

    if (state.status === STATUS.over) {
      assert.ok(state.snake.length >= 3);
      assert.ok(state.score <= state.best, 'death banks the score into best');
      state = restartWith(state, { status: STATUS.playing });
      continue;
    }

    const keys = state.snake.map(cellKey);
    assert.equal(new Set(keys).size, keys.length, 'no duplicated cells');
    assert.equal(state.snake.length, 3 + state.eaten + state.grows, 'length tracks apples');
    assert.ok(state.score >= state.eaten * 10, 'score never lags apples');
    assert.equal(state.snake.map(cellKey).includes(cellKey(state.food)), false, 'apple off the body');
    assert.ok(inBoard(state.food, state.board), 'apple inside the board');
    assert.ok(state.tickMs >= state.preset.minMs && state.tickMs <= state.preset.baseMs, 'tick length in range');
    apples = Math.max(apples, state.eaten);
  }
  assert.ok(apples > 0, 'the scripted policy actually ate something — otherwise this test proves nothing');
});

/** Prefer straight ahead, then a clockwise fan; never step into a wall or (likely) the body. */
function safeDir(state) {
  const head = headOf(state);
  const order = [state.dir, 'down', 'left', 'up', 'right'];
  for (const candidate of order) {
    const cell = { x: head.x + DIRS[candidate].x, y: head.y + DIRS[candidate].y };
    if (!inBoard(cell, state.board)) continue;
    const tailVacates = state.grows === 0;
    if (hitsBody(cell, state.snake, tailVacates)) continue;
    if (candidate === state.dir) return candidate;
    return candidate;
  }
  return state.dir;
}
