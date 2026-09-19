import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { createProject } from '../packages/cli/src/create.js';
import { doctor } from '../packages/cli/src/doctor.js';
import { KANSO_PACKAGES } from '../packages/cli/src/packages.js';

const template = vi.hoisted(() => ({ artifact: '' }));
vi.mock('../packages/cli/src/templates/microfrontends.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../packages/cli/src/templates/microfrontends.js')>();
  return { ...actual, microfrontendFiles: (name: 'microfrontends' | 'remote', local?: string) => actual.microfrontendFiles(name, local, template.artifact) };
});
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function temporary() {
  const root = await mkdtemp(join(tmpdir(), 'kanso-mf-dx-')); roots.push(root); return root;
}

async function templateArtifact() {
  const root = await temporary();
  template.artifact = join(root, 'template.json');
  const files = {
    'package.json': JSON.stringify({ name: 'platform', type: 'module', private: true, workspaces: ['catalog'], scripts: { dev: 'node scripts/dev.mjs', build: 'node scripts/build.mjs', preview: 'node scripts/serve.mjs', typecheck: 'tsc --noEmit' }, devDependencies: { '@kanso/cli': '0.5.0', '@kanso/vite': '0.5.0' } }),
    'scripts/dev.mjs': 'console.log("Development platform");\n',
    'scripts/build.mjs': 'console.log("Build platform");\n',
    'scripts/serve.mjs': 'console.log("Serve platform");\n',
    'host/src/App.tsx': 'export function App() {\n  return <main>Shell</main>;\n}\n',
    'catalog/package.json': JSON.stringify({ name: 'catalog', type: 'module', private: true, dependencies: { '@kanso/core': '0.5.0', '@kanso/microfrontends': '0.5.0' }, devDependencies: { '@kanso/vite': '0.5.0', vite: '8.3.0' }, scripts: { build: 'node scripts/build.mjs', typecheck: 'tsc --noEmit' } }),
    'catalog/src/Card.tsx': 'export function Card() {\n  return <article>Catalog</article>;\n}\n',
    'catalog/scripts/dev.mjs': 'console.log("Development remote");\n',
    'catalog/scripts/build.mjs': 'console.log("Build remote");\n',
    'catalog/scripts/serve.mjs': 'console.log("Serve remote");\n',
  };
  await writeFile(template.artifact, JSON.stringify(files));
  return files;
}

async function installManifest(root: string, name: string, version: string, dependencies: Record<string, string> = {}) {
  const directory = join(root, 'node_modules', name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version, dependencies }));
}

async function doctorFixture() {
  const root = await temporary();
  const pkg = { name: 'platform', version: '1.0.0', dependencies: { '@kanso/core': '0.6.1', '@kanso/microfrontends': '0.6.1' }, devDependencies: { '@kanso/vite': '0.6.1', vite: '8.3.0' } };
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
  await installManifest(root, '@kanso/core', '0.6.1', { 'solid-js': '1.9.15' });
  await installManifest(root, '@kanso/app', '0.6.1', { '@kanso/core': '0.6.1', '@solidjs/router': '0.16.3' });
  await installManifest(root, '@kanso/microfrontends', '0.6.1', { '@kanso/core': '0.6.1', '@kanso/app': '0.6.1' });
  await installManifest(root, '@kanso/vite', '0.6.1');
  await installManifest(root, '@solidjs/router', '0.16.3');
  await installManifest(root, 'solid-js', '1.9.15');
  await installManifest(root, 'vite', '8.3.0');
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'preserve', jsxImportSource: '@kanso/core' } }));
  await writeFile(join(root, 'vite.config.ts'), "import { defineConfig } from 'vite';\nimport kanso from '@kanso/vite';\nexport default defineConfig({ plugins: [kanso()] });\n");
  await writeFile(join(root, 'kanso.microfrontends.json'), JSON.stringify({ remotes: [{ name: 'catalog', contract: '^1.0.0', manifest: 'http://127.0.0.1:9/catalog/kanso-remote.json' }] }));
  return { root, pkg };
}

it('scaffolds the complete readable platform and rewrites all seven local packages', async () => {
  const files = await templateArtifact();
  const parent = await temporary();
  const root = join(parent, 'platform');
  const workspace = '/workspace with spaces/kanso';
  await createProject(root, workspace, { template: 'microfrontends' });
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  for (const name of KANSO_PACKAGES) expect(pkg.devDependencies[`@kanso/${name}`]).toBe(`file:${workspace}/packages/${name}`);
  expect(Object.keys(pkg.scripts)).toEqual(expect.arrayContaining(['dev', 'build', 'preview', 'typecheck']));
  expect(await readFile(join(root, 'host/src/App.tsx'), 'utf8')).toBe(files['host/src/App.tsx']);
  const remote = JSON.parse(await readFile(join(root, 'catalog/package.json'), 'utf8'));
  expect(remote.dependencies['@kanso/core']).toBe(`file:${workspace}/packages/core`);
  await expect(createProject(root, undefined, { template: 'remote' })).rejects.toThrow('destination must be empty');
  expect(await readFile(join(root, 'host/src/App.tsx'), 'utf8')).toBe(files['host/src/App.tsx']);
});

it('scaffolds a standalone remote without copying the shell and targets the current release', async () => {
  await templateArtifact();
  const root = join(await temporary(), 'remote');
  await createProject(root, undefined, { template: 'remote' });
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  expect(pkg.dependencies['@kanso/core']).toBe('^0.6.1');
  expect(pkg.dependencies['@kanso/microfrontends']).toBe('^0.6.1');
  expect(pkg.scripts).toMatchObject({ dev: 'node scripts/dev.mjs', build: 'node scripts/build.mjs', preview: 'node scripts/serve.mjs', typecheck: 'tsc --noEmit' });
  expect(await readdir(root)).not.toContain('host');
  expect(await readdir(root)).not.toContain('catalog');
  expect(await readFile(join(root, 'src/Card.tsx'), 'utf8')).toContain('<article>Catalog</article>');
});

it('rejects malformed template artifacts before writing project files', async () => {
  const files = await templateArtifact();
  await writeFile(template.artifact, JSON.stringify({ ...files, '../outside.txt': 'Unsafe' }));
  const root = join(await temporary(), 'unsafe');
  await expect(createProject(root, undefined, { template: 'microfrontends' })).rejects.toThrow('Unsafe packaged template path');
  expect(await readdir(root)).toEqual([]);
});

it('doctor checks static remotes and direct object-returning Vite callbacks without network or execution', async () => {
  const { root } = await doctorFixture();
  const fetcher = vi.fn(() => { throw new Error('Doctor must not fetch remote configuration'); });
  vi.stubGlobal('fetch', fetcher);
  await writeFile(join(root, 'vite.config.ts'), "import {defineConfig} from 'vite';\nimport kanso from '@kanso/vite';\nthrow new Error('Never execute config');\nexport default defineConfig(({isSsrBuild}) => ({ base: isSsrBuild ? '/server/' : '/', plugins: [kanso({microfrontends:{name:'catalog'}})] }));\n");
  expect((await doctor({ root })).diagnostics).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await readdir(root)).not.toContain('kanso-remotes.lock.json');
});

it('doctor explains missing microfrontend dependencies and malformed static configuration', async () => {
  const { root, pkg } = await doctorFixture();
  delete (pkg.dependencies as Record<string, string>)['@kanso/microfrontends'];
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
  await writeFile(join(root, 'kanso.microfrontends.json'), JSON.stringify({ remotes: [{ name: '../invalid', contract: '^1', manifest: 'http://localhost/' }] }));
  const report = await doctor({ root });
  expect(report.diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'MF_PACKAGE_REQUIRED', severity: 'error' }),
    expect.objectContaining({ code: 'MF_CONFIG_INVALID', severity: 'error' }),
  ]));
});

it('doctor detects duplicate shared Kanso runtimes and exact-version mismatches', async () => {
  const { root, pkg } = await doctorFixture();
  (pkg.dependencies as Record<string, string>)['legacy-widget'] = '1.0.0';
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
  await installManifest(root, 'legacy-widget', '1.0.0', { '@kanso/core': '0.5.0' });
  await installManifest(join(root, 'node_modules/legacy-widget'), '@kanso/core', '0.5.0');
  const report = await doctor({ root });
  expect(report.diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'MF_RUNTIME_DUPLICATE' }),
    expect.objectContaining({ code: 'MF_RUNTIME_VERSION' }),
  ]));
});

it('CLI exposes microfrontend commands, JSON reports and 0/2/1 exit codes', async () => {
  await mkdir('output', { recursive: true });
  const binRoot = await mkdtemp(resolve('output/microfrontend-cli-')); roots.push(binRoot);
  const bin = join(binRoot, 'kanso.mjs');
  await build({ entryPoints: ['packages/cli/src/bin.ts'], outfile: bin, bundle: true, packages: 'external', external: ['@kanso/*'], platform: 'node', format: 'esm', target: 'es2022' });
  const root = await temporary();
  await writeFile(join(root, 'kanso.microfrontends.json'), JSON.stringify({ remotes: [] }));
  const command = (...args: string[]) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
  const help = command('--help');
  expect(help.status, help.stderr).toBe(0);
  expect(help.stdout).toContain('microfrontends sync|check');
  expect(help.stdout).toContain('csr|ssr|microfrontends|remote');
  const sync = command('microfrontends', 'sync', '--root', root, '--json');
  expect(sync.status, sync.stderr).toBe(0);
  expect(JSON.parse(sync.stdout).written).toContain('kanso-remotes.lock.json');
  const check = command('microfrontends', 'check', '--root', root, '--json');
  expect(check.status, check.stderr).toBe(0);
  expect(JSON.parse(check.stdout).written).toEqual([]);
  await writeFile(join(root, 'kanso.microfrontends.json'), 'not json');
  const invalid = command('microfrontends', 'check', '--root', root, '--json');
  expect(invalid.status).toBe(2);
  expect(JSON.parse(invalid.stdout).diagnostics[0].severity).toBe('error');
  expect(command('microfrontends', 'check', '--root', join(root, 'missing')).status).toBe(1);
  expect(command('microfrontends', 'check', '--root', '--json').status).toBe(1);
});
