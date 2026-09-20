import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { transformSync } from '@babel/core';
import solid from 'babel-preset-solid';

const entries = {
  core: ['index', 'internal', 'client', 'jsx-runtime', 'hmr', 'testing'],
  compiler: ['index'], vite: ['index', 'testing'], app: ['index', 'server', 'node', 'seo', 'microfrontends', 'router-runtime'], cli: ['index', 'bin'], microfrontends: ['index', 'server', 'browser', 'manifest'], workers: ['index', 'worker', 'service', 'service-runtime'],
};
for (const [name, files] of Object.entries(entries)) {
  await rm(`packages/${name}/dist`, { recursive: true, force: true });
  if (name === 'app') await rm('packages/app/dist-server', { recursive: true, force: true });
  if (name === 'app') {
    for (const generate of ['dom', 'ssr']) {
      await build({
        entryPoints: files.map(file => `packages/app/src/${file}.ts`),
        outdir: generate === 'ssr' ? 'packages/app/dist-server' : 'packages/app/dist',
        bundle: true, splitting: true, format: 'esm', platform: 'neutral', target: 'es2022', sourcemap: true,
        conditions: ['solid', generate === 'ssr' ? 'node' : 'browser'],
        external: ['solid-js', 'solid-js/*', '@kanso/*', 'node:*'],
        plugins: [{ name: 'solid-library', setup(builder) {
          builder.onLoad({ filter: /\.jsx$/ }, async args => ({
            contents: transformSync(await readFile(args.path, 'utf8'), { filename: args.path, babelrc: false, configFile: false,
              presets: [[solid, { generate, hydratable: true }]] }).code,
            loader: 'js',
          }));
        } }],
      });
    }
    continue;
  }
  await build({
    entryPoints: files.map(file => `packages/${name}/src/${file}.ts`),
    outdir: `packages/${name}/dist`, bundle: true, splitting: true, packages: 'external', external: ['@kanso/*'],
    platform: ['core', 'app', 'microfrontends', 'workers'].includes(name) ? 'neutral' : 'node',
    format: 'esm', target: 'es2022', sourcemap: true,
  });
}
execFileSync('node_modules/.bin/tsc', ['--declaration', '--emitDeclarationOnly', '--outDir', '.types'], { stdio: 'inherit' });
for (const name of Object.keys(entries)) {
  await mkdir(`packages/${name}/dist`, { recursive: true });
  await cp(`.types/packages/${name}/src`, `packages/${name}/dist`, { recursive: true });
}
await rm('.types', { recursive: true, force: true });

const templateRoot = path.resolve('examples/microfrontends');
const template = {};
for (const entry of await readdir(templateRoot, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const file = path.join(entry.parentPath, entry.name);
  const relative = path.relative(templateRoot, file).replaceAll('\\', '/');
  if (relative.split('/').some(part => ['dist', 'dist-server', 'node_modules', 'output', '.vite', '.kanso-types'].includes(part) || part.startsWith('.kanso-build-'))) continue;
  if (['package-lock.json', '.DS_Store'].includes(entry.name)) continue;
  template[relative] = await readFile(file, 'utf8');
}
await mkdir('packages/cli/dist/templates', { recursive: true });
await writeFile('packages/cli/dist/templates/microfrontends.json', JSON.stringify(template, null, 2) + '\n');
