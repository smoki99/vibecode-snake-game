/**
 * Game constants — the single source of truth for board geometry, directions and scoring.
 * Pure data: importing this module has no side effects and must never touch the DOM.
 */

export const BOARD = Object.freeze({ cols: 24, rows: 18 });

export const DIRS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 }),
});

/** Legal starting heading: snake points right, away from its own body. */
export const START_DIR = 'right';

/** Points awarded per food, multiplied by the current speed tier. */
export const POINTS_PER_FOOD = 10;

/** Max queued turns. Two is enough to chain a corner without buffering mistakes. */
export const MAX_QUEUED_TURNS = 2;

/** Hard cap on simulation ticks run per animation frame (anti spiral-of-death). */
export const MAX_CATCHUP_TICKS = 5;

export const STORAGE_KEYS = Object.freeze({
  best: 'snake.best.v1',
  settings: 'snake.settings.v1',
});

/** Appearance options, in cycle order for the toggle button. */
export const THEMES = Object.freeze(['dark', 'light', 'auto']);

export const STATUS = Object.freeze({
  idle: 'idle',
  playing: 'playing',
  paused: 'paused',
  over: 'over',
  won: 'won',
});

export const inBoard = (cell, board = BOARD) =>
  cell.x >= 0 && cell.y >= 0 && cell.x < board.cols && cell.y < board.rows;

export const cellKey = (cell) => `${cell.x},${cell.y}`;
