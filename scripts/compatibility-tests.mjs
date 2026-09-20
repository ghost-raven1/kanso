import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { compile } from '@kanso/compiler';
import { chromium, firefox, webkit } from 'playwright';

const directory = resolve('output/compatibility');
await mkdir(directory, { recursive: true });
for (const server of [true, false]) {
  await build({
    stdin: { contents: server
      ? `import {renderToString,generateHydrationScript} from 'solid-js/web';import {App} from './jsx-compatibility';export const html=()=>generateHydrationScript()+renderToString(App);`
      : `import {hydrateRoot} from '@kanso/core/client';import {App,trace} from './jsx-compatibility';window.dispose=hydrateRoot(App,document.querySelector('#root'));window.trace=trace;window.ready=true;`,
      resolveDir: resolve('scripts/fixtures'), loader: 'js' },
    outfile: resolve(directory, server ? 'server.mjs' : 'client.js'),
    bundle: true, format: 'esm', platform: server ? 'node' : 'browser',
    conditions: server ? ['node'] : ['browser'], tsconfigRaw: {},
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'compiled-fixture', setup(builder) {
      builder.onLoad({ filter: /jsx-compatibility\.tsx$/ }, async ({ path }) => ({
        contents: compile(await readFile(path, 'utf8'), { filename: path, generate: server ? 'ssr' : 'dom' }).code,
        loader: 'js',
      }));
    } }],
  });
}
const { html } = await import(pathToFileURL(resolve(directory, 'server.mjs')).href);
const script = await readFile(resolve(directory, 'client.js'));
const server = createServer((request, response) => {
  if (request.url === '/client.js') { response.setHeader('content-type', 'text/javascript'); response.end(script); return; }
  response.setHeader('content-type', 'text/html');
  response.end(`<!doctype html><html><head><title>JSX contracts</title></head><body><div id="root">${html()}</div><script type="module" src="/client.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  const responses = await Promise.all([fetch(origin), fetch(origin)]);
  const documents = await Promise.all(responses.map(response => response.text()));
  assert.equal(documents[0], documents[1], 'separate SSR renders retain deterministic hydration IDs');
  assert.match(documents[0], /<strong>Server markup<\/strong>/);
  assert.doesNotMatch(documents[0], /dangerouslysetinnerhtml/i);
  assert.match(documents[0], /<output[^>]*data-summary[^>]*>/);
  assert.match(documents[0], /FIRST/);
  assert.match(documents[0], /<span[^>]*data-title[^>]*>first<\/span>/);
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    if (process.env.KANSO_BROWSERS && !process.env.KANSO_BROWSERS.split(',').includes(name)) continue;
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await page.route('**/client.js', async route => { await gate; await route.continue(); });
      await page.goto(origin, { waitUntil: 'commit' });
      await page.locator('[data-editor]').first().waitFor();
      await page.evaluate(() => {
        window.before = [...document.querySelectorAll('[data-editor],article strong,aside strong')];
        const input = document.querySelector('input');
        input.value = 'Draft before hydration'; input.focus();
      });
      release();
      await page.waitForFunction(() => window.ready);
      assert.equal(await page.evaluate(() => window.before.every(node => node.isConnected)), true, `${name}: hydration adopts keyed and raw HTML nodes`);
      assert.equal(await page.getByLabel('Draft', { exact: true }).first().inputValue(), 'Draft before hydration');
      assert.equal(await page.locator('[data-summary]').textContent(), 'FIRSTfirst');
      assert.equal(await page.locator('input').evaluateAll(nodes => new Set(nodes.map(node => node.id)).size), 2);
      await page.locator('[data-count]').first().click();
      await page.locator('[data-count]').last().click();
      await page.locator('[data-count]').last().click();
      await page.locator('#reset').click();
      assert.deepEqual(await page.locator('[data-count]').allTextContents(), ['0', '2']);
      assert.equal(await page.locator('[data-summary]').textContent(), 'NEXTnext');
      assert.equal(await page.evaluate(() => trace.summaries), 1, 'context selectors and memo patterns retain one component setup');
      assert.equal(await page.evaluate(() => window.before[0].isConnected), false);
      assert.equal(await page.evaluate(() => window.before[1].isConnected), true);
      assert.deepEqual(await page.evaluate(() => ({ parents: trace.parents, mounts: trace.mounts, cleanups: trace.cleanups, released: trace.refs[0].current === null })),
        { parents: 1, mounts: 3, cleanups: 1, released: true });
      assert.equal(await page.locator('input').evaluateAll(nodes => new Set(nodes.map(node => node.id)).size), 2);
      await page.locator('#update').click();
      for (const selector of ['article', 'aside']) assert.equal(await page.locator(selector).innerHTML(), '<em>Updated markup</em>');
      await page.locator('#clear').click();
      for (const selector of ['article', 'aside']) assert.equal(await page.locator(selector).innerHTML(), '');
      await page.evaluate(() => window.dispose());
      assert.equal(await page.evaluate(() => trace.cleanups), 3);
      assert.equal(await page.evaluate(() => trace.refs.every(ref => ref.current === null)), true);
      assert.deepEqual(errors, []);
      results.push({ browser: name, passed: true });
      console.log(`${name}: key reset, independent state, raw HTML, SSR hydration and cleanup passed`);
    } finally { await browser.close(); }
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await writeFile(resolve(directory, 'results.json'), JSON.stringify(results, null, 2));
}
