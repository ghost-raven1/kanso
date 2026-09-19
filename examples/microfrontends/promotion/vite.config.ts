import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import kanso from '@kanso/vite';

const release = process.env.KANSO_BUILD_ID ?? 'A';
export default defineConfig(({ isSsrBuild }) => ({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: `http://127.0.0.1:${isSsrBuild ? (process.env.KANSO_PROMOTION_PRIVATE_PORT ?? 4302) : (process.env.KANSO_PROMOTION_PORT ?? 4202)}/releases/${release}/`,
  plugins: [
    kanso({
      microfrontends: {
        name: 'promotion',
        contract: '1.0.0',
        exposes: { Banner: './src/Banner.tsx' },
      },
    }),
  ],
  define: { 'import.meta.env.VITE_RELEASE': JSON.stringify(release) },
  build: { target: 'es2022' },
}));
