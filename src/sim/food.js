import { BOARD, cellKey } from './constants.js';
import { nextInt } from './rng.js';

/** Every cell not currently occupied by the snake, in row-major order (stable ⇒ testable). */
export function freeCells(snake, board = BOARD) {
  const taken = new Set(snake.map(cellKey));
  const cells = [];
  for (let y = 0; y < board.rows; y += 1) {
    for (let x = 0; x < board.cols; x += 1) {
      const key = `${x},${y}`;
      if (!taken.has(key)) cells.push({ x, y });
    }
  }
  return cells;
}

/**
 * Place the next apple uniformly among free cells.
 *
 * Returns `{ food, rngState, won }`. Choosing from the *free* list (rather than rejecting random
 * cells) means placement is O(free) and always terminates — a board full except one cell places
 * that cell instead of spinning. `won: true` means there was no room left at all.
 */
export function spawnFood(state) {
  const board = state.board ?? BOARD;
  const free = freeCells(state.snake, board);
  if (!free.length) return { food: state.food ?? null, rngState: state.rngState, won: true };
  const { state: rngState, value } = nextInt(state.rngState, free.length);
  return { food: free[value], rngState, won: false };
}
