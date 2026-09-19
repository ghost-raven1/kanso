import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Scaffold an empty directory; existing files are never overwritten. */
export async function createProject(directory: string, local?: string): Promise<void> {
  const root = resolve(directory);
  await mkdir(root, { recursive: true });
  if ((await readdir(root)).length) throw new Error('The destination must be empty.');
  const version = (name: string) => local ? `file:${resolve(local, 'packages', name)}` : '^0.2.0';
  const files = {
    'package.json': JSON.stringify({ name: 'kanso-app', version: '0.1.0', private: true, type: 'module', scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview', typecheck: 'tsc --noEmit' }, dependencies: { '@kanso/core': version('core') }, devDependencies: { '@kanso/vite': version('vite'), vite: '^8.3.0', typescript: '^5.9.0' } }, null, 2),
    'index.html': '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
    'vite.config.ts': "import { defineConfig } from 'vite';\nimport kanso from '@kanso/vite';\nexport default defineConfig({ plugins: [kanso()] });\n",
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, skipLibCheck: true, jsx: 'preserve', jsxImportSource: '@kanso/core', lib: ['ES2022', 'DOM'] }, include: ['src'] }, null, 2),
    'src/main.tsx': "import { mount } from '@kanso/core/client';\nimport { App } from './App';\nmount(() => <App />, document.getElementById('root')!);\n",
    'src/App.tsx': "import { useState } from '@kanso/core';\nexport function App() {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(value => value + 1)}>Count: {count}</button>;\n}\n",
  };
  for (const [name, source] of Object.entries(files)) { await mkdir(join(root, name, '..'), { recursive: true }); await writeFile(join(root, name), source); }
}
