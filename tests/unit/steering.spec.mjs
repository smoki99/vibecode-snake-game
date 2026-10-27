import test from 'node:test';
import assert from 'node:assert/strict';
import { isOpposite, pushTurn, takeSteering } from '../../src/sim/steering.js';
import { MAX_QUEUED_TURNS } from '../../src/sim/constants.js';
import { createState } from '../../src/sim/state.js';
import { start, step } from '../../src/sim/step.js';

test('steering: opposite pairs', () => {
  assert.equal(isOpposite('left', 'right'), true);
  assert.equal(isOpposite('up', 'down'), true);
  assert.equal(isOpposite('up', 'left'), false);
  assert.equal(isOpposite('up', 'up'), false);
  assert.equal(isOpposite('up', 'nope'), false);
});

test('steering: a reversal against the current heading is dropped', () => {
  assert.deepEqual(pushTurn([], 'left', 'right'), []);
  assert.deepEqual(pushTurn([], 'up', 'right'), ['up']);
});

test('steering: a duplicate turn is collapsed, so mashing a key queues nothing extra', () => {
  assert.deepEqual(pushTurn([], 'up', 'up'), []);
  assert.deepEqual(pushTurn(['up'], 'up', 'right'), ['up']);
});

test('steering: the chain is validated against the queued heading, not the last tick', () => {
  // Heading right: up is legal, then left is legal *because the queued heading is now up*.
  const queued = pushTurn(pushTurn([], 'up', 'right'), 'left', 'right');
  assert.deepEqual(queued, ['up', 'left']);
  // But from right, up then right is a reversal of the queued up? No — right is legal after up.
  assert.deepEqual(pushTurn(pushTurn([], 'up', 'right'), 'down', 'right'), ['up'], 'down reverses up');
});

test('steering: overflow drops the oldest key, keeping the most recent intent', () => {
  let pending = [];
  for (const dir of ['up', 'left', 'down', 'right']) pending = pushTurn(pending, dir, 'right');
  assert.ok(pending.length <= MAX_QUEUED_TURNS, 'queue is bounded');
  assert.deepEqual(pending.slice(-1), ['right'], 'the newest key survives');
});

test('steering: takeSteering consumes one turn and re-checks the reversal as a safety net', () => {
  const first = takeSteering(['up', 'left'], 'right');
  assert.equal(first.dir, 'up');
  assert.deepEqual(first.pending, ['left']);
  const handBuilt = takeSteering(['left'], 'right'); // impossible via pushTurn, still safe
  assert.equal(handBuilt.dir, 'right', 'a hand-built reversal cannot happen');
  assert.deepEqual(handBuilt.pending, []);
  assert.deepEqual(takeSteering([], 'down'), { dir: 'down', pending: [] });
});

test('regression: up-then-left inside one tick cannot kill a rightward snake', () => {
  let state = start(createState({ seed: 'combo' }));
  // Two keys land between two ticks: this is the classic self-kill bug.
  state = step(state, { turns: ['up', 'left'] });
  assert.equal(state.status, 'playing', 'survives the combo');
  assert.equal(state.snake[0].y, state.snake[1].y - 1, 'moved up on the first tick');
  state = step(state);
  assert.equal(state.status, 'playing', 'survives the second queued turn');
  assert.equal(state.snake[0].x, state.snake[1].x - 1, 'moved left on the second tick');
});

test('regression: a single-tick reversal attempt never reverses the heading', () => {
  let state = start(createState({ seed: 'rev' }));
  state = step(state, { turns: ['left'] });
  assert.equal(state.dir, 'right', 'reversal ignored, snake keeps going right');
});
