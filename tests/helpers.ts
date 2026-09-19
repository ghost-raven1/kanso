import { compile } from '@kanso/compiler';
import { build } from 'esbuild';

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
