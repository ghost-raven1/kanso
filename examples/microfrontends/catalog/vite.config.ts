import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import kanso from '@kanso/vite';

const release = process.env.KANSO_BUILD_ID ?? 'A';
export default defineConfig(({ isSsrBuild }) => ({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: `http://127.0.0.1:${isSsrBuild ? (process.env.KANSO_PRIVATE_PORT ?? 4301) : (process.env.KANSO_REMOTE_PORT ?? 4201)}/releases/${release}/`,
  plugins: [
    kanso({
      microfrontends: {
        name: 'catalog',
        contract: '1.0.0',
        exposes: { ProductCard: './src/ProductCard.tsx' },
        routes: './src/routes.tsx',
        server: './src/handlers.server.ts',
      },
    }),
  ],
  define: { 'import.meta.env.VITE_RELEASE': JSON.stringify(release) },
  build: { target: 'es2022' },
}));
