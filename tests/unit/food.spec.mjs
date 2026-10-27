import test from 'node:test';
import assert from 'node:assert/strict';
import { freeCells, spawnFood } from '../../src/sim/food.js';
import { createState } from '../../src/sim/state.js';
import { cellKey, BOARD } from '../../src/sim/constants.js';
import { seedFrom } from '../../src/sim/rng.js';

const boardOf = (cols, rows) => ({ cols, rows });

test('food: never lands on the snake (10 000 seeded placements)', () => {
  let state = createState({ seed: 'never-on-snake' });
  const snake = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
    { x: 4, y: 0 },
  ];
  for (let i = 0; i < 10000; i += 1) {
    const placed = spawnFood({ ...state, snake, board: BOARD });
    assert.equal(placed.won, false);
    assert.equal(snake.map(cellKey).includes(cellKey(placed.food)), false, `hit body at i=${i}`);
    assert.ok(placed.food.x >= 0 && placed.food.x < BOARD.cols);
    state = { ...state, rngState: placed.rngState };
  }
});

test('food: the free-cell list is exhaustive and stable', () => {
  const board = boardOf(3, 2);
  const snake = [{ x: 1, y: 0 }];
  const free = freeCells(snake, board);
  assert.equal(free.length, 6 - 1);
  assert.deepEqual(free[0], { x: 0, y: 0 });
  assert.deepEqual(free.at(-1), { x: 2, y: 1 });
  assert.equal(free.map(cellKey).includes('1,0'), false);
});

test('food: a near-full board places the single free cell instead of spinning', () => {
  const board = boardOf(2, 2);
  const snake = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  const placed = spawnFood({ snake, board, rngState: seedFrom('full') });
  assert.deepEqual(placed.food, { x: 1, y: 1 });
  assert.equal(placed.won, false);
});

test('food: a completely full board reports won and terminates', () => {
  const board = boardOf(2, 2);
  const snake = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ];
  const placed = spawnFood({ snake, board, rngState: seedFrom('full') });
  assert.equal(placed.won, true);
});

test('food: the same seed yields the same apple sequence', () => {
  const run = () => {
    let rngState = seedFrom('sequence');
    const out = [];
    const snake = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
    ];
    for (let i = 0; i < 50; i += 1) {
      const placed = spawnFood({ snake, board: BOARD, rngState });
      out.push(cellKey(placed.food));
      rngState = placed.rngState;
    }
    return out;
  };
  assert.deepEqual(run(), run());
});

test('food: placement is spread out, not stuck on one cell or a corner', () => {
  let rngState = seedFrom('spread');
  const seen = new Set();
  const snake = [{ x: 5, y: 5 }];
  for (let i = 0; i < 3000; i += 1) {
    const placed = spawnFood({ snake, board: BOARD, rngState });
    seen.add(cellKey(placed.food));
    rngState = placed.rngState;
  }
  assert.ok(seen.size > 300, `only ${seen.size} distinct cells used out of ${BOARD.cols * BOARD.rows - 1}`);
});
