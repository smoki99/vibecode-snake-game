/**
 * Resolve Playwright from the shared global install.
 *
 * The package is installed once for every sandbox under the shared npm prefix
 * (/opt/shared-tooling/npm), which is not on the ESM resolution path from a workspace, and
 * `npm root -g` points at a different prefix. So: try a bare import, then each candidate root in
 * turn. The resolved entry point is cached in .build so repeated runs skip the probing.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE = new URL('../.build/pw-entry', import.meta.url).pathname;

function candidateRoots() {
  const roots = ['/opt/shared-tooling/npm/lib/node_modules'];
  if (process.env.NODE_PATH) roots.push(...process.env.NODE_PATH.split(':').filter(Boolean));
  try {
    roots.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim());
  } catch {
    /* npm unavailable */
  }
  return [...new Set(roots.filter(Boolean))];
}

async function resolveEntry() {
  try {
    await import('playwright');
    return 'bare';
  } catch {
    /* not resolvable from here; probe the global roots */
  }
  try {
    const cached = (await readFile(CACHE, 'utf8')).trim();
    if (cached && existsSync(cached)) return cached;
  } catch {
    /* no cache yet */
  }
  for (const root of candidateRoots()) {
    if (!existsSync(join(root, 'playwright'))) continue;
    const req = createRequire(join(root, 'noop.js'));
    const entry = req.resolve('playwright');
    await mkdir(dirname(CACHE), { recursive: true });
    await writeFile(CACHE, entry);
    return entry;
  }
  throw new Error(
    `playwright not found. Install it: npm i -g --prefix /opt/shared-tooling/npm playwright\n` +
      `Searched: ${candidateRoots().join(', ')} (from ${fileURLToPath(import.meta.url)})`,
  );
}

export async function loadPlaywright() {
  const entry = await resolveEntry();
  const mod = entry === 'bare' ? await import('playwright') : await import(`file://${entry}`);
  const api = mod.chromium ? mod : mod.default;
  if (!api?.chromium) throw new Error('playwright resolved but has no chromium export');
  return api;
}
