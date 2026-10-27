#!/usr/bin/env node
/**
 * Vendor the two typefaces into assets/fonts/ so the running game never touches the network.
 *
 *   node tools/fetch-fonts.mjs
 *
 * Source: the @fontsource npm packages (self-hostable woff2, latin subset, SIL OFL licensed).
 * Artifacts are cached in .build/vendor and a manifest with sha256 digests is written next to the
 * fonts, so a later run can prove the bytes did not drift. Deleting assets/fonts/ and re-running
 * reproduces the directory.
 */
import { mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const run = promisify(execFile);
const ROOT = new URL('..', import.meta.url).pathname;
const CACHE = join(ROOT, '.build/vendor');
const OUT = join(ROOT, 'assets/fonts');

const PINNED = [
  { pkg: '@fontsource/space-grotesk', version: '5.3.0', tarballName: 'space-grotesk' },
  { pkg: '@fontsource/silkscreen', version: '5.3.0', tarballName: 'silkscreen' },
];

/** Files we ship: latin subset only, the weights the UI actually uses. */
const WANTED = {
  '@fontsource/space-grotesk': [
    'space-grotesk-latin-400-normal.woff2',
    'space-grotesk-latin-500-normal.woff2',
    'space-grotesk-latin-700-normal.woff2',
  ],
  '@fontsource/silkscreen': ['silkscreen-latin-400-normal.woff2', 'silkscreen-latin-700-normal.woff2'],
};

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function ensureTarball(pkg, version, tarballName) {
  const tgz = join(CACHE, `${tarballName}-${version}.tgz`);
  try {
    await readFile(tgz);
    return tgz;
  } catch {
    /* not cached */
  }
  const url = `https://registry.npmjs.org/${pkg}/-/${tarballName}-${version}.tgz`;
  const bytes = await fetchBuffer(url);
  await mkdir(CACHE, { recursive: true });
  await writeFile(tgz, bytes);
  return tgz;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const manifest = { generatedBy: 'tools/fetch-fonts.mjs', license: 'SIL OFL 1.1', families: [] };

  for (const { pkg, version, tarballName } of PINNED) {
    const tgz = await ensureTarball(pkg, version, tarballName);
    const dir = join(CACHE, `${tarballName}-${version}`);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await run('tar', ['-xzf', tgz, '-C', dir]);

    const entry = { pkg, version, files: [] };
    for (const name of WANTED[pkg]) {
      const src = join(dir, 'package/files', name);
      const bytes = await readFile(src);
      if (bytes.subarray(0, 4).toString('latin1') !== 'wOF2') {
        throw new Error(`${name} is not a woff2 file (magic mismatch)`);
      }
      if (bytes.length < 4096) throw new Error(`${name} looks truncated (${bytes.length} bytes)`);
      await writeFile(join(OUT, name), bytes);
      entry.files.push({ name, bytes: bytes.length, sha256: sha256(bytes) });
      console.log(`  ${name}  ${bytes.length} bytes`);
    }
    const license = await readFile(join(dir, 'package/LICENSE'), 'utf8');
    await writeFile(join(OUT, `${tarballName}-OFL.txt`), license);
    entry.licenseFile = `${tarballName}-OFL.txt`;
    manifest.families.push(entry);
  }

  await writeFile(join(OUT, 'FONTS-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const count = (await readdir(OUT)).length;
  console.log(`fonts ready: ${count} files in assets/fonts`);
}

main().catch((err) => {
  console.error(`fetch-fonts failed: ${err.message}`);
  process.exitCode = 1;
});
