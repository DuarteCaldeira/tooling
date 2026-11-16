import { createReadStream, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};
const contained = (root, target) => {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith('../') && !path.startsWith('..\\') && !isAbsolute(path);
};

export function staticServer(directory) {
  const root = realpathSync(directory);
  return createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let path;
    try {
      path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    let target = resolve(root, '.' + path);
    if (!contained(root, target)) {
      response.writeHead(403).end();
      return;
    }
    try {
      if (statSync(target).isDirectory()) target = resolve(target, 'index.html');
      target = realpathSync(target);
      if (!contained(root, target)) {
        response.writeHead(403).end();
        return;
      }
      if (!statSync(target).isFile()) {
        response.writeHead(404).end();
        return;
      }
    } catch {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': types[extname(target)] ?? 'application/octet-stream' });
    if (request.method === 'HEAD') response.end();
    else createReadStream(target).on('error', () => response.destroy()).pipe(response);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, port = '6217', required = 'index.html'] = process.argv.slice(2);
  if (!directory || process.argv.length > 5 || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error('Usage: serve-static.mjs <directory> [port] [required-file]');
  const root = realpathSync(directory);
  const entry = realpathSync(resolve(root, required));
  if (!contained(root, entry) || !statSync(entry).isFile())
    throw new Error('Required build entry is outside the served directory or is not a file');
  staticServer(root).listen(Number(port), '127.0.0.1', () => {
    console.log(`Serving ${root} on http://127.0.0.1:${port}`);
  });
}
