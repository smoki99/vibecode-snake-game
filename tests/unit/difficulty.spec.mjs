import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, PRESET_IDS, presetFor, scoreGain, speedProgress, tierFor, tickMsFor } from '../../src/sim/difficulty.js';
import { createState } from '../../src/sim/state.js';
import { start, step } from '../../src/sim/step.js';

test('difficulty: presets exist, are ordered, and are all selectable', () => {
  assert.deepEqual(PRESET_IDS, ['chill', 'classic', 'frantic']);
  assert.ok(PRESETS.frantic.baseMs < PRESETS.classic.baseMs && PRESETS.classic.baseMs < PRESETS.chill.baseMs);
  for (const id of PRESET_IDS) assert.equal(presetFor(id).id, id);
});

test('difficulty: unknown or missing preset falls back to classic without throwing', () => {
  for (const junk of [undefined, null, '', 'nightmare', 42, {}, []]) {
    assert.equal(presetFor(junk).id, 'classic', `fallback failed for ${String(junk)}`);
  }
  assert.equal(createState({ seed: 'd', difficulty: 'nope' }).difficulty, 'classic');
});

test('difficulty: tick length is monotonically non-increasing and floored', () => {
  for (const id of PRESET_IDS) {
    const preset = PRESETS[id];
    let previous = preset.baseMs + 1;
    for (let eaten = 0; eaten <= 200; eaten += 1) {
      const ms = tickMsFor(preset, eaten);
      assert.ok(ms <= previous, `speed went backwards at eaten=${eaten}: ${previous} -> ${ms}`);
      assert.ok(ms >= preset.minMs, `below the floor at eaten=${eaten}`);
      previous = ms;
    }
    assert.equal(tickMsFor(preset, 200), preset.minMs, 'reaches the floor');
  }
});

test('difficulty: negative or junk apple counts cannot break the curve', () => {
  const preset = PRESETS.classic;
  assert.equal(tickMsFor(preset, -10), preset.baseMs);
  assert.equal(tickMsFor(preset, NaN), preset.baseMs);
});

test('difficulty: tier rises 1 → 2 → 3 and clamps at 3', () => {
  const preset = PRESETS.classic;
  assert.equal(tierFor(preset, 0), 1);
  assert.ok(tierFor(preset, 20) >= 2, 'tier should have risen by 20 apples');
  assert.equal(tierFor(preset, 400), 3);
  assert.ok(speedProgress(preset, 400) === 1);
});

test('score: an apple is worth 10 × tier, verified through real play', () => {
  const preset = PRESETS.classic;
  const state = { ...start(createState({ seed: 'score', difficulty: 'classic' })), board: { cols: 6, rows: 3 } };
  let run = { ...state, snake: [{ x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }], dir: 'right', score: 0, eaten: 0, status: 'playing' };

  // Feed it three apples in a row along row 1 and check the running total against the table.
  let expected = 0;
  for (let apple = 0; apple < 3; apple += 1) {
    const head = run.snake[0];
    const nextCell = { x: head.x + 1, y: head.y };
    if (nextCell.x >= run.board.cols) break;
    run = step({ ...run, food: nextCell });
    expected += scoreGain(preset, run.eaten - 1);
    assert.equal(run.score, expected, `score after apple ${apple + 1}`);
  }
  assert.equal(run.eaten, 3);
  assert.equal(run.snake.length, 6, 'three apples, three segments');
});
