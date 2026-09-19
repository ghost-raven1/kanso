import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrate, migrateSource, createProject } from '@kanso/cli';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function fixture(component: string, dependencies: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kanso-migrate-')); directories.push(root);
  await mkdir(join(root, 'src'));
  await Promise.all(Object.entries({
    'package.json': JSON.stringify({ type: 'module', dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0', ...dependencies }, devDependencies: { '@vitejs/plugin-react': '^4.0.0', vite: '^8.3.0' } }),
    'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
    'src/main.tsx': "import {createRoot} from 'react-dom/client'; import {Counter} from './Counter'; createRoot(document.getElementById('root')!).render(<Counter/>);",
    'src/Counter.tsx': component,
    'vite.config.ts': "import {defineConfig} from 'vite'; import react from '@vitejs/plugin-react'; export default defineConfig({plugins:[react()]});",
    'tsconfig.json': '{"compilerOptions":{"jsx":"react-jsx"}}',
  }).map(([name, content]) => writeFile(join(root, name), content)));
  return root;
}

const counter = `import {useState} from 'react'; export function Counter(){const [count,setCount]=useState(0); return <button onClick={()=>setCount(n=>n+1)}>{count}</button>}`;

describe('transactional migration', () => {
  it('checks without writing, applies a complete graph, and is idempotent', async () => {
    const root = await fixture(counter);
    const check = await migrate({ root });
    expect(check.diagnostics).toEqual([]); expect(check.changes.length).toBe(5);
    expect(await readFile(join(root, 'src/Counter.tsx'), 'utf8')).toBe(counter);
    const result = await migrate({ root, apply: true, local: process.cwd() });
    expect(result.applied).toBe(true);
    expect(await readFile(join(root, 'src/main.tsx'), 'utf8')).toContain('render(() =>');
    expect(await readFile(join(root, 'vite.config.ts'), 'utf8')).toContain('@kanso/vite');
    const repeated = await migrate({ root }); expect(repeated.diagnostics).toEqual([]); expect(repeated.changes).toEqual([]);
  });
  it('blocks a React-dependent library before writing anything', async () => {
    const root = await fixture(counter, { '@mui/material': '^5.0.0' });
    const before = await readFile(join(root, 'package.json'), 'utf8');
    const result = await migrate({ root, apply: true });
    expect(result.applied).toBe(false); expect(result.diagnostics.some(item => item.code === 'REACT_DEPENDENCY')).toBe(true);
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(before);
  });
  it('reports state snapshots, asynchronous captures and implicit effect semantics', () => {
    const result = migrateSource(`import {useState,useEffect} from 'react';function App(){const [n,setN]=useState(0);useEffect(()=>console.log(n));return <button onClick={()=>{setN(n+1);setN(n+1);setTimeout(()=>console.log(n),10)}}>{n}</button>}`, 'App.tsx');
    expect(result.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining(['EFFECT_TRACKING', 'STATE_SNAPSHOT', 'ASYNC_SNAPSHOT']));
  });
  it('converts default React imports and aliases without touching shadowed bindings', () => {
    const result = migrateSource(`import React from 'react';export function App(){const [n,setN]=React.useState(1);return <button onClick={()=>setN(x=>x+1)}>{n}</button>}`, 'App.tsx');
    expect(result.diagnostics).toEqual([]); expect(result.code).not.toContain('React.useState');
  });
  it('creates a local starter and refuses to overwrite it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kanso-create-')); directories.push(root);
    await createProject(root, process.cwd());
    expect(await readFile(join(root, 'src/App.tsx'), 'utf8')).toContain('@kanso/core');
    expect((await migrate({ root })).changes).toEqual([]);
    await expect(createProject(root)).rejects.toThrow('empty');
  });
  it('migrates verified custom hooks through a local barrel and named alias', async () => {
    const root=await fixture(`import{useCount as counter}from'./hooks';export function Counter(){const[n,increment]=counter();return <button onClick={increment}>{n}</button>}`);
    await writeFile(join(root,'src/hooks.ts'), `export{useCounter as useCount}from'./useCounter';`);
    await writeFile(join(root,'src/useCounter.ts'), `import{useState}from'react';export function useCounter(){const[n,setN]=useState(0);const increment=()=>setN(value=>value+1);return[n,increment] as const}`);
    const result=await migrate({root,apply:true,local:process.cwd()});
    expect(result.diagnostics).toEqual([]);expect(result.applied).toBe(true);
    expect(await readFile(join(root,'src/useCounter.ts'),'utf8')).toContain('@kanso/core');
    expect((await migrate({root})).changes).toEqual([]);
  });
  it('blocks unverified hooks, namespace calls and repeated custom updates before writes', async () => {
    const root=await fixture(`import{useCounter}from'./useCounter';export function Counter(){const[n,increment]=useCounter();return <button onClick={()=>{increment();increment()}}>{n}</button>}`);
    await writeFile(join(root,'src/useCounter.ts'), `import{useState}from'react';export function useCounter(){const[n,setN]=useState(0);return[n,()=>setN(n+1)] as const}`);
    const before=await readFile(join(root,'package.json'),'utf8');
    const result=await migrate({root,apply:true});
    expect(result.applied).toBe(false);expect(result.diagnostics.some(item=>item.code==='STATE_SNAPSHOT')).toBe(true);
    expect(await readFile(join(root,'package.json'),'utf8')).toBe(before);
    expect(migrateSource(`import{useForeign as foreign}from'library';export function App(){const[n]=foreign();return <p>{n}</p>}`,'App.tsx').diagnostics.some(item=>item.code==='CUSTOM_HOOK')).toBe(true);
    expect(migrateSource(`import * as hooks from './hooks';export function App(){const[n]=hooks.useCounter();return <p>{n}</p>}`,'App.tsx').diagnostics.some(item=>item.code==='KANSO_HOOK_NAMESPACE')).toBe(true);
  });
});

it('does not report snapshots for unrelated shadowed names', () => {
  const result=migrateSource(`import{useState}from'react';export function App(){const[n,setN]=useState(0);return <p>{n}</p>}function ordinary(setN,n){setN(n);setN(n)}`, 'App.tsx');
  expect(result.diagnostics).toEqual([]);
});

it('uses inherited tsconfig paths and Vite aliases for hooks without executing config', async () => {
  const root=await fixture(`import{useCounter}from'@/counter';export function Counter(){const[n,setN]=useCounter();return <button onClick={()=>setN(v=>v+1)}>{n}</button>}`);
  await writeFile(join(root,'tsconfig.base.json'), JSON.stringify({compilerOptions:{baseUrl:'.',paths:{'@/*':['src/*']},jsx:'react-jsx'}}));
  await writeFile(join(root,'tsconfig.json'), JSON.stringify({extends:'./tsconfig.base.json',include:['src']}));
  await writeFile(join(root,'src/counter.ts'), `import{useState}from'react';export function useCounter(){const[n,setN]=useState(0);return[n,setN] as const}`);
  const report=await migrate({root,apply:true,local:process.cwd()});
  expect(report.diagnostics).toEqual([]);expect(report.applied).toBe(true);
  expect(await readFile(join(root,'vite.config.ts'),'utf8')).toContain('tsconfigPaths: true');
  expect((await migrate({root})).changes).toEqual([]);
  await writeFile(join(root,'vite.config.ts'), `import{defineConfig}from'vite';import kanso from'@kanso/vite';import{fileURLToPath}from'node:url';export default defineConfig({plugins:[kanso()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}}})`);
  expect((await migrate({root})).diagnostics).toEqual([]);
  await writeFile(join(root,'vite.config.ts'), `throw new Error('must not execute');export default ()=>({});`);
  const before=await readFile(join(root,'package.json'),'utf8');const blocked=await migrate({root,apply:true});
  expect(blocked.applied).toBe(false);expect(blocked.diagnostics[0].code).toBe('VITE_CONFIG_DYNAMIC');expect(await readFile(join(root,'package.json'),'utf8')).toBe(before);
});

it('retains specific compiler diagnostics with source positions and recovery hints', () => {
  const report=migrateSource(`import{useState}from'react';export function App(){const[n]=useState(0);const value=unknown(n);return <p>{value}</p>}`, 'App.tsx');
  expect(report.diagnostics[0].code).toBe('KANSO_PURITY');expect(report.diagnostics[0].line).toBe(1);expect(report.diagnostics[0].column).toBeGreaterThan(1);expect(report.diagnostics[0].hint).toContain('useMemo');
  expect(migrateSource(`import React from 'react';const event: React.SyntheticEvent = {} as never;`, 'event.ts').diagnostics[0].code).toBe('UNSUPPORTED_API');
});

it('doctor reports configuration problems without writing files', async () => {
  const { doctor }=await import('@kanso/cli');
  const root=await fixture(counter);
  const before=await readFile(join(root,'package.json'),'utf8');
  const report=await doctor({root});
  expect(report.diagnostics.map(item=>item.code)).toEqual(expect.arrayContaining(['PACKAGE_MISSING','JSX_CONFIG','VITE_PLUGIN','REACT_DEPENDENCY']));
  expect(await readFile(join(root,'package.json'),'utf8')).toBe(before);
  await expect(doctor({root:join(root,'missing')})).rejects.toThrow();
});


it('doctor requires the Kanso call to belong to the configured plugins', async () => {
  const { doctor } = await import('@kanso/cli');
  const root = await fixture(counter);
  const file = join(root, 'vite.config.ts');
  await writeFile(file, "import kanso from '@kanso/vite';const unused = kanso();export default {plugins:[]}");
  expect((await doctor({ root })).diagnostics.some(item => item.code === 'VITE_PLUGIN')).toBe(true);
  await writeFile(file, "import kanso from '@kanso/vite';const plugins = [kanso()];export default {plugins}");
  expect((await doctor({ root })).diagnostics.some(item => item.code === 'VITE_PLUGIN')).toBe(false);
});

it('blocks shadowed URL alias constructors without executing configuration', async () => {
  const root = await fixture(counter);
  await writeFile(join(root, 'vite.config.ts'), "import {fileURLToPath} from 'node:url';const URL = class {};export default {resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}}}");
  const before = await readFile(join(root, 'package.json'), 'utf8');
  const report = await migrate({ root, apply: true });
  expect(report.applied).toBe(false);
  expect(report.diagnostics[0].code).toBe('PATH_ALIAS_DYNAMIC');
  expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(before);
});

it('overrides JSX inherited from a nested shared TypeScript config', async () => {
  const root = await fixture(counter);
  await mkdir(join(root, 'config'));
  const shared = '{"compilerOptions":{"jsx":"react-jsx"}}';
  await writeFile(join(root, 'config/base.json'), shared);
  await writeFile(join(root, 'tsconfig.json'), '{"extends":"./config/base.json","include":["src"]}');
  const report = await migrate({ root, apply: true });
  expect(report.diagnostics).toEqual([]);
  const config = JSON.parse(await readFile(join(root, 'tsconfig.json'), 'utf8'));
  expect(config.compilerOptions).toMatchObject({ jsx: 'preserve', jsxImportSource: '@kanso/core' });
  expect(await readFile(join(root, 'config/base.json'), 'utf8')).toBe(shared);
  expect((await migrate({ root })).changes).toEqual([]);
});


it('doctor finds Solid copies brought by application dependencies', async () => {
  const { doctor } = await import('@kanso/cli');
  const root = await fixture(counter, { 'solid-widget': '1.0.0' });
  for (const [directory, manifest] of Object.entries({
    '@kanso/core': { name: '@kanso/core', version: '0.4.0', dependencies: { 'solid-js': '1.9.15' } },
    'solid-js': { name: 'solid-js', version: '1.9.15' },
    'solid-widget': { name: 'solid-widget', version: '1.0.0', dependencies: { 'solid-js': '1.9.14' } },
    'solid-widget/node_modules/solid-js': { name: 'solid-js', version: '1.9.14' },
  })) {
    const target = join(root, 'node_modules', directory);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'package.json'), JSON.stringify(manifest));
  }
  const report = await doctor({ root });
  expect(report.diagnostics.some(item => item.code === 'SOLID_DUPLICATE')).toBe(true);
});
