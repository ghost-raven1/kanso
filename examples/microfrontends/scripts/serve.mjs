import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { nodeHandler } from '@kanso/app/node';
import {
  closeServers,
  listen,
  serveRemote,
  staticFile,
} from '../catalog/scripts/serve.mjs';
import { remoteNames } from './build.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));

/** Run the built shell and each public/private artifact server. */
export async function servePlatform({
  root = directory,
  hostPort = Number(process.env.KANSO_HOST_PORT ?? 4177),
} = {}) {
  const close = [];
  try {
    for (const name of await remoteNames(root)) {
      close.push(
        await serveRemote({
          root: path.join(root, name),
          publicPort: Number(
            name === 'catalog'
              ? (process.env.KANSO_REMOTE_PORT ?? 4201)
              : (process.env.KANSO_PROMOTION_PORT ?? 4202),
          ),
          privatePort: Number(
            name === 'catalog'
              ? (process.env.KANSO_PRIVATE_PORT ?? 4301)
              : (process.env.KANSO_PROMOTION_PRIVATE_PORT ?? 4302),
          ),
        }),
      );
    }
    const { createHandler } = await import(
      pathToFileURL(path.join(root, 'host/dist-server/server.js')).href
    );
    const assets = JSON.parse(
      await readFile(path.join(root, 'host/dist/kanso-manifest.json'), 'utf8'),
    );
    const handler = nodeHandler(
      createHandler({ entry: assets.entries[0], styles: assets.styles }),
      `http://127.0.0.1:${hostPort}`,
    );
    const host = http.createServer(async (request, response) => {
      if (!(await staticFile(path.join(root, 'host/dist'), request, response)))
        await handler(request, response);
    });
    await listen(host, hostPort);
    close.push(() => closeServers([host]));
    return () => Promise.all(close.map(dispose => dispose()));
  } catch (error) {
    await Promise.all(close.map(dispose => dispose()));
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const close = await servePlatform();
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      close().then(() => process.exit());
    });
  console.log(
    `Kanso microfrontends: http://127.0.0.1:${process.env.KANSO_HOST_PORT ?? 4177}/`,
  );
}
