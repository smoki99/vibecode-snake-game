/**
 * The glue layer: owns the state object, drives the loop, reacts to events.
 *
 * Deliberately DOM-free. Everything it touches (storage, audio, the renderer, the frame clock) is
 * injected, so a test can construct a whole game with fakes and assert on what happened, and
 * main.js stays a thin wiring file.
 */
import { createState, restartWith, isLive } from '../sim/state.js';
import { step, start, pause, resume, togglePause, turn } from '../sim/step.js';
import { presetFor } from '../sim/difficulty.js';
import { readBest, readScores, readSettings, writeBest, writeSettings } from '../sim/storage.js';
import { createLoop } from './loop.js';
import { THEMES } from '../sim/constants.js';

const noop = () => {};

/**
 * @param {object} deps
 * @param {StorageLike} deps.storage        localStorage-like, may be absent
 * @param {object} [deps.audio]             { eat, die, start, pause, tier, unmute }
 * @param {(alpha:number, state:object)=>void} deps.draw   renderer hook
 * @param {() => number} deps.now
 * @param {(cb)=>number} deps.requestFrame
 * @param {(id)=>void} deps.cancelFrame
 * @param {(event:string, state:object)=>void} [deps.onEvent]
 */
export function createGame(deps) {
  const {
    storage,
    audio = {},
    draw = noop,
    now = () => performance.now(),
    requestFrame = (cb) => requestAnimationFrame(cb),
    cancelFrame = (id) => cancelAnimationFrame(id),
    onEvent = noop,
    seed = String(Math.floor(Math.random() * 1e9)),
    difficulty,
    muted,
  } = deps;

  const settings = readSettings(storage);
  const initialPreset = presetFor(difficulty ?? settings.difficulty).id;
  const initialMuted = typeof muted === 'boolean' ? muted : settings.muted;

  let state = createState({
    seed,
    difficulty: initialPreset,
    best: readBest(storage, initialPreset),
  });
  let isMuted = initialMuted;
  let lastStatus = state.status;

  const play = (name) => {
    if (isMuted) return;
    audio[name]?.();
  };

  function emit(name) {
    onEvent(name, state);
  }

  function commit(next, fallbackEvent) {
    if (next === state) return;
    const previous = state;
    state = next;
    const event = state.lastEvent?.at === state.ticks ? state.lastEvent.type : fallbackEvent;
    if (event) reactTo(event, previous);
    hudRefresh();
  }

  function reactTo(event, previous) {
    switch (event) {
      case 'eat':
        play('eat');
        break;
      case 'die':
      case 'win':
        play('die');
        writeBest(storage, state.difficulty, state.score);
        break;
      case 'start':
        play('start');
        break;
      case 'pause':
        play('pause');
        break;
      case 'tier':
        play('tier');
        break;
      default:
        break;
    }
    emit(event);
  }

  let hudRefresh = noop;
  let lastTier = state.tier;

  const loop = createLoop({
    getStepMs: () => state.tickMs,
    now,
    requestFrame,
    cancelFrame,
    onTick() {
      const before = state;
      const next = step(before);
      state = next;
      if (next.tier !== lastTier) {
        lastTier = next.tier;
        reactTo('tier', before);
      }
      if (next.lastEvent && next.lastEvent.at === next.ticks) reactTo(next.lastEvent.type, before);
      if (next.status !== before.status || next.score !== before.score || next.eaten !== before.eaten) {
        hudRefresh();
      }
      if (!isLive(next) && loop.running) loop.stop();
    },
    onRender(alpha) {
      draw(alpha, state);
    },
  });

  const api = {
    get state() {
      return state;
    },
    get muted() {
      return isMuted;
    },
    get running() {
      return loop.running;
    },
    get settings() {
      return readSettings(storage);
    },
    scores() {
      return readScores(storage);
    },
    onHud(fn) {
      hudRefresh = fn;
      return api;
    },
    refresh() {
      hudRefresh();
      return api;
    },
    run() {
      if (state.status === 'over') api.restart();
      const next = start(state);
      if (next !== state) commit(next, 'start');
      if (isLive(state) && !loop.running) {
        loop.reset();
        loop.start();
      }
      hudRefresh();
      return api;
    },
    pause() {
      if (!loop.running) return api;
      const next = pause(state);
      if (next === state) return api;
      state = next;
      loop.stop();
      reactTo('pause', state);
      hudRefresh();
      draw(1, state);
      return api;
    },
    resume() {
      const next = resume(state);
      if (next === state) return api;
      state = next;
      loop.reset();
      loop.start();
      reactTo('resume', state);
      hudRefresh();
      return api;
    },
    togglePause() {
      if (state.status === 'idle') return api.run();
      if (state.status === 'over') return api.restart();
      return state.status === 'playing' ? api.pause() : api.resume();
    },
    restart(options = {}) {
      const seedNext = options.seed ?? state.seed;
      const presetId = presetFor(options.difficulty ?? state.difficulty).id;
      const previous = state;
      // R means "a new run", not "standby": the fresh state is started, not staged. Leaving it idle
      // while the loop was already running meant a frame of nothing and a snake that would not move.
      state = start(
        restartWith(state, { seed: seedNext, difficulty: presetId, best: readBest(storage, presetId) }),
      );
      lastTier = state.tier;
      loop.reset();
      loop.start();
      lastStatus = state.status;
      reactTo('start', previous);
      hudRefresh();
      return api;
    },
    steer(direction) {
      if (!isLive(state)) return api;
      const next = turn(state, direction);
      if (next !== state) {
        state = next;
        emit('steer');
      }
      return api;
    },
    setDifficulty(id) {
      const preset = presetFor(id);
      writeSettings(storage, { difficulty: preset.id });
      const best = readBest(storage, preset.id);
      state = restartWith(state, { seed: state.seed, difficulty: preset.id, best });
      loop.stop();
      lastTier = state.tier;
      lastStatus = state.status;
      hudRefresh();
      draw(1, state);
      emit('difficulty');
      return api;
    },
    setMuted(nextMuted) {
      isMuted = Boolean(nextMuted);
      writeSettings(storage, { muted: isMuted });
      if (!isMuted) audio.unmute?.();
      emit(isMuted ? 'mute' : 'unmute');
      return api;
    },
    toggleMute() {
      return api.setMuted(!isMuted);
    },
    /** Direct access for tests and for tab-visibility handling. */
    pump(elapsedMs) {
      loop.pump(elapsedMs);
      return api;
    },
    /**
     * Appearance is a setting, not a rule: the controller only persists it. The document attribute
     * and the canvas repaint are the caller's business (see src/main.js).
     */
    get theme() {
      return readSettings(storage).theme;
    },
    setTheme(theme) {
      const next = THEMES.includes(theme) ? theme : 'dark';
      writeSettings(storage, { theme: next });
      emit('theme');
      return api;
    },
    stop() {
      loop.stop();
      return api;
    },
    startLoop() {
      loop.reset();
      loop.start();
      return api;
    },
    draw() {
      draw(1, state);
      return api;
    },
  };

  return api;
}
