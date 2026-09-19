import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';

const directory = fileURLToPath(new URL('../', import.meta.url));
const mime = {
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.html': 'text/html',
};

export async function staticFile(directory, request, response, index) {
  if (!['GET', 'HEAD'].includes(request.method)) return false;
  let relative;
  try {
    relative =
      decodeURIComponent(
        new URL(request.url, 'http://localhost').pathname,
      ).replace(/^\/+/, '') || index;
  } catch {
    return false;
  }
  if (!relative) return false;
  const file = path.resolve(directory, relative);
  if (!file.startsWith(path.resolve(directory) + path.sep)) return false;
  try {
    if (!(await stat(file)).isFile()) return false;
    response.setHeader(
      'Content-Type',
      mime[path.extname(file)] ?? 'application/octet-stream',
    );
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader(
      'Cache-Control',
      relative.startsWith('releases/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    );
    if (relative === 'service-worker.js')
      response.setHeader('Service-Worker-Allowed', '/');
    response.end(request.method === 'HEAD' ? undefined : await readFile(file));
    return true;
  } catch {
    return false;
  }
}

export function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

export async function closeServers(servers) {
  await Promise.all(
    servers.map(
      server =>
        new Promise((resolve, reject) => {
          server.closeIdleConnections();
          server.close(error => (error ? reject(error) : resolve()));
        }),
    ),
  );
}

/** Expose browser artifacts and private server artifacts on separate listeners. */
export async function serveRemote({
  root = directory,
  publicPort = Number(process.env.KANSO_REMOTE_PORT ?? 4201),
  privatePort = Number(process.env.KANSO_PRIVATE_PORT ?? 4301),
} = {}) {
  const servers = [];
  try {
    for (const [folder, port, index] of [
      ['dist', publicPort, 'kanso-remote.json'],
      ['dist-server', privatePort, 'kanso-server.json'],
    ]) {
      const server = http.createServer(async (request, response) => {
        if (
          !(await staticFile(path.join(root, folder), request, response, index))
        ) {
          response.statusCode = 404;
          response.end('Not found');
        }
      });
      servers.push(await listen(server, port));
    }
    return () => closeServers(servers);
  } catch (error) {
    await closeServers(servers);
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const close = await serveRemote();
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      close().then(() => process.exit());
    });
  console.log(
    `Kanso remote: http://127.0.0.1:${process.env.KANSO_REMOTE_PORT ?? 4201}/kanso-remote.json`,
  );
}
