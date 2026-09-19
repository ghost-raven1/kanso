import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import kanso from '@kanso/vite';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    kanso({
      microfrontends: { name: 'shell' },
      serviceWorker: { entry: 'src/service-worker.ts' },
    }),
  ],
  define: {
    'import.meta.env.KANSO_HOST_BUILD_ID': JSON.stringify(
      process.env.KANSO_BUILD_ID ?? 'development',
    ),
  },
  build: { target: 'es2022' },
});
