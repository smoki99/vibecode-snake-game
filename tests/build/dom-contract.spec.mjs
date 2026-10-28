/**
 * The browser specs name DOM ids, classes, attributes and state keys by hand. Nothing used to check
 * those names existed, and that is exactly how the suite went quietly wrong: specs reached for
 * `#score-value` and `state.snakeLength`, neither of which the page ever had, so Playwright waited
 * on a phantom element or compared `undefined === undefined` and reported success. Ten failures and
 * four vacuous passes later (tasks/todo.md, Phase 7), the lesson is that a name in a spec is an
 * unverifiable claim unless something checks it.
 *
 * This is that check. It runs statically — no browser, milliseconds — so it fails inside `npm test`
 * long before Playwright would notice, and it fails naming the line that drifted instead of timing
 * out forty seconds later.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { createState } from '../../src/sim/state.js';
import { ICON_NAMES } from '../../src/ui/icons.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Comments are where specs *talk about* selectors ("replaced the invented #score-value"), so a
 * checker that scanned them would fail on prose. Strip comments but keep every newline, so an offset
 * into the stripped text still maps to the right line in the file on disk.
 */
function codeOnly(source) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += source[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n'; // keep the line count honest
        i += 1;
      }
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** `file:line` for an offset in comment-stripped source. */
const at = (file, code, offset) => `${file}:${code.slice(0, offset).split('\n').length}`;

const SPEC_FILES = [
  ...readdirSync(join(ROOT, 'tests/browser')).filter((n) => n.endsWith('.spec.mjs')).map((n) => `tests/browser/${n}`),
  'tests/helpers/browser.mjs',
].sort();

/** A quoted literal, per quote style: `'[data-x="1"]'` is a real selector and must survive. */
const QUOTED = /(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`)/;
const lit = (re) => new RegExp(re.source.replaceAll('LIT', () => QUOTED.source), 'g');
const arg = (m, base) => m[base] ?? m[base + 1] ?? m[base + 2];

/** Calls whose first argument is a selector. Everything else in a spec is free-form text. */
const SELECTOR_CALLS = lit(
  /\.(locator|waitForSelector|isVisible|isEnabled|isDisabled|click|hover|tap|dblclick|focus|textContent|innerText|innerHTML|inputValue|querySelector|querySelectorAll|closest|matches)\(\s*LIT/,
);

/**
 * `locator.getAttribute('href')` takes an attribute; `page.getAttribute('#board', 'data-ready')`
 * takes a selector *then* an attribute. Both appear in the specs, so both shapes are read.
 */
const ATTR_CALLS = lit(/\.(getAttribute|hasAttribute)\(\s*LIT(\s*,\s*LIT)?/);

/** Reads of the live sim object: `game.state.foo` / `window.game.state.foo`. */
const STATE_READS = /(?:window\.)?game\.state\.([a-z][a-zA-Z]*)/g;

const JS_FILES = (() => {
  const files = ['src/main.js'];
  for (const dir of ['src/ui', 'src/render', 'src/sim']) {
    for (const name of readdirSync(join(ROOT, dir))) if (name.endsWith('.js')) files.push(`${dir}/${name}`);
  }
  return files;
})();

/**
 * Everything the page can actually be addressed by. The runtime half is derived from source rather
 * than hand-written, so it cannot rot: `dataset.ready` in main.js really does create `data-ready`,
 * and the generated sprite really does carry one `icon-<name>` id per entry in ICON_NAMES.
 */
function universe() {
  const html = read('index.html');
  const ids = new Set([...html.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
  for (const name of ICON_NAMES) ids.add(`icon-${name}`);

  const classes = new Set(
    [...html.matchAll(/\bclass="([^"]*)"/g)].flatMap((m) => m[1].trim().split(/\s+/)).filter(Boolean),
  );
  const attrs = new Set(
    [...html.matchAll(/\b([a-z-]+(?:-[a-z-]+)?)=/g)].map((m) => m[1]).filter((n) => /^(data-|aria-)/.test(n) || ['role', 'href', 'id', 'class', 'value', 'type'].includes(n)),
  );
  for (const file of JS_FILES) {
    const code = codeOnly(read(file));
    for (const m of code.matchAll(/\bclass="([A-Za-z0-9_ -]+)"/g)) {
      for (const cls of m[1].trim().split(/\s+/)) classes.add(cls);
    }
    for (const m of code.matchAll(/dataset\.([a-zA-Z]+)/g)) {
      attrs.add(`data-${m[1].replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
    }
    for (const m of code.matchAll(/setAttribute\(\s*['"]([a-z][a-z0-9-]*)['"]/g)) attrs.add(m[1]);
  }
  return { ids, classes, attrs };
}

/**
 * Every selector and live-state key the specs claim, each checked against what the page provides.
 * Pass a source map to point it at something else — the mutation probe below uses that.
 */
function collect(sources = Object.fromEntries(SPEC_FILES.map((f) => [f, read(f)]))) {
  const world = universe();
  const stateKeys = new Set(Object.keys(createState()));
  const problems = [];
  const claims = { ids: new Set(), classes: new Set(), attrs: new Set(), stateKeys: new Set() };

  const checkAttr = (file, code, offset, name) => {
    claims.attrs.add(name);
    if (!world.attrs.has(name)) problems.push(`${at(file, code, offset)} uses [${name}], which neither index.html nor src ever sets`);
  };

  for (const [file, raw] of Object.entries(sources)) {
    const code = codeOnly(raw);

    for (const m of code.matchAll(SELECTOR_CALLS)) {
      const selector = arg(m, 2);
      // A selector assembled from a template literal cannot be resolved statically; skip it rather
      // than guess at the interpolated half.
      if (selector.includes('${')) continue;
      const where = at(file, code, m.index);
      for (const id of selector.matchAll(/(?:^|[^\w-])#([a-z][a-z0-9-]*)/g)) {
        claims.ids.add(id[1]);
        if (!world.ids.has(id[1])) problems.push(`${where} selects #${id[1]}, which no markup or icon sprite defines`);
      }
      for (const cls of selector.matchAll(/(?:^|[\s>+~.])\.([a-z][a-z0-9-]*)/g)) {
        claims.classes.add(cls[1]);
        if (!world.classes.has(cls[1])) problems.push(`${where} selects .${cls[1]}, which no markup or runtime class list contains`);
      }
      for (const attr of selector.matchAll(/\[\s*([a-z][a-z0-9-]*)/g)) checkAttr(file, code, m.index, attr[1]);
    }

    for (const m of code.matchAll(ATTR_CALLS)) {
      const first = arg(m, 2);
      // Group 5 wraps the optional `, <literal>`; the second literal itself is one of 6-8.
      const second = m[5] === undefined ? undefined : arg(m, 6);
      if (second === undefined) {
        checkAttr(file, code, m.index, first); // locator.getAttribute('href')
        continue;
      }
      checkAttr(file, code, m.index, second); // page.getAttribute('#board', 'data-ready')
      for (const id of first.matchAll(/(?:^|[^\w-])#([a-z][a-z0-9-]*)/g)) {
        claims.ids.add(id[1]);
        if (!world.ids.has(id[1])) problems.push(`${at(file, code, m.index)} reads ${id[1]}'s attributes, but #${id[1]} does not exist`);
      }
    }

    for (const m of code.matchAll(STATE_READS)) {
      claims.stateKeys.add(m[1]);
      if (!stateKeys.has(m[1])) {
        problems.push(
          `${at(file, code, m.index)} reads game.state.${m[1]}, which the sim state does not have ` +
            `(it has: ${[...stateKeys].sort().join(', ')})`,
        );
      }
    }
  }
  return { problems, claims, world, stateKeys };
}

test('contract: every selector and live-state key the browser specs name actually exists', () => {
  const { problems, claims } = collect();
  assert.deepEqual(
    problems,
    [],
    `\n${problems.join('\n')}\n\nA spec may only name what the page provides. If the thing was renamed or ` +
      `removed, fix the spec; if you added it, it belongs in index.html or the icon list.`,
  );
  // A checker that matched nothing would pass for the wrong reason, and so would a suite that had
  // quietly stopped touching the page. These floors sit below today's real counts (11 ids, 2 classes,
  // 11 attributes, 11 state keys) on purpose: consolidating a selector is fine, evaporating coverage
  // is not.
  const floor = (name, size, min) => assert.ok(size >= min, `only ${size} distinct ${name} referenced (floor ${min})`);
  floor('ids', claims.ids.size, 8);
  floor('classes', claims.classes.size, 2);
  floor('attributes', claims.attrs.size, 8);
  floor('state keys', claims.stateKeys.size, 8);
});

test('contract: specs read state through readState rather than hand-rolling it', () => {
  // `snakeLength` was invented in a spec that read the live state directly. Reading it is legitimate
  // inside page.evaluate — the helper cannot run in-page — so it is allowed, but only at the sites
  // below. The counts are a ratchet: they may fall, and rising one is a visible decision in a diff.
  const CAPS = {
    'tests/browser/gameplay.spec.mjs': 28, // scripted manoeuvres inside page.evaluate
    'tests/browser/standalone.spec.mjs': 6, // the file:// bundle pumps the sim by hand in one evaluate
    'tests/browser/app.spec.mjs': 0, // every read here goes through the helper or the DOM
  };
  const offenders = [];
  for (const [file, cap] of Object.entries(CAPS)) {
    const count = [...codeOnly(read(file)).matchAll(STATE_READS)].length;
    if (count > cap) offenders.push(`${file}: ${count} direct game.state reads (capped at ${cap})`);
  }
  assert.deepEqual(
    offenders,
    [],
    `\n${offenders.join('\n')}\n\nPrefer readState(page): it is the one place the state shape is translated, ` +
      `so a rename is fixed once. If a new in-page site is genuinely needed, raise the cap with a reason.`,
  );
});

test('contract: a spec that uses a helper also imports it', () => {
  // The suite runs one file per process, so calling a helper nobody imported is a ReferenceError at
  // the first call — which reads as "the game is broken" and sends you debugging the game. Caught
  // exactly that: standalone.spec.mjs called readState without importing it.
  const helper = codeOnly(read('tests/helpers/browser.mjs'));
  const exported = new Set(
    [...helper.matchAll(/export (?:async )?(?:function|const) ([a-zA-Z][a-zA-Z0-9_]*)/g)].map((m) => m[1]),
  );
  const offenders = [];
  for (const file of SPEC_FILES) {
    if (file === 'tests/helpers/browser.mjs') continue;
    const code = codeOnly(read(file));
    const imported = new Set(
      [...code.matchAll(/import[^;]*?from\s+['"][^'"]*helpers\/browser\.mjs['"]/gs)]
        .flatMap((m) => [...m[0].matchAll(/([a-zA-Z][a-zA-Z0-9_]*)/g)].map((x) => x[1]))
        .filter((name) => exported.has(name)),
    );
    for (const name of exported) {
      // Match a bare call only. `page.keyboard.press(...)` reads as `press(` to a naive pattern and
      // would blame every spec that ever pressed a key.
      const used = new RegExp(`(^|[^.\\w$])${name}\\s*\\(`).test(code);
      if (used && !imported.has(name)) offenders.push(`${file}: calls ${name}() without importing it`);
    }
  }
  assert.deepEqual(offenders, [], `\n${offenders.join('\n')}\n\nImport it from ../helpers/browser.mjs.`);
});

test('contract: readState returns only keys the sim can back', () => {
  const helper = codeOnly(read('tests/helpers/browser.mjs'));
  const body = helper.slice(helper.indexOf('readState'), helper.indexOf('pumpTick'));
  const stateKeys = new Set(Object.keys(createState()));
  const invented = [...new Set([...body.matchAll(/state\.([a-zA-Z]+)/g)].map((m) => m[1]))].filter((k) => !stateKeys.has(k));
  assert.deepEqual(invented, [], `readState reads keys the sim does not have: ${invented.join(', ')}`);
});

test('contract: the guard actually catches a drifted name (mutation check)', () => {
  // A guard that cannot fail is decoration (same reasoning as tests/unit/layering.spec.mjs). Inject
  // the exact mistakes this suite was written for and prove each is reported — and that a name that
  // really exists is left alone.
  const polluted = {
    'tests/browser/gameplay.spec.mjs': `
      const el = page.locator('#score-value');
      const pad = page.locator('.no-such-block');
      const shown = page.isVisible('[data-nope="1"]');
      const ready = await page.getAttribute('body', 'data-nope-either');
      const href = await page.locator('#board use').getAttribute('href');
      const len = await page.evaluate(() => game.state.snakeLength);
      const ok = page.locator('#board');
      return [el, pad, shown, ready, href, len, ok];
    `,
  };
  const { problems } = collect(polluted);
  const joined = problems.join('\n');
  assert.match(joined, /#score-value/, 'an invented id must be reported');
  assert.match(joined, /\.no-such-block/, 'an invented class must be reported');
  assert.match(joined, /data-nope\b/, 'an invented attribute selector must be reported');
  assert.match(joined, /data-nope-either/, 'an invented getAttribute must be reported');
  assert.match(joined, /game\.state\.snakeLength/, 'an invented state key must be reported');
  assert.ok(!/#board\b/.test(joined), `a real id must not be reported:\n${joined}`);
  assert.ok(!/\bhref\b/.test(joined), `a real attribute must not be reported:\n${joined}`);
  // Line numbers must still point at the offending line, or the failure is useless.
  assert.match(joined, /gameplay\.spec\.mjs:2 .*#score-value/, 'the report must name the line');
  assert.match(joined, /gameplay\.spec\.mjs:5 .*data-nope-either/, 'the report must name the line');
  assert.match(joined, /gameplay\.spec\.mjs:7 .*snakeLength/, 'the report must name the line');
});
