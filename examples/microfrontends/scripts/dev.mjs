import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { nodeHandler } from '@kanso/app/node';
import { createRemoteDevelopment } from '../catalog/scripts/dev.mjs';
import { closeServers, listen } from '../catalog/scripts/serve.mjs';
import { remoteNames } from './build.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));

function loadedStyles(servers) {
  const styles = new Set();
  for (const server of servers) {
    for (const module of server.environments.ssr.moduleGraph.idToModuleMap.values()) {
      if (
        !module.file?.endsWith('.css') ||
        !module.file.startsWith(server.config.root + path.sep)
      )
        continue;
      const relative = path
        .relative(server.config.root, module.file)
        .replaceAll('\\', '/');
      styles.add(
        new URL(
          relative + '?direct',
          new URL(server.config.base, server.config.server.origin),
        ).href,
      );
    }
  }
  return [...styles]
    .map(
      url =>
        `<link rel="stylesheet" href="${url.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">`,
    )
    .join('');
}

/** Render requests with current Vite modules; remote HMR uses each remote's own socket. */
export async function serveDevelopment({
  root = directory,
  hostPort = Number(process.env.KANSO_HOST_PORT ?? 4177),
  remote,
} = {}) {
  process.env.KANSO_BUILD_ID = 'local';
  process.env.VITE_CATALOG_ORIGIN ??= `http://127.0.0.1:${process.env.KANSO_REMOTE_PORT ?? 4201}`;
  process.env.VITE_PROMOTION_ORIGIN ??= `http://127.0.0.1:${process.env.KANSO_PROMOTION_PORT ?? 4202}`;
  const servers = [];
  let host;
  let listener;
  try {
    const available = await remoteNames(root);
    const selected = remote
      ? [remote]
      : (process.env.KANSO_LOCAL_REMOTES?.split(',') ?? available);
    if (selected.some(name => !available.includes(name)))
      throw new Error('Select catalog or promotion as a local remote.');
    const sources = {};
    for (const name of selected) {
      const server = await createRemoteDevelopment({
        root: path.join(root, name),
        port: Number(
          name === 'catalog'
            ? (process.env.KANSO_REMOTE_PORT ?? 4201)
            : (process.env.KANSO_PROMOTION_PORT ?? 4202),
        ),
      });
      servers.push(server);
      const entries = server.config.plugins.find(
        plugin => plugin.name === 'kanso:microfrontends',
      )?.api?.ssrEntries;
      if (!entries)
        throw new Error(
          `The ${name} Vite configuration must expose Kanso microfrontend modules.`,
        );
      sources[name] = {
        development: {
          buildId: 'local',
          load(exportName) {
            const entry = entries[exportName];
            if (!entry && exportName === 'handlers')
              return Promise.resolve({ handlers: {} });
            if (!entry)
              return Promise.reject(
                new Error(`Unknown local export ${name}/${exportName}.`),
              );
            return server.ssrLoadModule(
              path.resolve(server.config.root, entry),
            );
          },
        },
      };
    }
    if (!remote) {
      listener = http.createServer();
      host = await createServer({
        root: path.join(root, 'host'),
        configFile: path.join(root, 'host/vite.config.ts'),
        appType: 'custom',
        server: {
          middlewareMode: true,
          origin: `http://127.0.0.1:${hostPort}`,
          hmr: { server: listener },
          cors: true,
        },
      });
      const handler = nodeHandler(async request => {
        const { createHandler } = await host.ssrLoadModule('/src/server.ts');
        const response = await createHandler(
          { entry: '/src/main.tsx', styles: ['/src/style.css'] },
          sources,
        )(request);
        if (
          request.method === 'HEAD' ||
          !response.headers.get('content-type')?.includes('text/html')
        )
          return response;
        const html = (await response.text()).replace(
          '</head>',
          loadedStyles(servers) + '</head>',
        );
        return new Response(
          await host.transformIndexHtml(new URL(request.url).pathname, html),
          { status: response.status, headers: response.headers },
        );
      }, `http://127.0.0.1:${hostPort}`);
      listener.on('request', (request, response) => {
        host.middlewares(request, response, () => {
          handler(request, response).catch(error => {
            host.ssrFixStacktrace(error);
            console.error(error);
            if (!response.headersSent) response.statusCode = 500;
            response.end(
              'Development render failed. See the terminal for details.',
            );
          });
        });
      });
      await listen(listener, hostPort);
    }
    return async () => {
      await Promise.all(
        [...servers, ...(host ? [host] : [])].map(server => server.close()),
      );
      if (listener?.listening) await closeServers([listener]);
    };
  } catch (error) {
    await Promise.all(
      [...servers, ...(host ? [host] : [])].map(server => server.close()),
    );
    if (listener?.listening) await closeServers([listener]);
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--remote');
  const remote = index < 0 ? undefined : process.argv[index + 1];
  const close = await serveDevelopment({ remote });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      close().then(() => process.exit());
    });
  console.log(
    remote
      ? `Kanso local remote: ${remote}`
      : `Kanso SSR development: http://127.0.0.1:${process.env.KANSO_HOST_PORT ?? 4177}/`,
  );
}
