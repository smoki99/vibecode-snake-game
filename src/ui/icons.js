/**
 * Icon sprite mounting.
 *
 * The sprite is generated from assets/icons/*.svg (tools/sprite.mjs). In the multi-file build the
 * page fetches it once from the same origin; in the single-file bundle the build inlines the markup
 * into #sprite, so `ensureSprite` finds it already there and issues no request at all.
 */
export const ICON_NAMES = Object.freeze([
  'apple',
  'check',
  'chevron-right',
  'close',
  'gamepad',
  'keyboard',
  'medal',
  'pause',
  'play',
  'restart',
  'sound-off',
  'sound-on',
  'theme',
  'trophy',
]);

export async function ensureSprite(container, { fetchImpl = (...args) => fetch(...args), url = 'assets/icons/sprite.svg' } = {}) {
  if (!container) throw new Error('ensureSprite needs a container element');
  if (container.firstElementChild) return container;
  const res = await fetchImpl(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`sprite fetch failed: ${res.status}`);
  container.innerHTML = await res.text();
  return container;
}

/** Point an already-rendered <svg class="icon"> at a different symbol. */
export function setIcon(svgElement, name) {
  const use = svgElement.querySelector('use');
  if (!use) throw new Error('setIcon expects an <svg> containing a <use>');
  const href = `#icon-${name}`;
  use.setAttribute('href', href);
  use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
  return svgElement;
}

/** Markup for icons created at runtime (the ranks list, overlay badges). */
export function iconMarkup(name, cls = 'icon') {
  if (!ICON_NAMES.includes(name)) throw new Error(`unknown icon "${name}"`);
  return `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#icon-${name}"></use></svg>`;
}
