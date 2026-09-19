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
    expect(migrateSource(`import * as hooks from './hooks';export function App(){const[n]=hooks.useCounter();return <p>{n}</p>}`,'App.tsx').diagnostics.some(item=>item.code==='COMPILER')).toBe(true);
  });
});
