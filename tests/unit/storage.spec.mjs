import test from 'node:test';
import assert from 'node:assert/strict';
import { readBest, readScores, readSettings, writeBest, writeSettings } from '../../src/sim/storage.js';
import { fakeStorage, throwingStorage, missingStorage } from '../helpers/fake-storage.mjs';
import { STORAGE_KEYS } from '../../src/sim/constants.js';

test('storage: empty storage reads defaults', () => {
  assert.deepEqual(readScores(fakeStorage()), { chill: 0, classic: 0, frantic: 0 });
  assert.equal(readBest(fakeStorage(), 'classic'), 0);
  assert.deepEqual(readSettings(fakeStorage()), { difficulty: 'classic', muted: true, theme: 'auto' });
});

test('storage: best score round-trips per preset', () => {
  const store = fakeStorage();
  assert.equal(writeBest(store, 'frantic', 340), 340);
  assert.equal(readBest(store, 'frantic'), 340);
  assert.equal(readBest(store, 'classic'), 0, 'presets are tracked separately');
  assert.equal(JSON.parse(store.data.get(STORAGE_KEYS.best)).frantic, 340);
});

test('storage: a lower score never lowers the stored best', () => {
  const store = fakeStorage({ [STORAGE_KEYS.best]: JSON.stringify({ chill: 900, classic: 500, frantic: 0 }) });
  assert.equal(writeBest(store, 'classic', 120), 500);
  assert.equal(readBest(store, 'classic'), 500);
  assert.equal(writeBest(store, 'classic', 1200), 1200);
});

test('storage: corrupt or hostile stored values degrade to defaults', () => {
  const cases = [
    'not json',
    '{"classic": "lots"}',
    '{"classic": -5}',
    '{"classic": null}',
    '[1,2,3]',
    'null',
    '"a string"',
    '{"classic": {"nested": 1}}',
    '',
  ];
  for (const raw of cases) {
    const store = fakeStorage({ [STORAGE_KEYS.best]: raw, [STORAGE_KEYS.settings]: raw });
    assert.equal(readBest(store, 'classic'), 0, `best not sanitised for ${raw}`);
    const settings = readSettings(store);
    assert.equal(settings.difficulty, 'classic');
    assert.equal(typeof settings.muted, 'boolean');
    assert.ok(['auto', 'dark', 'light'].includes(settings.theme));
  }
});

test('storage: throwing storage (private mode, quota) never propagates', () => {
  const angry = throwingStorage();
  assert.deepEqual(readScores(angry), { chill: 0, classic: 0, frantic: 0 });
  assert.deepEqual(readSettings(angry), { difficulty: 'classic', muted: true, theme: 'auto' });
  assert.equal(writeBest(angry, 'classic', 10), 10, 'reports the in-memory best but writes nothing');
  assert.doesNotThrow(() => writeSettings(angry, { muted: false }));
});

test('storage: absent storage object is tolerated', () => {
  assert.deepEqual(readScores(missingStorage), { chill: 0, classic: 0, frantic: 0 });
  assert.deepEqual(readSettings(missingStorage), { difficulty: 'classic', muted: true, theme: 'auto' });
  assert.doesNotThrow(() => writeSettings(missingStorage, { theme: 'light' }));
});

test('storage: settings patch only the keys it names', () => {
  const store = fakeStorage();
  writeSettings(store, { muted: false });
  assert.deepEqual(readSettings(store), { difficulty: 'classic', muted: false, theme: 'auto' });
  writeSettings(store, { difficulty: 'chill' });
  assert.deepEqual(readSettings(store), { difficulty: 'chill', muted: false, theme: 'auto' });
  writeSettings(store, { difficulty: 'bogus', theme: 'neon', muted: 'yes' });
  assert.deepEqual(readSettings(store), { difficulty: 'chill', muted: false, theme: 'auto' }, 'junk ignored');
});

test('storage: unknown preset id in a write falls back to classic', () => {
  const store = fakeStorage();
  assert.equal(writeBest(store, 'nightmare', 55), 55);
  assert.equal(readBest(store, 'nightmare'), 55);
  assert.equal(readBest(store, 'classic'), 55);
});
