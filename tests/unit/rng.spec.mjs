import test from 'node:test';
import assert from 'node:assert/strict';
import { next, nextInt, seedFrom } from '../../src/sim/rng.js';

test('rng: same seed produces the same sequence', () => {
  const run = (seed) => {
    let s = seedFrom(seed);
    const out = [];
    for (let i = 0; i < 20; i += 1) {
      const r = next(s);
      s = r.state;
      out.push(r.value);
    }
    return out;
  };
  assert.deepEqual(run('abc'), run('abc'));
  assert.notDeepEqual(run('abc'), run('abd'));
});

test('rng: values stay in [0, 1)', () => {
  let s = seedFrom(42);
  for (let i = 0; i < 5000; i += 1) {
    const r = next(s);
    s = r.state;
    assert.ok(r.value >= 0 && r.value < 1, `value out of range: ${r.value}`);
  }
});

test('rng: nextInt stays inside [0, max) and covers the whole range', () => {
  let s = seedFrom('spread');
  const max = 432;
  const seen = new Set();
  for (let i = 0; i < 4000; i += 1) {
    const r = nextInt(s, max);
    s = r.state;
    assert.ok(Number.isInteger(r.value) && r.value >= 0 && r.value < max, `out of range: ${r.value}`);
    seen.add(r.value);
  }
  // 4000 draws over 432 buckets should touch most buckets; a stuck generator touches one.
  assert.ok(seen.size > max * 0.8, `only ${seen.size} distinct values`);
});

test('rng: seedFrom normalises junk into a 32-bit int', () => {
  for (const input of [undefined, null, '', 'hello', 0, -5, 1.5, Number.NaN, 2 ** 40]) {
    const seed = seedFrom(input);
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, `bad seed for ${String(input)}`);
  }
});
