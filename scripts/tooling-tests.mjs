import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { migrate, createProject } from '@kanso/cli';

await mkdir('output/tooling', { recursive: true });
const root = await mkdtemp(resolve('output/tooling/project-'));
let server;
let browser;
try {
  await createProject(root, process.cwd());
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  delete pkg.dependencies['@kanso/core']; delete pkg.devDependencies['@kanso/vite'];
  pkg.dependencies.react = '^19.3.0'; pkg.dependencies['react-dom'] = '^19.3.0';
  pkg.devDependencies['@vitejs/plugin-react'] = '^5.0.0';
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg, null, 2));
  await writeFile(join(root, 'src/main.tsx'), "import{createRoot}from'react-dom/client';import{App}from'./App';createRoot(document.getElementById('root')!).render(<App/>);");
  await writeFile(join(root, 'src/App.tsx'), "import{useState}from'react';export function App(){const[count,setCount]=useState(0);return <button onClick={()=>setCount(count+1)}>Count: {count}</button>}");
  await writeFile(join(root, 'vite.config.ts'), "import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';export default defineConfig({plugins:[react()]});");
  const migration = await migrate({ root, apply: true, local: process.cwd() });
  assert.deepEqual(migration.diagnostics, []); assert.equal(migration.applied, true);
  assert.equal((await migrate({ root })).changes.length, 0);
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--workspaces=false'], { cwd: root, stdio: 'inherit' });
  execFileSync('npm', ['run', 'typecheck'], { cwd: root, stdio: 'inherit' });
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4176', '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; server.stderr.on('data', chunk => { logs += chunk; });
  for (let i=0;;i++) {
    try { if ((await fetch('http://127.0.0.1:4176')).ok) break; } catch {}
    if (i>100 || server.exitCode !== null) throw new Error(`Dev server failed: ${logs}`);
    await new Promise(resolve => setTimeout(resolve,100));
  }
  browser = await chromium.launch(); const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4176');
  await page.getByRole('button').click(); assert.equal(await page.getByRole('button').textContent(), 'Count: 1');
  const source = await readFile(join(root,'src/App.tsx'),'utf8');
  await writeFile(join(root,'src/App.tsx'), source.replace('Count:', 'Hot update:'));
  await page.getByRole('button', { name: /Hot update:/ }).waitFor();
  await page.getByRole('button').click();
  assert.deepEqual(errors, []);
  await writeFile(join(root,'src/private.server.ts'), "export const secret='must stay on server';");
  await writeFile(join(root,'src/App.tsx'), "import{secret}from'./private.server';export function App(){return <p>{secret}</p>}");
  let blocked = false;
  try { execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' }); }
  catch (error) { blocked = String(error.stderr).includes('KANSO_SERVER_ONLY'); }
  assert.equal(blocked, true, 'Client import of server module must fail the build');
  await writeFile('output/tooling/results.json', JSON.stringify({ migration: true, idempotence: true, installedStarterTypecheck: true, productionBuild: true, hmr: true, serverBoundary: true }, null, 2));
  console.log('Tooling passed: real migration → install → typecheck → production build → HMR; server boundary rejected.');
} finally { await browser?.close(); server?.kill('SIGTERM'); await rm(root, { recursive: true, force: true }); }
