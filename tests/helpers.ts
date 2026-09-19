import { compile } from '@kanso/compiler';
import { build } from 'esbuild';
import { posix } from 'node:path';

/** Execute real compiled browser code with one shared Solid instance. */
export async function browserModule<T>(source: string): Promise<T> {
  const { code } = compile(source);
  const result = await build({
    stdin: { contents: code, resolveDir: process.cwd(), sourcefile: 'fixture.js' },
    bundle: true, platform: 'browser', format: 'cjs', write: false,
    conditions: ['browser'], define: { 'process.env.NODE_ENV': '"production"' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  return module.exports as T;
}

/** Compile every fixture module separately to exercise the public cross-module ABI. */
export async function browserModules<T>(sources: Record<string, string>, entry = 'App.tsx'): Promise<T> {
  const code = new Map(Object.entries(sources).map(([file, source]) => [file, compile(source, { filename: file }).code]));
  const result = await build({
    entryPoints: ['fixture:entry'], bundle: true, platform: 'browser', format: 'cjs', write: false,
    conditions: ['browser'], define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'fixture-modules', setup(builder) {
      builder.onResolve({ filter: /^fixture:entry$/ }, () => ({ path: entry, namespace: 'fixture' }));
      builder.onResolve({ filter: /^\./, namespace: 'fixture' }, args => {
        const base = posix.join(posix.dirname(args.importer), args.path);
        const file = ['', '.ts', '.tsx', '/index.ts'].map(suffix => base + suffix).find(file => code.has(file));
        return file ? { path: file, namespace: 'fixture' } : { errors: [{ text: `Missing fixture ${base}` }] };
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: code.get(args.path), loader: 'js', resolveDir: process.cwd() }));
    } }],
  });
  const module = { exports: {} };
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  return module.exports as T;
}
