import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, firefox, webkit } from 'playwright';
import { run, start, stop } from './test-project.mjs';

await mkdir('output/workers', { recursive: true });
const workspace = JSON.parse(await readFile('package.json', 'utf8'));
const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', resolve('output/workers')], { cwd: 'packages/workers', encoding: 'utf8' }))[0];
const root = await mkdtemp(resolve('output/workers/project-'));
await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { '@kanso/workers': `file:${resolve('output/workers', packed.filename)}` }, devDependencies: { vite: workspace.devDependencies.vite, typescript: workspace.devDependencies.typescript } }));
await writeFile(join(root, 'index.html'), '<!doctype html><html><head><title>Worker checks</title></head><body><button id="run">Run worker checks</button><output id="result"></output><script type="module" src="/main.ts"></script></body></html>');
await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, skipLibCheck: true, lib: ['ES2022', 'DOM'] }, include: ['*.ts'] }));
await writeFile(join(root, 'tasks.worker.ts'), `
import { exposeWorker, type WorkerContext } from '@kanso/workers/worker';
let cancelled = 0;
export const tasks = {
  delay: (ms: number) => new Promise<number>(resolve => setTimeout(() => resolve(ms), ms)),
  ping: () => cancelled,
  wait: (_input: null, { signal }: WorkerContext) => new Promise<void>(resolve => {
    signal.addEventListener('abort', () => { cancelled++; resolve(); }, { once: true });
  }),
  transfer: (input: Uint8Array, context: WorkerContext) => {
    input[0]++; context.transfer(input.buffer as ArrayBuffer); return input;
  },
  fail: () => { throw new TypeError('Task rejected'); },
  invalid: () => () => 'not cloneable',
};
exposeWorker(tasks);
`);
await writeFile(join(root, 'crash.worker.ts'), "throw new Error('Intentional worker crash'); export {};\n");
await writeFile(join(root, 'main.ts'), `
import { createWorker } from '@kanso/workers';
import type { tasks } from './tasks.worker';
const verify = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
async function checks() {
  let created = 0;
  const client = createWorker<typeof tasks>(() => { created++; return new Worker(new URL('./tasks.worker.ts', import.meta.url), { type: 'module' }); });
  verify(created === 0, 'Worker must be lazy');
  const order: number[] = [];
  const values = await Promise.all([30, 1].map(ms => client.call('delay', ms).then(value => { order.push(value); return value; })));
  verify(values.join() === '30,1' && order.join() === '1,30', 'Concurrent responses must match requests');
  verify(created === 1, 'Calls must share one owned worker');
  const controller = new AbortController();
  const waiting = client.call('wait', null, { signal: controller.signal }).then(() => 'resolved', error => error.name);
  await client.call('ping', undefined);
  controller.abort();
  verify(await waiting === 'AbortError', 'Cancellation must reject the caller');
  verify(await client.call('ping', undefined) === 1, 'Worker must receive cancellation');
  const bytes = new Uint8Array([5]);
  const transferred = client.call('transfer', bytes, { transfer: [bytes.buffer] });
  verify(bytes.byteLength === 0, 'Input ownership must transfer');
  verify((await transferred)[0] === 6, 'Output ownership must transfer back');
  const failure = await client.call('fail', undefined).catch(error => ({ name: error.name, message: error.message }));
  verify(failure.name === 'TypeError' && failure.message === 'Task rejected', 'Task errors must cross the boundary');
  verify(await client.call('invalid', undefined).then(() => '', error => error.name) === 'DataCloneError', 'Non-cloneable output must reject');
  const disposed = client.call('wait', null).then(() => '', error => error.message);
  client.terminate();
  verify((await disposed).includes('terminated'), 'Terminate must reject pending work');
  verify((await client.call('ping', undefined).then(() => '', error => error.message)).includes('terminated'), 'Closed worker must reject new calls');
  const crashed = createWorker<{ ping: () => number }>(() => new Worker(new URL('./crash.worker.ts', import.meta.url), { type: 'module' }));
  const nativeError = await crashed.call('ping', undefined).then(() => '', error => error.message);
  verify(nativeError.length > 0, 'Native worker failures must reject pending calls');
  crashed.terminate();
  return { lazy: true, concurrent: true, cancellation: true, transfer: true, errors: true, teardown: true };
}
document.querySelector('#run')!.addEventListener('click', () => {
  checks().then(result => { document.querySelector('#result')!.textContent = JSON.stringify(result); }, error => { document.querySelector('#result')!.textContent = JSON.stringify({ error: error.message }); });
});
`);

run(root, 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--workspaces=false']);
run(root, process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']);
run(root, process.execPath, ['node_modules/vite/bin/vite.js', 'build']);
const engines = { chromium, firefox, webkit };
const names = (process.env.KANSO_BROWSERS ?? 'chromium,firefox,webkit').split(',');
const results = [];
let server;
try {
  server = await start(root, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4191', '--strictPort'], 4191);
  for (const name of names) {
    const browser = await engines[name].launch();
    try {
      const page = await browser.newPage();
      await page.goto('http://127.0.0.1:4191');
      await page.locator('#run').click();
      await page.waitForFunction(() => document.querySelector('#result')?.textContent);
      const result = JSON.parse(await page.locator('#result').textContent());
      assert.equal(result.error, undefined, result.error);
      assert.equal(result.transfer, true);
      results.push({ browser: name, ...result });
      console.log('Web Worker acceptance passed:', name);
    } finally { await browser.close(); }
  }
  await writeFile('output/workers/results.json', JSON.stringify({ packedInstall: true, typecheck: true, productionBuild: true, scenarios: results }, null, 2));
} finally { await stop(server); }
