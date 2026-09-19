import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeHandler } from '@kanso/app/node';
import { createHandler } from './dist-server/server.js';

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, 'dist/kanso-manifest.json'), 'utf8'));
const port = Number(process.env.PORT ?? 4173);
const handle = nodeHandler(createHandler({ entry: manifest.entries[0], styles: manifest.styles }), `http://127.0.0.1:${port}`);
const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json' };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
  if (pathname.startsWith('/assets/')) {
    const file = resolve(root, 'dist', `.${decodeURIComponent(pathname)}`);
    if (!file.startsWith(resolve(root, 'dist/assets') + '/')) { response.writeHead(404).end(); return; }
    try {
      await stat(file); response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
    return;
  }
  await handle(request, response);
});
server.listen(port, '127.0.0.1', () => console.log(`Kanso SSR lab: http://127.0.0.1:${port}`));
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
