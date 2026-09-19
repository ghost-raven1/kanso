import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { nodeHandler } from '@kanso/app/node';
import { createHandler, buildId } from '../dist-server/server.js';
const manifest = JSON.parse(await readFile('dist/kanso-manifest.json', 'utf8'));
if (manifest.buildId !== buildId)
  throw new Error('Server/client build mismatch. Run npm run build.');
const port = Number(process.env.PORT ?? 4173);
const handle = nodeHandler(
  createHandler({ entry: manifest.entries[0], styles: manifest.styles }),
  'http://127.0.0.1:' + port,
);
const types = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url ?? '/', 'http://localhost').pathname,
    );
    const file = resolve('dist', '.' + pathname);
    if (file.startsWith(resolve('dist') + '/') && pathname !== '/index.html') {
      try {
        const data = await readFile(file);
        response.setHeader(
          'Content-Type',
          types[extname(file)] ?? 'application/octet-stream',
        );
        if (pathname.startsWith('/assets/'))
          response.setHeader(
            'Cache-Control',
            'public, max-age=31536000, immutable',
          );
        response.end(request.method === 'HEAD' ? undefined : data);
        return;
      } catch {}
    }
    await handle(request, response);
  } catch {
    response.writeHead(400).end('Invalid request');
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log('Kanso SSR: http://127.0.0.1:' + port),
);
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
