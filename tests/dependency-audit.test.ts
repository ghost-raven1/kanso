import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { doctor, migrate, migrateSource } from '@kanso/cli';
import { createDependencyAudit } from '../packages/cli/src/dependency-audit.js';
import { runtimeImports } from '../packages/cli/src/runtime-imports.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  );
});
const optional = {
  peerDependencies: { react: '*' },
  peerDependenciesMeta: { react: { optional: true } },
};
async function write(root: string, name: string, source: string) {
  const file = join(root, name);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, source);
}
async function pkg(
  root: string,
  name: string,
  files: Record<string, string>,
  manifest = {},
) {
  await write(
    root,
    `node_modules/${name}/package.json`,
    JSON.stringify({ name, version: '1.0.0', ...manifest }),
  );
  for (const [file, source] of Object.entries(files))
    await write(root, `node_modules/${name}/${file}`, source);
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kanso-dependency-'));
  roots.push(root);
  await write(
    root,
    'package.json',
    JSON.stringify({
      type: 'module',
      dependencies: { react: '*', 'react-dom': '*', 'dual-store': '*' },
    }),
  );
  await write(
    root,
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        jsx: 'react-jsx',
        baseUrl: '.',
        paths: { '@/*': ['src/*'] },
      },
    }),
  );
  await write(
    root,
    'vite.config.ts',
    `import { defineConfig } from 'vite';import react from '@vitejs/plugin-react';export default defineConfig({plugins:[react()]});`,
  );
  await write(
    root,
    'index.html',
    '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  );
  await write(
    root,
    'src/main.tsx',
    `import { createRoot } from 'react-dom/client';import { App } from './App';createRoot(document.getElementById('root')).render(<App/>);`,
  );
  await write(
    root,
    'src/App.tsx',
    `import { value } from '@/store';export function App(){return <p>{value}</p>}`,
  );
  await write(
    root,
    'src/store.ts',
    `export { value } from 'dual-store/vanilla';`,
  );
  await pkg(
    root,
    'dual-store',
    {
      'index.js': `export * from './vanilla.js';export * from './react.js';`,
      'react.js': `import { useState } from 'react'; export const useStore = useState;`,
      'vanilla.js': 'export const value = 3;',
      'vanilla.cjs': 'exports.value = 3;',
    },
    {
      ...optional,
      exports: {
        '.': './index.js',
        './vanilla': {
          import: { types: './missing.d.ts', default: './vanilla.js' },
          require: './vanilla.cjs',
        },
      },
    },
  );
  return root;
}

it('migrates a proven vanilla subpath through aliases and barrels without allowing the React root', async () => {
  const root = await fixture();
  const result = await migrate({ root, apply: true, local: process.cwd() });
  expect(result.diagnostics).toEqual([]);
  expect(result.applied).toBe(true);
  expect((await migrate({ root })).changes).toEqual([]);
  await pkg(root, '@kanso/core', {});
  expect(
    (await doctor({ root })).diagnostics.filter(item =>
      ['DEPENDENCY_AUDIT', 'REACT_DEPENDENCY'].includes(item.code),
    ),
  ).toEqual([]);
  await write(root, 'src/store.ts', `export { value } from 'dual-store';`);
  const before = await readFile(join(root, 'src/App.tsx'), 'utf8');
  const blocked = await migrate({ root, apply: true });
  expect(blocked.applied).toBe(false);
  expect(blocked.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'REACT_DEPENDENCY',
      file: 'src/store.ts',
      message: expect.stringContaining('react'),
    }),
  );
  expect(await readFile(join(root, 'src/App.tsx'), 'utf8')).toBe(before);
  expect((await doctor({ root })).diagnostics).toContainEqual(
    expect.objectContaining({ code: 'REACT_DEPENDENCY', file: 'src/store.ts' }),
  );
});

it.each([
  ['ESM re-export', `export * from './react.js';`],
  ['static import()', `export const load = () => import('./react.js');`],
  [
    'CommonJS require',
    `const hooks = require('./react.js');exports.hooks = hooks;`,
  ],
  ['React subpath', `export * from 'react/jsx-runtime';`],
  ['React DOM subpath', `export * from 'react-dom/server';`],
])('blocks %s inside the vanilla entry before writing', async (_name, code) => {
  const root = await fixture();
  await write(root, 'node_modules/dual-store/vanilla.js', code);
  const before = await readFile(join(root, 'package.json'), 'utf8');
  const report = await migrate({ root, apply: true });
  expect(report.applied).toBe(false);
  expect(
    report.diagnostics.some(item => item.code === 'REACT_DEPENDENCY'),
  ).toBe(true);
  expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(before);
});

it.each([
  `export const load = path => import(path);`,
  `const path = './react.js';require(path);`,
  `const load = require;load('./react.js');`,
  `module.require('./react.js');`,
  `import { createRequire } from 'node:module';const load = createRequire(import.meta.url);load('./react.js');`,
  `eval('require("react")');`,
  `export const modules = import.meta.glob('./*.js');`,
  `export * from './missing.js';`,
])('refuses an unprovable dependency graph: %s', async code => {
  const root = await fixture();
  await write(root, 'node_modules/dual-store/vanilla.js', code);
  const result = await migrate({ root, apply: true });
  expect(result.applied).toBe(false);
  expect(result.coverage?.complete).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'DEPENDENCY_AUDIT',
      hint: expect.stringContaining('vanilla'),
    }),
  );
});

it('checks every imported entry even after another entry of the same physical package passed', async () => {
  const root = await fixture();
  await write(
    root,
    'src/store.ts',
    `export * from 'dual-store/vanilla';export * from 'dual-store';`,
  );
  const report = await migrate({ root, apply: true });
  expect(report.applied).toBe(false);
  expect(
    report.diagnostics.some(item => item.code === 'REACT_DEPENDENCY'),
  ).toBe(true);
});

it.each(['browser', 'node', 'development', 'production', 'require'])(
  'audits %s conditional targets as well as the default',
  async condition => {
    const root = await fixture();
    const file = join(root, 'node_modules/dual-store/package.json');
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    manifest.exports['./vanilla'] = {
      [condition]: './react.js',
      default: './vanilla.js',
    };
    await writeFile(file, JSON.stringify(manifest));
    await expect(
      createDependencyAudit().check(root, 'dual-store/vanilla'),
    ).rejects.toMatchObject({ code: 'REACT_DEPENDENCY' });
  },
);

it.each(['./react.js', 'react'])(
  'audits browser-map replacements: %s',
  async target => {
    const root = await fixture();
    const file = join(root, 'node_modules/dual-store/package.json');
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    manifest.browser = { './vanilla.js': target };
    await writeFile(file, JSON.stringify(manifest));
    await expect(
      createDependencyAudit().check(root, 'dual-store/vanilla'),
    ).rejects.toMatchObject({ code: 'REACT_DEPENDENCY' });
  },
);

it('follows transitive subpaths, package imports and cycles without confusing physical installations', async () => {
  const root = await fixture();
  await write(
    root,
    'node_modules/dual-store/vanilla.js',
    `export * from 'utility/vanilla';`,
  );
  await pkg(
    root,
    'utility',
    {
      'vanilla.js': `export * from '#value';`,
      'value.js': `export * from './vanilla.js';export const value=5;`,
    },
    { exports: { './*': './*.js' }, imports: { '#value': './value.js' } },
  );
  await expect(
    createDependencyAudit().check(root, 'dual-store/vanilla'),
  ).resolves.toBeUndefined();
  await pkg(
    join(root, 'node_modules/dual-store'),
    'utility',
    { 'vanilla.js': `export * from 'react';` },
    { exports: { './*': './*.js' } },
  );
  await expect(
    createDependencyAudit().check(root, 'dual-store/vanilla'),
  ).rejects.toMatchObject({ code: 'REACT_DEPENDENCY' });
});

it('respects null subpath exclusions and does not fall back to main', async () => {
  const root = await fixture();
  const file = join(root, 'node_modules/dual-store/package.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.exports = { './*': './*.js', './vanilla': null };
  await writeFile(file, JSON.stringify(manifest));
  await expect(
    createDependencyAudit().check(root, 'dual-store/vanilla'),
  ).rejects.toMatchObject({ code: 'DEPENDENCY_AUDIT' });
});

it('does not grant exceptions to mandatory React peers or dependencies', async () => {
  const root = await fixture();
  const file = join(root, 'node_modules/dual-store/package.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  delete manifest.peerDependenciesMeta;
  await writeFile(file, JSON.stringify(manifest));
  await expect(
    createDependencyAudit().check(root, 'dual-store/vanilla'),
  ).rejects.toMatchObject({ code: 'REACT_DEPENDENCY' });
  Object.assign(manifest, optional, { dependencies: { react: '*' } });
  await writeFile(file, JSON.stringify(manifest));
  await expect(
    createDependencyAudit().check(root, 'dual-store/vanilla'),
  ).rejects.toMatchObject({ code: 'REACT_DEPENDENCY' });
});

it('does not execute configuration and blocks an incomplete graph rather than relaxing declarations', async () => {
  const root = await fixture();
  await write(
    root,
    'vite.config.ts',
    `throw new Error('Never execute this');export default () => readUnknownConfig();`,
  );
  const result = await migrate({ root, apply: true });
  expect(result.applied).toBe(false);
  expect(result.coverage?.complete).toBe(false);
  expect(
    result.diagnostics.some(item => item.code === 'VITE_CONFIG_DYNAMIC'),
  ).toBe(true);
  expect(
    (await doctor({ root })).diagnostics.some(
      item => item.code === 'DEPENDENCY_AUDIT',
    ),
  ).toBe(true);
});

it('ignores explicit type-only edges and shadowed require but detects runtime exports', () => {
  expect(
    runtimeImports(
      `import type {A} from 'react';import {type B} from 'react';export type * from 'react';export {type A} from 'react';const helper = (require: (s:string)=>string) => require('react');export {value} from 'store/vanilla';`,
      'test.ts',
    ),
  ).toEqual(['store/vanilla']);
});

it('keeps unused optional-peer dependencies conservative and does not use types as proof', async () => {
  const root = await fixture();
  await write(
    root,
    'src/store.ts',
    `import type { Store } from 'dual-store/vanilla';export const value=3;`,
  );
  const report = await migrate({ root, apply: true });
  expect(report.applied).toBe(false);
  expect(report.diagnostics).toContainEqual(
    expect.objectContaining({ file: 'package.json', code: 'REACT_DEPENDENCY' }),
  );
});

it('doctor checks a React entry imported from devDependencies', async () => {
  const root = await fixture();
  await write(
    root,
    'package.json',
    JSON.stringify({
      dependencies: {},
      devDependencies: { 'dual-store': '*' },
    }),
  );
  await write(
    root,
    'src/main.tsx',
    `import { value } from 'dual-store';console.log(value);`,
  );
  const report = await doctor({ root });
  expect(report.diagnostics).toContainEqual(
    expect.objectContaining({ file: 'src/main.tsx', code: 'REACT_DEPENDENCY' }),
  );
});

it('checks legacy main/module entries and package import alias cycles', async () => {
  const root = await fixture();
  await pkg(
    root,
    'legacy',
    { 'esm.js': 'export const value=1;', 'cjs.cjs': 'exports.value=1;' },
    { ...optional, main: './cjs.cjs', module: './esm.js' },
  );
  await expect(
    createDependencyAudit().check(root, 'legacy'),
  ).resolves.toBeUndefined();
  await write(root, 'node_modules/legacy/cjs.cjs', `require('react');`);
  await expect(
    createDependencyAudit().check(root, 'legacy'),
  ).rejects.toMatchObject({ code: 'REACT_DEPENDENCY' });
  await pkg(
    root,
    'cycle',
    { 'index.js': `export * from '#one';` },
    { ...optional, imports: { '#one': '#two', '#two': '#one' } },
  );
  await expect(
    createDependencyAudit().check(root, 'cycle'),
  ).rejects.toMatchObject({ code: 'DEPENDENCY_AUDIT' });
});

it.each([
  `const React = require('react');`,
  `const load = () => import('react');`,
  `export { useState } from 'react';`,
  `export * from 'react';`,
  `import React = require('react');`,
])('does not leave an unmigrated React runtime edge: %s', async code => {
  const root = await fixture();
  await write(root, 'src/store.ts', `${code}\nexport const value=3;`);
  const report = await migrate({ root, apply: true });
  expect(report.applied).toBe(false);
  expect(report.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'REACT_IMPORT' }),
  );
});

it('does not treat a shadowed require as a React runtime import', () => {
  expect(
    migrateSource(
      `function local(require){return require('react')}`,
      'helper.ts',
    ).diagnostics,
  ).toEqual([]);
});
