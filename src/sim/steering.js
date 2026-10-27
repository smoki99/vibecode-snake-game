import { DIRS, MAX_QUEUED_TURNS } from './constants.js';

/** Two headings that point at each other (pressing one from the other is a self-kill). */
export function isOpposite(a, b) {
  const d1 = DIRS[a];
  const d2 = DIRS[b];
  if (!d1 || !d2) return false;
  return d1.x === -d2.x && d1.y === -d2.y;
}

/**
 * Queue a turn.
 *
 * The queue is validated as a chain: a turn is rejected if it repeats the turn it would follow
 * (or the current heading when the queue is empty) or if it reverses that same heading. This is
 * what makes the classic "pressed up then left inside one tick and died" bug impossible — the
 * second key is checked against the *queued* heading, not the heading of the last completed tick.
 */
export function pushTurn(pending, dirName, currentDir) {
  if (!DIRS[dirName]) return pending;
  const chain = pending.length ? pending[pending.length - 1] : currentDir;
  if (dirName === chain) return pending;
  if (isOpposite(dirName, chain)) return pending;
  const nextQueue = pending.concat(dirName);
  if (nextQueue.length > MAX_QUEUED_TURNS) nextQueue.shift(); // overflow drops the oldest key
  return nextQueue;
}

/**
 * Consume one turn for this tick. Returns the heading to travel and the remaining queue.
 * `isOpposite` is re-checked here as a safety net so a hand-built state can never reverse.
 */
export function takeSteering(pending, currentDir) {
  if (!pending.length) return { dir: currentDir, pending };
  const [head, ...rest] = pending;
  const dir = isOpposite(head, currentDir) ? currentDir : head;
  return { dir, pending: rest };
}
