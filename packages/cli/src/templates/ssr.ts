/** Minimal buffered SSR application, including a real development request handler. */
export function ssrFiles(): Record<string, string> {
  return {
    'src/env.d.ts': `declare const __KANSO_BUILD_ID__: string;
`,
    'src/routes.tsx': `import {
  defineRoutes,
  useLoaderData,
  useForm,
  Form,
  useRevalidator,
} from '@kanso/app';
import { useId, useState } from '@kanso/core';

function Home() {
  const { message, name } = useLoaderData<{ message: string; name: string }>();
  const form = useForm<{ saved: string }, { name: string }>({ id: 'profile' });
  const revalidator = useRevalidator();
  const [count, setCount] = useState(0);
  const id = useId();
  const increment = () => setCount(value => value + 1);
  const retry = () => {
    void revalidator.revalidate();
  };

  return (
    <main>
      <h1>{message}</h1>
      <p>
        Saved name: <output>{name}</output>
      </p>
      <Form state={form} aria-label="Profile">
        <label htmlFor={id}>Name</label>
        <input
          id={id}
          name="name"
          required
          value={form.values.name ?? name}
          aria-invalid={!!form.errors.name}
          aria-describedby={id + '-error'}
        />
        <p id={id + '-error'} role="alert">
          {form.errors.name ?? form.error}
        </p>
        <button type="submit" disabled={form.pending}>
          {form.pending ? 'Saving…' : 'Save'}
        </button>
      </Form>
      {revalidator.error && (
        <p role="alert">
          Saved, but the page could not refresh.{' '}
          <button onClick={retry}>Retry refresh</button>
        </p>
      )}
      <button id="counter" onClick={increment}>
        Count: {count}
      </button>
    </main>
  );
}

export const routes = defineRoutes([
  { id: 'home', path: '/', component: Home, sitemap: true },
]);
`,
    'src/seo.config.ts': `import { defineSeo } from '@kanso/app/seo';
export const seo = defineSeo({
  siteUrl: import.meta.env.VITE_SITE_URL ?? 'http://localhost:4173',
  lang: 'en',
  defaultTitle: 'My Kanso app',
  description: 'A server-rendered Kanso application.',
});
`,
    'src/handlers.server.ts': `import { defineRouteHandlers } from '@kanso/app/server';
import { routes } from './routes';

// Demonstration only: replace with a persistent store for your application.
let savedName = 'Visitor';
export const handlers = defineRouteHandlers(routes, {
  home: {
    loader: () => ({ message: 'Hello from Kanso SSR', name: savedName }),
    action: async ({ request }) => {
      const fields = await request.formData();
      const name = String(fields.get('name') ?? '').trim();
      if (name.length < 2)
        return {
          errors: { name: 'Use at least two characters.' },
          values: { name },
        };
      savedName = name;
      return { data: { saved: name }, values: { name } };
    },
  },
});
`,
    'src/server.ts': `import { createRequestHandler } from '@kanso/app/server';
import { routes } from './routes';
import { handlers } from './handlers.server';
import { seo } from './seo.config';
export const buildId = __KANSO_BUILD_ID__;
export const createHandler = (assets: { entry: string; styles?: string[] }) =>
  createRequestHandler({ routes, handlers, seo, buildId, assets });
`,
    'src/main.tsx': `import { App, readBootstrap } from '@kanso/app';
import { hydrateRoot, mount } from '@kanso/core/client';
import { routes } from './routes';
import { seo } from './seo.config';
const root = document.getElementById('root')!;
const bootstrap = readBootstrap(document, __KANSO_BUILD_ID__);
const render = () => <App routes={routes} seo={seo} bootstrap={bootstrap} />;
if (bootstrap) hydrateRoot(render, root);
else mount(render, root);
`,
    'vite.config.ts': `import { defineConfig, type Plugin } from 'vite';
import kanso from '@kanso/vite';
import { nodeHandler } from '@kanso/app/node';
const ssr: Plugin = {
  name: 'app:ssr',
  configureServer(server) {
    return () =>
      server.middlewares.use(async (request, response, next) => {
        try {
          const module = await server.ssrLoadModule('/src/server.ts');
          const url = new URL(request.url ?? '/', 'http://localhost');
          const handler = module.createHandler({ entry: '/src/main.tsx' });
          // Vite serves modules and assets before this fallback middleware.
          const origin =
            'http://' +
            (request.headers.host ?? '127.0.0.1:' + server.config.server.port);
          await nodeHandler(async incoming => {
            const result = await handler(incoming);
            if (
              !result.headers.get('content-type')?.includes('text/html') ||
              incoming.method === 'HEAD'
            )
              return result;
            const html = await server.transformIndexHtml(
              url.pathname,
              await result.text(),
            );
            return new Response(html, {
              status: result.status,
              headers: result.headers,
            });
          }, origin)(request, response);
        } catch (error) {
          next(error);
        }
      });
  },
};
export default defineConfig({
  appType: 'custom',
  plugins: [kanso(), ssr],
  define: {
    __KANSO_BUILD_ID__: JSON.stringify(
      process.env.KANSO_BUILD_ID ?? 'development',
    ),
  },
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022' },
});
`,
    'scripts/build.mjs': `import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { build } from 'vite';
const hash = createHash('sha256');
async function add(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = directory + '/' + entry.name;
    if (entry.isDirectory()) await add(path);
    else {
      hash.update(path);
      hash.update(await readFile(path));
    }
  }
}
await add('src');
for (const path of ['package.json', 'package-lock.json', 'vite.config.ts'])
  hash.update(await readFile(path));
process.env.KANSO_BUILD_ID = hash.digest('hex').slice(0, 16);
await build();
await build({ build: { ssr: 'src/server.ts', outDir: 'dist-server' } });
`,
    'scripts/serve.mjs': `import { createServer } from 'node:http';
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
`,
    '.env.example': 'VITE_SITE_URL=https://example.com\n',
    'README.md': `# Kanso SSR

Run npm install, then npm run dev. The profile form also works without JavaScript. Only explicitly returned values are reflected after validation; the demo store resets on restart. Development and production return server HTML.

Set VITE_SITE_URL before building for your public origin. Run npm run build && npm run preview for production. Keep handlers in .server.ts files.
`,
  };
}
