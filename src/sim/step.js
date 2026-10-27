import { DIRS, STATUS, inBoard } from './constants.js';
import { pushTurn, takeSteering } from './steering.js';
import { spawnFood } from './food.js';
import { scoreGain, tickMsFor, tierFor } from './difficulty.js';

/** Apples grow the snake by one segment per apple. */
const GROW_PER_FOOD = 1;

/** Previous position for segment `i`, used to interpolate between ticks. */
function prevFor(bodyLength, oldSnake) {
  const out = new Array(bodyLength);
  for (let i = 0; i < bodyLength; i += 1) {
    const src = oldSnake[Math.min(i, oldSnake.length - 1)];
    out[i] = { x: src.x, y: src.y };
  }
  return out;
}

/**
 * Would `head` hit the body?
 *
 * `tailVacates` is the classic forgiveness rule: moving into the cell the tail is about to leave
 * is legal, because by the time the head arrives that cell is empty. When the tail is *kept*
 * (growth owed, or this apple pays for itself) the tail cell stays occupied, so every segment
 * counts as a wall.
 */
export function hitsBody(head, snake, tailVacates) {
  const limit = snake.length - (tailVacates ? 1 : 0);
  for (let i = 0; i < limit; i += 1) {
    if (snake[i].x === head.x && snake[i].y === head.y) return true;
  }
  return false;
}

/**
 * Terminal transition. `reason` exists for the UI ("You met the wall" vs "You met yourself");
 * the rules themselves never read it.
 */
const finished = (state, status, type, reason) => ({
  ...state,
  status,
  best: Math.max(state.best, state.score),
  lastEvent: { type, at: state.ticks, reason },
});

/**
 * Advance the simulation by exactly one tick. Pure: same (state, input) ⇒ same result, no DOM,
 * no timers, no entropy. A finished or idle state steps to itself, so a stalled frame or a stray
 * tick can never corrupt a dead game.
 */
export function step(state, input = {}) {
  if (state.status !== STATUS.playing) return state;

  let pending = state.pending;
  for (const turnName of input.turns ?? []) pending = pushTurn(pending, turnName, state.dir);

  const { dir, pending: remaining } = takeSteering(pending, state.dir);
  const delta = DIRS[dir];
  const head = { x: state.snake[0].x + delta.x, y: state.snake[0].y + delta.y };

  if (!inBoard(head, state.board)) {
    return finished({ ...state, dir, pending: remaining }, STATUS.over, 'die', 'wall');
  }

  const eats = Boolean(state.food) && state.food.x === head.x && state.food.y === head.y;
  const owed = state.grows + (eats ? GROW_PER_FOOD : 0);
  const tailVacates = owed === 0;

  if (hitsBody(head, state.snake, tailVacates)) {
    return finished({ ...state, dir, pending: remaining }, STATUS.over, 'die', 'self');
  }

  const body = [head, ...state.snake];
  // owed > 0: the tail is kept this tick (this apple pays for itself, or an earlier one still
  //          owes growth) — length grows by one.
  // owed = 0: the tail lifts, so length stays constant.
  if (owed === 0) body.pop();
  const grew = owed > 0;

  const next = {
    ...state,
    dir,
    pending: remaining,
    snake: body,
    prev: prevFor(body.length, state.snake),
    grows: grew ? owed - 1 : 0,
    ticks: state.ticks + 1,
  };

  if (!eats) return { ...next, lastEvent: null };

  const score = state.score + scoreGain(state.preset, state.eaten);
  const eaten = state.eaten + 1;
  const withFood = spawnFood({ ...next, snake: body, score, eaten });

  if (withFood.won) {
    return finished(
      { ...next, food: null, score, eaten, tickMs: tickMsFor(state.preset, eaten), tier: tierFor(state.preset, eaten) },
      STATUS.won,
      'win',
      'board-full',
    );
  }

  return {
    ...next,
    food: withFood.food,
    rngState: withFood.rngState,
    score,
    eaten,
    tickMs: tickMsFor(state.preset, eaten),
    tier: tierFor(state.preset, eaten),
    lastEvent: { type: 'eat', at: next.ticks, cell: { ...head } },
  };
}

/* ------------------------------------------------------------------ intents */

export const start = (state) =>
  state.status === STATUS.idle
    ? { ...state, status: STATUS.playing, lastEvent: { type: 'start', at: state.ticks } }
    : state;

export const pause = (state) =>
  state.status === STATUS.playing
    ? { ...state, status: STATUS.paused, lastEvent: { type: 'pause', at: state.ticks } }
    : state;

export const resume = (state) =>
  state.status === STATUS.paused
    ? { ...state, status: STATUS.playing, lastEvent: { type: 'resume', at: state.ticks } }
    : state;

/** Queue a steering key. Legal/reversal decisions live in steering.js. */
export const turn = (state, dirName) =>
  state.status === STATUS.playing
    ? { ...state, pending: pushTurn(state.pending, dirName, state.dir) }
    : state;

/** Toggle used by the Space/Escape key: pauses a running game, resumes a paused one. */
export function togglePause(state) {
  if (state.status === STATUS.playing) return pause(state);
  if (state.status === STATUS.paused) return resume(state);
  return state;
}
