import { defineConfig } from 'vitest/config';
import kansoTesting from '@kanso/vite/testing';

export default defineConfig({
  plugins: [kansoTesting()],
  test: { include: ['src/**/*.test.tsx'] },
});
