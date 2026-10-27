import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The layering guard.
 *
 * `src/sim/` is the part of the game that is provable without a browser. That guarantee is worth
 * more than a convention, so it is asserted here: no DOM, no timers, no entropy, and no imports
 * from outside the sim. A future edit that reaches `window` from a rules function fails this test
 * and names the file and line.
 */

const SIM_DIR = new URL('../../src/sim/', import.meta.url).pathname;

const FORBIDDEN = [
  { pattern: /\bdocument\b/, why: 'the sim must not touch the DOM' },
  { pattern: /\bwindow\b/, why: 'the sim must not touch globals' },
  { pattern: /\blocalStorage\b/, why: 'storage is injected from src/main.js' },
  { pattern: /\bMath\.random\b/, why: 'entropy belongs outside the sim; use the seeded rng' },
  { pattern: /\bsetTimeout\b/, why: 'the sim has no clock; the loop drives it' },
  { pattern: /\brequestAnimationFrame\b/, why: 'frames belong to ui/loop.js' },
  { pattern: /\bfetch\s*\(/, why: 'the sim performs no I/O' },
];

/** Strip comments so prose that *mentions* localStorage does not fail the guard. */
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function simFiles() {
  return readdirSync(SIM_DIR)
    .filter((name) => name.endsWith('.js'))
    .sort();
}

test('layering: src/sim exists and is populated', () => {
  assert.ok(simFiles().length >= 6, `expected the sim modules, found ${simFiles().join(', ')}`);
});

test('layering: the sim reaches no browser API', () => {
  const violations = [];
  for (const file of simFiles()) {
    const lines = codeOnly(readFileSync(join(SIM_DIR, file), 'utf8')).split('\n');
    lines.forEach((line, index) => {
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(line)) violations.push(`${file}:${index + 1}: ${why}\n    ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(violations, [], `\n${violations.join('\n')}`);
});

test('layering: the sim imports nothing from outside itself', () => {
  const violations = [];
  for (const file of simFiles()) {
    const source = codeOnly(readFileSync(join(SIM_DIR, file), 'utf8'));
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const specifier of imports) {
      if (!specifier.startsWith('./')) violations.push(`${file}: imports "${specifier}"`);
      if (!specifier.endsWith('.js')) violations.push(`${file}: import "${specifier}" needs an explicit .js`);
    }
  }
  assert.deepEqual(violations, [], `\n${violations.join('\n')}`);
});

test('layering: render/ and ui/ never reach into each other', () => {
  const root = new URL('../../src/', import.meta.url).pathname;
  const violations = [];
  for (const dir of ['render', 'ui']) {
    const other = dir === 'render' ? 'ui' : 'render';
    for (const file of readdirSync(join(root, dir)).filter((n) => n.endsWith('.js'))) {
      const source = codeOnly(readFileSync(join(root, dir, file), 'utf8'));
      if (source.includes(`../${other}/`)) violations.push(`${dir}/${file} imports from ${other}/`);
    }
  }
  assert.deepEqual(violations, [], `\n${violations.join('\n')}`);
});

test('layering: the guard actually catches a violation (mutation check)', () => {
  // A guard that cannot fail is decoration. Inject a violation in memory and re-run the scan.
  const polluted = codeOnly('export const peek = () => document.querySelector("#board");').split('\n');
  const hit = polluted.some((line) => FORBIDDEN.some(({ pattern }) => pattern.test(line)));
  assert.equal(hit, true, 'the forbidden-API scan must flag a DOM reference');
});
