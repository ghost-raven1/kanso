import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm, readFile } from 'node:fs/promises';
import { transformSync } from '@babel/core';
import solid from 'babel-preset-solid';

const entries = {
  core: ['index', 'internal', 'client', 'jsx-runtime'],
  compiler: ['index'], vite: ['index'], app: ['index', 'server', 'node'], cli: ['index', 'bin'],
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
    outdir: `packages/${name}/dist`, bundle: true, splitting: true, packages: 'external',
    platform: name === 'core' || name === 'app' ? 'neutral' : 'node',
    format: 'esm', target: 'es2022', sourcemap: true,
  });
}
execFileSync('node_modules/.bin/tsc', ['--declaration', '--emitDeclarationOnly', '--outDir', '.types'], { stdio: 'inherit' });
for (const name of Object.keys(entries)) {
  await mkdir(`packages/${name}/dist`, { recursive: true });
  await cp(`.types/packages/${name}/src`, `packages/${name}/dist`, { recursive: true });
}
await rm('.types', { recursive: true, force: true });
