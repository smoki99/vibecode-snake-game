import { BOARD, START_DIR, STATUS } from './constants.js';
import { seedFrom } from './rng.js';
import { presetFor, tickMsFor, tierFor } from './difficulty.js';
import { spawnFood } from './food.js';

/** Head at the centre pointing right, body trailing behind it. */
export function startingSnake(board = BOARD) {
  const y = Math.floor(board.rows / 2);
  const x = Math.floor(board.cols / 2);
  return [
    { x, y },
    { x: x - 1, y },
    { x: x - 2, y },
  ];
}

/**
 * The state snapshot. Frozen-by-convention: every mutation in the sim returns a new object,
 * which is what lets tests deep-compare and the renderer stay a pure reader.
 *
 * shape (contract shared with render/ and ui/ — see tasks/plan.md AD-4):
 *   board      {cols, rows}
 *   snake      [{x,y}] head first
 *   prev       [{x,y}] previous position per segment index, for render interpolation
 *   dir        'up'|'down'|'left'|'right' heading applied on the last tick
 *   pending    string[] queued turns (max 2)
 *   grows      number of tail-retains still owed to eaten apples
 *   food       {x,y}
 *   score, eaten, ticks, tickMs, tier
 *   preset     frozen difficulty preset
 *   best       best score for this preset
 *   status     'idle'|'playing'|'paused'|'over'|'won'
 *   lastEvent  {type:'eat'|'die'|'win'|'start'|'pause'|'resume'|'score', at, cell?} | null
 *   seed, rngState
 */
export function createState(options = {}) {
  const { seed = 'classic', difficulty = 'classic', best = 0, status = STATUS.idle, board = BOARD } = options;
  const preset = presetFor(difficulty);
  const snake = startingSnake(board);

  const base = {
    board,
    preset,
    difficulty: preset.id,
    seed: String(seed),
    rngState: seedFrom(seed),
    snake,
    prev: snake.map((p) => ({ ...p })),
    dir: START_DIR,
    pending: [],
    grows: 0,
    food: null,
    score: 0,
    eaten: 0,
    ticks: 0,
    tickMs: tickMsFor(preset, 0),
    tier: tierFor(preset, 0),
    best: Math.max(0, Number.isFinite(Number(best)) ? Math.trunc(Number(best)) : 0),
    status,
    lastEvent: null,
  };

  const placed = spawnFood(base);
  return {
    ...base,
    food: placed.food,
    rngState: placed.rngState,
    status: placed.won ? STATUS.won : status,
  };
}

/** Fresh run reusing the seed and preset so a replay is comparable. */
export function restartWith(state, overrides = {}) {
  return createState({
    seed: state.seed,
    difficulty: state.difficulty,
    best: state.best,
    board: state.board,
    ...overrides,
  });
}

export const isLive = (state) => state.status === STATUS.playing;
export const isFinished = (state) => state.status === STATUS.over || state.status === STATUS.won;
