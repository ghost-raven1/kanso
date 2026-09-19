import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import kanso from '@kanso/vite';
import { nodeHandler } from '@kanso/app/node';

const root = fileURLToPath(new URL('.', import.meta.url));
const dataServer: Plugin = {
  name: 'lab:data-server',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/_kanso/')) return next();
      try {
        const module = await server.ssrLoadModule('/server.ts');
        await nodeHandler(module.createHandler({ entry: '/client.tsx' }), 'http://localhost:5173')(req, res);
      } catch (error) { next(error); }
    });
  },
};

export default defineConfig({
  root,
  plugins: [kanso({ buildId: process.env.KANSO_BUILD_ID ?? 'development', routes: { '/': '/examples/lab/pages/Home.tsx', '/data': '/examples/lab/pages/Data.tsx', '/lazy': '/examples/lab/pages/Lazy.tsx' } }), dataServer],
  define: { __KANSO_BUILD_ID__: JSON.stringify(process.env.KANSO_BUILD_ID ?? 'development') },
  build: { manifest: true, target: 'es2022', sourcemap: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
