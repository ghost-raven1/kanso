import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { migrate, doctor } from '@kanso/cli';

const projects: string[] = [];
afterEach(async () => {
  await Promise.all(
    projects.splice(0).map(root => rm(root, { recursive: true, force: true })),
  );
});
const counter = `import {useState} from 'react'; export function Counter(){const[n,setN]=useState(0);return <button onClick={()=>setN(v=>v+1)}>{n}</button>}`;
async function project(files: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kanso-graph-'));
  projects.push(root);
  const sources = {
    'package.json': JSON.stringify({
      type: 'module',
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
    }),
    'index.html': '<script type="module" src="/src/main.tsx"></script>',
    'src/main.tsx': counter,
    'tsconfig.json': '{"compilerOptions":{"jsx":"react-jsx"}}',
    'vite.config.ts':
      "import {defineConfig} from 'vite'; import react from '@vitejs/plugin-react'; export default defineConfig({plugins:[react()]});",
    ...files,
  };
  for (const [name, text] of Object.entries(sources)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), text);
  }
  return { root, sources };
}

describe('configuration and application graphs', () => {
  it('follows config re-exports and enables paths in their actual owner only', async () => {
    const { root } = await project({
      'vite.config.ts': "export {default} from './config/entry';",
      'config/entry.ts':
        "import {shared as config} from './shared'; export default config;",
      'config/shared.ts':
        "import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';export const shared=defineConfig({plugins:[react()]});",
      'tsconfig.json':
        '{"compilerOptions":{"jsx":"react-jsx","baseUrl":".","paths":{"@/*":["missing/*","src/*"]}}}',
      'src/main.tsx': "export {Counter} from '@/Counter';",
      'src/Counter.tsx': counter,
    });
    const report = await migrate({ root, apply: true, local: process.cwd() });
    expect(report.diagnostics).toEqual([]);
    expect(report.applied).toBe(true);
    expect(report.coverage?.complete).toBe(true);
    expect(report.coverage?.configs).toEqual([
      'config/entry.ts',
      'config/shared.ts',
      'vite.config.ts',
    ]);
    expect(await readFile(join(root, 'config/shared.ts'), 'utf8')).toContain(
      'tsconfigPaths: true',
    );
    expect(await readFile(join(root, 'vite.config.ts'), 'utf8')).toBe(
      "export {default} from './config/entry';",
    );
    expect((await migrate({ root })).changes).toEqual([]);
    expect(
      (await doctor({ root })).diagnostics.filter(item =>
        ['CONFIG_AUDIT', 'VITE_PLUGIN'].includes(item.code),
      ),
    ).toEqual([]);
  });

  it('audits multiple selected configurations and every HTML module entry', async () => {
    const { root } = await project({
      'admin.html':
        '<script type="module" src="./src/admin.tsx"></script><script src="./src/support.ts" type="module"></script>',
      'src/admin.tsx': counter.replace('Counter', 'Admin'),
      'src/support.ts': 'export const label = "ready";',
      'vite.admin.config.ts':
        "import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';export default defineConfig({plugins:[react()],build:{rollupOptions:{input:{admin:'admin.html'}}}});",
    });
    const report = await migrate({
      root,
      configs: ['vite.config.ts', 'vite.admin.config.ts'],
    });
    expect(report.diagnostics).toEqual([]);
    expect(report.coverage?.entries).toEqual([
      'src/admin.tsx',
      'src/main.tsx',
      'src/support.ts',
    ]);
    expect(report.coverage?.configs).toEqual([
      'vite.admin.config.ts',
      'vite.config.ts',
    ]);
    expect(report.coverage?.complete).toBe(true);
  });

  it('resolves absolute HTML script paths against the configured Vite root', async () => {
    const { root } = await project({
      'vite.config.ts':
        "import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';export default defineConfig({root:'app',plugins:[react()]});",
      'app/index.html': '<script type="module" src="/main.tsx"></script>',
      'app/main.tsx': counter,
    });
    const report = await migrate({ root });
    expect(report.diagnostics).toEqual([]);
    expect(report.coverage?.entries).toEqual(['app/main.tsx']);
  });

  it('continues the source inventory past an unresolved alias', async () => {
    const { root, sources } = await project({
      'tsconfig.json':
        '{"compilerOptions":{"jsx":"react-jsx","baseUrl":".","paths":{"@/*":["src/*"]}}}',
      'src/main.tsx': "import '@/missing';export {Counter} from './Counter';",
      'src/Counter.tsx': counter,
    });
    const report = await migrate({ root, apply: true });
    expect(report.coverage?.complete).toBe(false);
    expect(report.coverage?.files).toContain('src/Counter.tsx');
    expect(report.diagnostics.map(item => item.code)).toContain(
      'UNRESOLVED_IMPORT',
    );
    expect(report.applied).toBe(false);
    for (const [file, text] of Object.entries(sources))
      expect(await readFile(join(root, file), 'utf8')).toBe(text);
  });

  it('does not infer build entries hidden behind a config spread', async () => {
    const { root } = await project({
      'vite.config.ts': 'const extra={};export default {build:{...extra}};',
    });
    const report = await migrate({ root, apply: true });
    expect(report.diagnostics.map(item => item.code)).toContain(
      'VITE_CONFIG_DYNAMIC',
    );
    expect(report.coverage?.complete).toBe(false);
    expect(report.applied).toBe(false);
  });

  it('rejects unsupported entry files without claiming a complete audit', async () => {
    const { root } = await project({ 'entry.json': '{}' });
    const report = await migrate({
      root,
      entries: ['entry.json'],
      apply: true,
    });
    expect(
      report.diagnostics.some(item => item.message.includes('ENTRY_TYPE')),
    ).toBe(true);
    expect(report.coverage?.complete).toBe(false);
    expect(report.applied).toBe(false);
  });

  it('continues inventory after a dynamic config and never writes a partial graph', async () => {
    const { root, sources } = await project({
      'vite.config.ts':
        "import {defineConfig} from 'vite';globalThis.mustNotExecute=true;export default defineConfig(({mode})=>({base:mode}));",
    });
    const report = await migrate({ root, apply: true });
    expect(report.applied).toBe(false);
    expect(report.diagnostics.map(item => item.code)).toContain(
      'VITE_CONFIG_DYNAMIC',
    );
    expect(report.coverage?.complete).toBe(false);
    expect(report.coverage?.files).toContain('src/main.tsx');
    expect(report.modules).toBeGreaterThan(0);
    expect('mustNotExecute' in globalThis).toBe(false);
    for (const [file, text] of Object.entries(sources))
      expect(await readFile(join(root, file), 'utf8')).toBe(text);
  });

  it('reports config cycles while still inspecting explicitly selected source', async () => {
    const { root } = await project({
      'vite.config.ts': "export {default} from './other';",
      'other.ts': "export {default} from './vite.config';",
    });
    const report = await migrate({
      root,
      entries: ['src/main.tsx'],
      apply: true,
    });
    expect(report.applied).toBe(false);
    expect(report.diagnostics.map(item => item.code)).toContain(
      'VITE_CONFIG_CYCLE',
    );
    expect(report.coverage?.files).toContain('src/main.tsx');
  });

  it('uses the same resolver for local package hooks and source traversal', async () => {
    const { root } = await project({
      'package.json': JSON.stringify({
        type: 'module',
        dependencies: {
          react: '^18.3.1',
          '@example/hooks': 'file:packages/hooks',
        },
      }),
      'packages/hooks/package.json': JSON.stringify({
        name: '@example/hooks',
        type: 'module',
        exports: { './counter': './src/index.ts' },
      }),
      'packages/hooks/src/index.ts': "export {useCount} from './useCount';",
      'packages/hooks/src/useCount.ts':
        "import {useState} from 'react'; export function useCount(){const[count,setCount]=useState(0);return [count,setCount]}",
      'src/main.tsx':
        "import {useCount} from '@example/hooks/counter'; export function App(){const[count,setCount]=useCount();return <button onClick={()=>setCount(n=>n+1)}>{count}</button>}",
    });
    await mkdir(join(root, 'node_modules/@example'), { recursive: true });
    await symlink(
      join(root, 'packages/hooks'),
      join(root, 'node_modules/@example/hooks'),
    );
    const report = await migrate({ root, apply: true, local: process.cwd() });
    expect(report.diagnostics).toEqual([]);
    expect(report.applied).toBe(true);
    expect(report.coverage?.files).toContain('packages/hooks/src/useCount.ts');
    expect(
      await readFile(join(root, 'packages/hooks/src/useCount.ts'), 'utf8'),
    ).toContain('@kanso/core');
    expect((await migrate({ root })).changes).toEqual([]);
  });
});

it('reads direct config callbacks and pure path helpers without executing them', async () => {
  const {root} = await project({
    'vite.config.ts': `import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';import {fileURLToPath,URL} from 'node:url';
      const source=(path:string)=>fileURLToPath(new URL(path,import.meta.url));
      export default defineConfig(({command})=>({base:command==='build'?(process.env.LOCAL?process.env.ASSET_BASE:'/app/'):'/',plugins:[react()],resolve:{alias:{'@':source('./src')}}}));`,
    'src/main.tsx': "export {Counter} from '@/Counter';",
    'src/Counter.tsx': counter,
  });
  const report = await migrate({root,apply:true,local:process.cwd()});
  expect(report.diagnostics).toEqual([]);
  expect(report.applied).toBe(true);
  expect(report.coverage?.complete).toBe(true);
  expect((await migrate({root})).changes).toEqual([]);
});

it('uses explicit source mappings for hook and source audits, but blocks writes until federation is ported', async () => {
  const {root,sources} = await project({
    'src/main.tsx': "import {useCount} from 'account/hooks';export function App(){const[count,setCount]=useCount();return <button onClick={()=>setCount(v=>v+1)}>{count}</button>}",
    'src/hooks.ts': "export {useCount} from './useCount';",
    'src/useCount.ts': "import {useState} from 'react';export function useCount(){const[count,setCount]=useState(0);return [count,setCount]}",
  });
  const options={root,sourceAliases:{'account/hooks':'./src/hooks.ts'}};
  const report=await migrate(options);
  expect(report.coverage?.complete).toBe(true);
  expect(report.coverage?.files).toContain('src/useCount.ts');
  expect(report.diagnostics.map(item=>item.code)).toEqual(['SOURCE_ALIAS_PORT']);
  expect(report.diagnostics[0].severity).toBe('warning');
  expect((await migrate({...options,apply:true})).applied).toBe(false);
  for(const [file,text] of Object.entries(sources)) expect(await readFile(join(root,file),'utf8')).toBe(text);
});

it.each([
  `const source=(path)=>{ console.log(path); return path; };`,
  `const source=(path)=>source(path);`,
  `const source=(URL)=>fileURLToPath(new URL('./src',import.meta.url));`,
])('rejects executable, cyclic or shadowed path helpers: %s', async helper => {
  const {root}=await project({'vite.config.ts':`import {fileURLToPath} from 'node:url';${helper} export default {resolve:{alias:{'@':source('./src')}}};`});
  const report=await migrate({root,apply:true});
  expect(report.applied).toBe(false);
  expect(report.diagnostics.map(item=>item.code)).toContain('PATH_ALIAS_DYNAMIC');
});
