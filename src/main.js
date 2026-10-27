/**
 * Boot. The only file that knows the DOM exists by name: it looks elements up, wires the layers
 * together, and hands control to the game. Nothing here contains rules.
 */
import { ensureSprite } from './ui/icons.js';
import { createRenderer } from './render/canvas.js';
import { createGame } from './ui/controller.js';
import { createHud } from './ui/hud.js';
import { bindInput } from './ui/input.js';
import { createAudio } from './ui/audio.js';
import { THEMES } from './sim/constants.js';

const $ = (id) => document.getElementById(id);

function collectDom() {
  return {
    canvas: $('board'),
    boardFrame: document.querySelector('.board-frame'),
    overlay: $('overlay'),
    overlayKicker: $('overlay-kicker'),
    overlayTitle: $('overlay-title'),
    overlayBody: $('overlay-body'),
    overlayScore: $('overlay-score'),
    overlayBadge: $('overlay-badge'),
    overlayPrimary: $('overlay-primary'),
    overlaySecondary: $('overlay-secondary'),
    overlayHint: $('overlay-hint'),
    score: $('score'),
    best: $('best'),
    apples: $('apples'),
    speedFill: $('speed-fill'),
    speedTier: $('speed-tier'),
    speedMs: $('speed-ms'),
    runStatus: $('run-status'),
    ranksList: $('ranks-list'),
    seedNote: $('seed-note'),
    inputNote: $('input-note'),
    live: $('live'),
    soundBtn: $('sound-btn'),
    soundLabel: document.querySelector('#sound-btn .icon-btn-label'),
    pauseBtn: $('pause-btn'),
    pauseLabel: document.querySelector('#pause-btn .icon-btn-label'),
    restartBtn: $('restart-btn'),
    difficultyInputs: [...document.querySelectorAll('input[name="difficulty"]')],
    steerButtons: [...document.querySelectorAll('.dpad-btn[data-dir]')],
  };
}

/** localStorage throws on access in some privacy modes; the sim's storage layer handles the rest. */
function storageOf(scope) {
  try {
    const probe = '__snake_probe__';
    scope.setItem(probe, '1');
    scope.removeItem(probe);
    return scope;
  } catch {
    return null;
  }
}

function startParams() {
  const params = new URLSearchParams(location.search);
  return {
    seed: params.get('seed') ?? undefined,
    difficulty: params.get('difficulty') ?? undefined,
    muted: params.get('muted') === null ? undefined : params.get('muted') !== '0',
    autoplay: params.get('start') === '1',
    theme: params.get('theme') ?? undefined,
  };
}

async function boot() {
  const dom = collectDom();
  const params = startParams();
  await ensureSprite($('sprite'));

  const renderer = createRenderer({ canvas: dom.canvas });
  const hud = createHud({
    dom,
    announce: (message) => {
      if (dom.live) dom.live.textContent = message;
      if (dom.runStatus) dom.runStatus.textContent = message;
    },
  });

  const audio = createAudio();
  const game = createGame({
    storage: storageOf(window.localStorage),
    audio,
    draw: (alpha, state) => renderer.draw(state, alpha),
    seed: params.seed,
    difficulty: params.difficulty,
    muted: params.muted,
    onEvent: (name, state) => {
      // The HUD's SPOKEN table is the allowlist: steering is deliberately silent, scoring is not.
      hud.announceEvent(name, state);
      hud.render(state, game);
    },
  });

  game.onHud(() => hud.render(game.state, game));

  /**
   * Theme is presentation only: the controller persists the choice, this applies it to the document
   * and forces one repaint. The canvas reads the same custom properties the shell does, so a swap is
   * a single attribute write plus a redraw.
   */
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  const themeButton = $('theme-btn');
  const THEME_LABEL = {
    dark: 'Dark theme. Activate for light.',
    light: 'Light theme. Activate to follow the system.',
    auto: 'Following the system. Activate for dark.',
  };
  let urlTheme = params.theme ?? null;

  function currentTheme() {
    return urlTheme ?? game.theme;
  }

  function applyTheme(theme, { persist = true } = {}) {
    document.documentElement.dataset.theme = theme;
    if (metaTheme) metaTheme.setAttribute('content', theme === 'light' ? '#EDF3EE' : '#060B08');
    if (themeButton) {
      themeButton.setAttribute('aria-label', THEME_LABEL[theme]);
      themeButton.title = `Theme: ${theme} (T)`;
      themeButton.dataset.active = theme;
    }
    if (persist) game.setTheme(theme);
    renderer.invalidate();
    renderer.draw(game.state, 1);
    hud.render(game.state, game);
  }

  function cycleTheme() {
    urlTheme = null; // an explicit click outranks a URL override
    // Cycle from what is on screen, not from the stored setting: with ?theme= in the URL the two
    // differ, and starting from the stored value made the first click look like it did nothing.
    const applied = document.documentElement.dataset.theme ?? currentTheme();
    const index = THEMES.indexOf(applied);
    applyTheme(THEMES[(index + 1) % THEMES.length]);
  }

  applyTheme(currentTheme(), { persist: false });
  themeButton?.addEventListener('click', cycleTheme);

  // Inherit from the game object so `api.state` stays a live getter; spreading would freeze the
  // snapshot the input layer reads and every key would look like it was pressed while idle.
  const inputApi = Object.create(game, {
    resize: { value: () => renderer.resize(), enumerable: true },
    cycleTheme: { value: cycleTheme, enumerable: true },
  });

  bindInput({ api: inputApi, dom, onFirstGesture: () => audio.unmute() });

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => renderer.resize()).observe(dom.canvas.parentElement);
  }

  renderer.resize();
  game.refresh();
  hud.renderRanks(game.scores());
  game.draw();
  dom.inputNote.textContent =
    window.matchMedia?.('(hover: none) and (pointer: coarse)').matches
      ? 'Swipe the board or use the arrows below it.'
      : 'Arrow keys, WASD, or swipe. Space starts, P pauses, R restarts, M mutes.';

  if (params.autoplay) game.run();
  window.game = inputApi; // console handle for debugging and the browser tests
  document.body.dataset.ready = '1';
}

boot().catch((error) => {
  document.body.dataset.ready = 'error';
  const live = $('live');
  if (live) live.textContent = `The game failed to start: ${error.message}`;
  console.error(error);
});
