import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ssrFiles } from './templates/ssr.js';
export interface CreateProjectOptions {
  template?: 'csr' | 'ssr';
}

/** Scaffold an empty directory; existing files are never overwritten. */
export async function createProject(
  directory: string,
  local?: string,
  options: CreateProjectOptions = {},
): Promise<void> {
  if (options.template && !['csr', 'ssr'].includes(options.template))
    throw new Error('Unknown template. Choose csr or ssr.');
  const root = resolve(directory);
  await mkdir(root, { recursive: true });
  if ((await readdir(root)).length)
    throw new Error('The destination must be empty.');
  const version = (name: string) =>
    local ? `file:${resolve(local, 'packages', name)}` : '^0.5.0';
  const files: Record<string, string> = {
    'package.json': JSON.stringify(
      {
        name: 'kanso-app',
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'vite build',
          preview: 'vite preview',
          typecheck: 'tsc --noEmit',
        },
        dependencies: { '@kanso/core': version('core') },
        devDependencies: {
          '@kanso/vite': version('vite'),
          vite: '^8.3.0',
          typescript: '^5.9.0',
        },
      },
      null,
      2,
    ),
    'index.html': `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    'vite.config.ts': `import { defineConfig } from 'vite';
import kanso from '@kanso/vite';
export default defineConfig({ plugins: [kanso()] });
`,
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          skipLibCheck: true,
          jsx: 'preserve',
          jsxImportSource: '@kanso/core',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          types: ['vite/client'],
        },
        include: ['src'],
      },
      null,
      2,
    ),
    'src/main.tsx': `import { mount } from '@kanso/core/client';
import { App } from './App';
mount(() => <App />, document.getElementById('root')!);
`,
    'src/App.tsx': `import { useState } from '@kanso/core';
export function App() {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount(value => value + 1)}>Count: {count}</button>
  );
}
`,
  };
  files['.gitignore'] =
    'node_modules/\ndist/\ndist-server/\n.env\n.env.*\n!.env.example\n';
  if (options.template === 'ssr') {
    Object.assign(files, ssrFiles());
    delete files['src/App.tsx'];
    const pkg = JSON.parse(files['package.json']);
    pkg.dependencies['@kanso/app'] = version('app');
    pkg.scripts.build = 'node scripts/build.mjs';
    pkg.scripts.preview = 'node scripts/serve.mjs';
    files['package.json'] = JSON.stringify(pkg, null, 2);
  }
  for (const [name, source] of Object.entries(files)) {
    await mkdir(join(root, name, '..'), { recursive: true });
    await writeFile(join(root, name), source);
  }
}
