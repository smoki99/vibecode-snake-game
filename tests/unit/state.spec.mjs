import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, restartWith, startingSnake } from '../../src/sim/state.js';
import { STATUS, BOARD, cellKey } from '../../src/sim/constants.js';

test('state: same seed ⇒ deep-equal snapshot', () => {
  assert.deepEqual(createState({ seed: 'seed-1' }), createState({ seed: 'seed-1' }));
});

test('state: different seeds diverge (food placement differs)', () => {
  const a = createState({ seed: 'a' });
  const b = createState({ seed: 'b' });
  assert.notDeepEqual(a.food, b.food);
});

test('state: starts with a 3-cell snake pointing right, inside the board', () => {
  const state = createState({ seed: 'x' });
  assert.equal(state.snake.length, 3);
  assert.equal(state.dir, 'right');
  assert.equal(state.status, STATUS.idle);
  for (const cell of state.snake) {
    assert.ok(cell.x >= 0 && cell.x < BOARD.cols && cell.y >= 0 && cell.y < BOARD.rows);
  }
  assert.deepEqual(startingSnake(BOARD).slice(0, 2), [
    { x: Math.floor(BOARD.cols / 2), y: Math.floor(BOARD.rows / 2) },
    { x: Math.floor(BOARD.cols / 2) - 1, y: Math.floor(BOARD.rows / 2) },
  ]);
});

test('state: first apple is never on the snake', () => {
  for (let i = 0; i < 200; i += 1) {
    const state = createState({ seed: `s${i}` });
    assert.notEqual(state.snake.map(cellKey).includes(cellKey(state.food)), true);
  }
});

test('state: prev mirrors snake so frame 0 has nothing to interpolate', () => {
  const state = createState({ seed: 'p' });
  assert.deepEqual(state.prev, state.snake);
});

test('state: junk best-score input degrades to 0, never NaN', () => {
  for (const best of [undefined, null, NaN, 'abc', -3, {}, 12.7]) {
    const state = createState({ seed: 'b', best });
    assert.ok(Number.isInteger(state.best) && state.best >= 0, `bad best for ${String(best)}: ${state.best}`);
  }
  assert.equal(createState({ seed: 'b', best: 4200 }).best, 4200);
});

test('state: restartWith resets the run but keeps seed, preset and best', () => {
  const first = createState({ seed: 'keep', difficulty: 'frantic', best: 900 });
  const played = { ...first, status: STATUS.over, score: 120, eaten: 12, snake: [...first.snake, { x: 3, y: 3 }], pending: ['up'] };
  const fresh = restartWith(played);
  assert.equal(fresh.seed, 'keep');
  assert.equal(fresh.difficulty, 'frantic');
  assert.equal(fresh.best, 900);
  assert.equal(fresh.snake.length, 3);
  assert.equal(fresh.score, 0);
  assert.equal(fresh.status, STATUS.idle);
  assert.deepEqual(fresh.pending, []);
  assert.deepEqual(fresh.food, played.food, 'same seed replays the same first apple');
});

test('state: unknown difficulty falls back to classic', () => {
  assert.equal(createState({ seed: 'z', difficulty: 'nightmare' }).difficulty, 'classic');
});
