/**
 * Canvas renderer.
 *
 * Reads a state snapshot plus an interpolation factor (0..1 between the last tick and the next)
 * and paints one frame. It never mutates state, never reads the clock, and caches the static board
 * background in an offscreen canvas so a frame costs a handful of fills.
 */
import { color } from './palette.js';

/**
 * The tokens the renderer paints with, in the order they are read.
 *
 * Values come from the CSS custom properties on the document, so a theme change repaints the board
 * for free and the canvas can never disagree with the shell's colours. palette.js supplies the
 * fallback used when a property is missing (and is what tests compare the stylesheet against).
 */
export const CANVAS_TOKENS = Object.freeze({
  ink1: 'ink-1',
  cell: 'cell-line',
  line: 'line',
  snake1: 'snake-1',
  snake2: 'snake-2',
  snake3: 'snake-3',
  eye: 'snake-eye',
  apple: 'apple',
  appleDeep: 'apple-deep',
  appleLeaf: 'apple-leaf',
  glow: 'grid-glow',
  danger: 'danger',
  dangerGlow: 'danger-glow',
});

const radiusFor = (size) => Math.max(2, Math.min(10, size * 0.28));

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

const lerp = (a, b, t) => a + (b - a) * t;

export function createRenderer({ canvas, palette } = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const backdrop = document.createElement('canvas');
  const backdropCtx = backdrop.getContext('2d');
  let cacheKey = '';
  let themeKey = '';
  let cachedTokens = null;
  let metrics = { w: 0, h: 0, cell: 0, dpr: 1, pad: 0 };

  function paletteOf(styles) {
    const out = {};
    for (const [key, token] of Object.entries(CANVAS_TOKENS)) {
      const declared = styles ? String(styles.getPropertyValue(`--${token}`) ?? '').trim() : '';
      out[key] = declared || color(token);
    }
    return out;
  }

  /**
   * Resolve the palette once per theme. getComputedStyle is not free, so it runs on the frame after
   * the theme attribute changes, never on every frame.
   */
  function tokensOf() {
    const root = document.documentElement;
    const key = `${root.dataset.theme ?? 'auto'}:${root.dataset.paletteVersion ?? '0'}`;
    if (key !== themeKey) {
      themeKey = key;
      cachedTokens = paletteOf(getComputedStyle(root));
      cacheKey = ''; // the backdrop is painted with these colours, so it must be rebuilt
    }
    return cachedTokens;
  }

  /** Match the backing store to the CSS box and the device pixel ratio. */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cssW = Math.max(1, Math.round(rect.width || canvas.width));
    const cssH = Math.max(1, Math.round(rect.height || cssW * 0.75));
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    metrics = { w, h, dpr, cssW, cssH };
    cacheKey = '';
  }

  function paintBackdrop(board, tokens) {
    const { w, h } = metrics;
    const pad = Math.round(Math.min(w, h) * 0.02);
    const cell = Math.min((w - pad * 2) / board.cols, (h - pad * 2) / board.rows);
    const originX = (w - cell * board.cols) / 2;
    const originY = (h - cell * board.rows) / 2;
    metrics = { ...metrics, cell, pad, originX, originY };

    const key = `${w}x${h}x${board.cols}x${board.rows}`;
    if (key === cacheKey) return;
    cacheKey = key;
    backdrop.width = w;
    backdrop.height = h;

    backdropCtx.setTransform(1, 0, 0, 1, 0, 0);
    backdropCtx.fillStyle = tokens.ink1;
    backdropCtx.fillRect(0, 0, w, h);

    const inset = Math.max(1, cell * 0.045);
    backdropCtx.fillStyle = tokens.cell;
    for (let row = 0; row < board.rows; row += 1) {
      for (let col = 0; col < board.cols; col += 1) {
        roundRect(
          backdropCtx,
          originX + col * cell + inset,
          originY + row * cell + inset,
          cell - inset * 2,
          cell - inset * 2,
          radiusFor(cell) * 0.8,
        );
        backdropCtx.fill();
      }
    }

    const glow = backdropCtx.createRadialGradient(w * 0.5, h * 0.42, cell, w * 0.5, h * 0.42, w * 0.6);
    glow.addColorStop(0, tokens.glow);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    backdropCtx.fillStyle = glow;
    backdropCtx.fillRect(0, 0, w, h);

    backdropCtx.strokeStyle = tokens.line;
    backdropCtx.lineWidth = Math.max(1, metrics.dpr);
    roundRect(backdropCtx, pad * 0.5, pad * 0.5, w - pad, h - pad, Math.min(w, h) * 0.03);
    backdropCtx.stroke();
  }

  function drawFood(food, tokens, phase) {
    if (!food) return;
    const { cell, originX, originY } = metrics;
    const cx = originX + (food.x + 0.5) * cell;
    const cy = originY + (food.y + 0.5) * cell;
    const pulse = 1 + Math.sin(phase * Math.PI * 2) * 0.05;
    const r = cell * 0.31 * pulse;

    const halo = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 2.6);
    halo.addColorStop(0, 'rgba(255,107,87,0.30)');
    halo.addColorStop(1, 'rgba(255,107,87,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.6, 0, Math.PI * 2);
    ctx.fill();

    const body = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.2, cx, cy, r * 1.15);
    body.addColorStop(0, '#FFC0A8');
    body.addColorStop(0.45, tokens.apple);
    body.addColorStop(1, tokens.appleDeep);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = tokens.appleLeaf;
    ctx.lineWidth = Math.max(1.2, cell * 0.055);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.85);
    ctx.quadraticCurveTo(cx + r * 0.25, cy - r * 1.5, cx + r * 0.85, cy - r * 1.55);
    ctx.stroke();
  }

  const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

  /** Tail-to-head colour ramp, resolved once per frame so the segment loop allocates nothing. */
  function makeRamp(tokens) {
    const from = rgb(tokens.snake1);
    const to = rgb(tokens.snake2);
    const cache = new Map();
    return (t) => {
      const bucket = Math.round(t * 16);
      const cached = cache.get(bucket);
      if (cached) return cached;
      const k = bucket / 16;
      const value = `rgb(${Math.round(lerp(from[0], to[0], k))},${Math.round(lerp(from[1], to[1], k))},${Math.round(
        lerp(from[2], to[2], k),
      )})`;
      cache.set(bucket, value);
      return value;
    };
  }

  function drawSegment(x, y, size, tokens, t, dead, ramp) {
    ctx.fillStyle = dead ? tokens.danger : t > 0.9 ? tokens.snake3 : ramp(t);
    const inset = size * 0.06;
    roundRect(ctx, x + inset, y + inset, size - inset * 2, size - inset * 2, radiusFor(size));
    ctx.fill();
  }

  function drawEyes(cx, cy, size, dir, tokens) {
    const forward = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir] || [1, 0];
    const side = [-forward[1], forward[0]];
    const along = size * 0.22;
    const across = size * 0.2;
    const r = Math.max(1.4, size * 0.09);
    ctx.fillStyle = tokens.eye;
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(
        cx + forward[0] * along + side[0] * across * sign,
        cy + forward[1] * along + side[1] * across * sign,
        r,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  /**
   * Paint one frame.
   * @param {object} state snapshot from the sim
   * @param {number} alpha 0..1 between prev (0) and snake (1)
   */
  function draw(state, alpha = 1) {
    if (!metrics.w) resize();
    const tokens = tokensOf();
    paintBackdrop(state.board, tokens);
    const { w, h, cell, originX, originY } = metrics;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(backdrop, 0, 0);

    const dead = state.status === 'over';
    const phase = ((state.ticks + alpha) % 2) / 2;
    drawFood(state.food, tokens, phase);

    const t = Math.max(0, Math.min(1, alpha));
    const ramp = makeRamp(tokens);
    const body = state.snake;
    const prev = state.prev;
    ctx.globalAlpha = dead ? 0.82 : 1;
    for (let i = body.length - 1; i >= 0; i -= 1) {
      const from = prev[i] ?? body[i];
      const to = body[i];
      const gx = lerp(from.x, to.x, t);
      const gy = lerp(from.y, to.y, t);
      drawSegment(
        originX + gx * cell,
        originY + gy * cell,
        cell,
        tokens,
        body.length > 1 ? 1 - i / body.length : 1,
        dead && i === 0,
        ramp,
      );
    }
    ctx.globalAlpha = 1;

    const head = body[0];
    const headFrom = prev[0] ?? head;
    const hx = originX + (lerp(headFrom.x, head.x, t) + 0.5) * cell;
    const hy = originY + (lerp(headFrom.y, head.y, t) + 0.5) * cell;
    drawEyes(hx, hy, cell, state.dir, tokens);

    if (dead) {
      ctx.strokeStyle = tokens.danger;
      ctx.lineWidth = Math.max(2, metrics.dpr * 1.5);
      ctx.setLineDash([cell * 0.35, cell * 0.28]);
      roundRect(ctx, metrics.pad * 0.5, metrics.pad * 0.5, w - metrics.pad, h - metrics.pad, Math.min(w, h) * 0.03);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = tokens.dangerGlow;
      ctx.fillRect(0, 0, w, h);
    }
  }

  return {
    draw,
    resize,
    /** Force the next frame to re-read the palette (used after a theme swap). */
    invalidate() {
      themeKey = '';
      cacheKey = '';
    },
    get metrics() {
      return metrics;
    },
  };
}
