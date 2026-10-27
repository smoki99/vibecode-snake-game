/**
 * Input. Keyboard, d-pad buttons, and swipe on the canvas, all funnelled into the same four
 * intents the game understands. Keys are ignored while typing in a field, and the browser's own
 * scrolling is only prevented for keys the game actually consumed.
 */
import { PRESET_IDS } from '../sim/difficulty.js';

const KEY_DIRS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  W: 'up',
  S: 'down',
  A: 'left',
  D: 'right',
  k: 'up',
  j: 'down',
  h: 'left',
  l: 'right',
};

const TEXT_ENTRY = ['text', 'search', 'email', 'number', 'password', 'url', 'tel', 'date', 'time'];

/**
 * Keys are only swallowed for the game when the user is not typing. A focused radio (the difficulty
 * pills) must not disable steering — the pill is a control of the game, not a text field.
 */
const isTypingTarget = (target) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === 'TEXTAREA' ||
    (target.tagName === 'INPUT' && TEXT_ENTRY.includes((target.type ?? 'text').toLowerCase())));

export function bindInput({ api, dom, onFirstGesture }) {
  let gestured = false;
  const fireGesture = () => {
    if (gestured) return;
    gestured = true;
    onFirstGesture?.();
  };

  function handleKey(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    const dir = KEY_DIRS[event.key];
    if (dir) {
      fireGesture();
      if (api.state.status === 'idle') api.run();
      api.steer(dir);
      event.preventDefault();
      return;
    }
    switch (event.key) {
      case ' ':
      case 'Spacebar':
        fireGesture();
        if (api.state.status === 'idle' || api.state.status === 'over') api.run();
        else api.togglePause();
        event.preventDefault();
        break;
      case 'p':
      case 'P':
      case 'Escape':
        fireGesture();
        api.togglePause();
        event.preventDefault();
        break;
      case 'r':
      case 'R':
        fireGesture();
        api.restart();
        event.preventDefault();
        break;
      case 'm':
      case 'M':
        fireGesture();
        api.toggleMute();
        break;
      case 't':
      case 'T':
        fireGesture();
        api.cycleTheme?.();
        break;
      case '1':
      case '2':
      case '3': {
        // Difficulty shortcuts, in preset order — the only way to pick one from a file:// page.
        fireGesture();
        const presetId = PRESET_IDS[Number(event.key) - 1];
        if (presetId) api.setDifficulty?.(presetId);
        event.preventDefault();
        break;
      }
      default:
        break;
    }
  }

  function bindSteerButtons() {
    const buttons = dom.steerButtons ?? [];
    buttons.forEach((button) => {
      const dir = button.dataset.dir;
      const press = (event) => {
        event.preventDefault();
        fireGesture();
        api.steer(dir);
        if (api.state.status === 'idle') api.run();
      };
      button.addEventListener('pointerdown', press);
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    });
  }

  function bindSwipe() {
    // The frame, not only the canvas: while an overlay is up it covers the board, and a tap on the
    // dark area around the card should still start or pause the run.
    const surface = dom.boardFrame ?? dom.canvas;
    if (!surface) return;
    let start = null;
    const THRESHOLD = 22;
    const isControl = (target) =>
      target instanceof Element && Boolean(target.closest('button, a, input, label, select'));
    surface.addEventListener(
      'pointerdown',
      (event) => {
        if (isControl(event.target)) {
          start = null;
          return;
        }
        start = { x: event.clientX, y: event.clientY, id: event.pointerId };
        fireGesture();
      },
      { passive: true },
    );
    surface.addEventListener(
      'pointerup',
      (event) => {
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        start = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < THRESHOLD) {
          if (api.state.status === 'idle' || api.state.status === 'over') api.run();
          else api.togglePause();
          return;
        }
        const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
        api.steer(dir);
      },
      { passive: true },
    );
    surface.addEventListener('pointercancel', () => {
      start = null;
    });
  }

  function bindButtons() {
    dom.startButton?.addEventListener('click', () => {
      fireGesture();
      api.run();
    });
    dom.pauseBtn?.addEventListener('click', () => {
      fireGesture();
      api.togglePause();
    });
    dom.restartBtn?.addEventListener('click', () => {
      fireGesture();
      api.restart();
    });
    dom.soundBtn?.addEventListener('click', () => {
      fireGesture();
      api.toggleMute();
    });
    dom.overlayPrimary?.addEventListener('click', () => {
      fireGesture();
      const action = dom.overlayPrimary.dataset.action;
      if (action === 'resume') api.resume();
      else if (action === 'restart') api.restart();
      else api.run();
    });
    dom.overlaySecondary?.addEventListener('click', () => {
      if (dom.overlaySecondary.dataset.action === 'restart') api.restart();
      else if (api.state.status === 'paused') api.resume();
    });
    (dom.difficultyInputs ?? []).forEach((input) => {
      input.addEventListener('change', () => {
        fireGesture();
        api.setDifficulty(input.value);
      });
    });
  }

  window.addEventListener('keydown', handleKey);
  bindButtons();
  bindSteerButtons();
  bindSwipe();

  const onVisibility = () => {
    if (document.hidden && api.state.status === 'playing') api.pause();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const onResize = () => api.resize?.();
  window.addEventListener('resize', onResize);

  return () => {
    window.removeEventListener('keydown', handleKey);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
