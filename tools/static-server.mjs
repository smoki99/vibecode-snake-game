/**
 * Static file server used by both the dev CLI (tools/serve.mjs) and the browser tests.
 *
 * Exported as a factory so tests can listen on an ephemeral port in-process, with no child
 * processes to clean up.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, resolve, sep } from 'node:path';

export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

async function resolveFile(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const candidate = resolve(join(root, normalize(decoded)));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  try {
    const info = await stat(candidate);
    if (info.isDirectory()) return resolveFile(root, `${decoded.replace(/\/$/, '')}/index.html`);
    return candidate;
  } catch {
    return null;
  }
}

export function createStaticServer({ root, noStore = true, onRequest } = {}) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    const file = await resolveFile(base, req.url === '/' ? '/index.html' : req.url);
    if (!file) {
      onRequest?.(req.url, 404);
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`404 ${req.url}`);
      return;
    }
    const body = await readFile(file);
    onRequest?.(req.url, 200);
    res.writeHead(200, {
      'content-type': MIME_TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': noStore ? 'no-store' : 'public, max-age=3600',
      'content-length': body.length,
    });
    res.end(body);
  });

  return {
    server,
    listen(port = 0, host = '127.0.0.1') {
      return new Promise((done, fail) => {
        server.once('error', fail);
        server.listen(port, host, () => {
          const address = server.address();
          done(`http://${host}:${address.port}`);
        });
      });
    },
    close() {
      return new Promise((done) => server.close(done));
    },
  };
}
