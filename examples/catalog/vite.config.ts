import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
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
  root: fileURLToPath(new URL('.', import.meta.url)),
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
