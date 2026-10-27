#!/usr/bin/env node
/**
 * Dev server CLI.
 *
 *   node tools/serve.mjs --port 8080 [--host 127.0.0.1] [--root .]
 *
 * ES modules need an http origin (file:// blocks module fetches), so this is how the multi-file
 * source is played. The single-file bundle in dist/ is the one that works from file://.
 */
import { resolve } from 'node:path';
import { createStaticServer } from './static-server.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};

const root = resolve(arg('root', process.cwd()));
const port = Number(arg('port', 8080));
const host = arg('host', '127.0.0.1');

const app = createStaticServer({ root, onRequest: (url, status) => console.log(`${status} ${url}`) });
app.listen(port, host).then((url) => console.log(`serving ${root} at ${url}`));
