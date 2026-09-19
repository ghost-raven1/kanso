import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';

const output = resolve('output/service-workers');
await mkdir(output, { recursive: true });
const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', output], { cwd: 'packages/workers', encoding: 'utf8' }))[0];
const project = await mkdtemp(join(output, 'installed-'));
await writeFile(join(project, 'package.json'), JSON.stringify({ type: 'module', dependencies: { '@kanso/workers': `file:${join(output, packed.filename)}` } }));
execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--workspaces=false'], { cwd: project, stdio: 'pipe' });
await writeFile(join(project, 'main.js'), `
  import {createServiceWorker} from '@kanso/workers/service';
  window.service = createServiceWorker('/service-worker.js');
  window.states = [];
  window.service.subscribe(state => {
    window.states.push(state.status);
    document.querySelector('output').textContent = state.status;
  });
  document.querySelector('#install').onclick = () => window.service.register();
  document.querySelector('#activate').onclick = () => window.service.activateUpdate();
`);
await writeFile(join(project, 'service.js'), `
  import {defineServiceWorker,installServiceWorker} from '@kanso/workers/service-runtime';
  installServiceWorker(defineServiceWorker({
    version: RELEASE,
    offlineFallback: '/offline.html',
    routes: [{match: ({url}) => url.pathname.startsWith('/releases/'), strategy: 'cache-first'}],
  }));
`);
const client = await build({ entryPoints: [join(project, 'main.js')], bundle: true, write: false, format: 'esm', platform: 'browser' });
const serviceWorkers = {};
for (const version of ['a', 'b']) {
  const result = await build({ entryPoints: [join(project, 'service.js')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { RELEASE: JSON.stringify(`release-${version}`) } });
  serviceWorkers[version] = result.outputFiles[0].text;
}
let release = 'a';
let offline = false;
const requests = new Map();
const server = createServer((request, response) => {
  if (offline) { request.socket.destroy(); return; }
  const path = new URL(request.url, 'http://localhost').pathname;
  requests.set(path, (requests.get(path) ?? 0) + 1);
  response.setHeader('Cache-Control', 'no-store');
  if (path === '/service-worker.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(serviceWorkers[release]); }
  else if (path === '/main.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(client.outputFiles[0].text); }
  else if (path.startsWith('/releases/')) {
    response.setHeader('Content-Type', 'text/javascript');
    response.setHeader('Cache-Control', path.endsWith('/private.js') ? 'private, no-store' : 'public, max-age=0, immutable');
    response.end(path);
  } else if (path.startsWith('/_kanso/')) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ count: requests.get(path), method: request.method })); }
  else {
    response.setHeader('Content-Type', 'text/html');
    if (path === '/offline.html') response.setHeader('Cache-Control', 'public, max-age=0');
    response.end(path === '/offline.html'
      ? '<!doctype html><title>Offline</title><h1>Offline fallback</h1>'
      : '<!doctype html><title>Service worker acceptance</title><button id="install">Install</button><button id="activate">Activate update</button><output></output><script type="module" src="/main.js"></script>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  for (const engine of (process.env.KANSO_BROWSERS ?? 'chromium,firefox,webkit').split(',')) {
    release = 'a'; requests.clear();
    const browser = await ({ chromium, firefox, webkit })[engine].launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin);
      await page.waitForFunction(() => window.service);
      assert.equal(await page.locator('output').textContent(), 'idle');
      await page.locator('#install').click();
      await page.waitForFunction(() => window.service.state.status === 'ready');
      await page.reload();
      await page.waitForFunction(() => window.service && navigator.serviceWorker.controller);
      await page.evaluate(() => window.service.register());
      await page.evaluate(() => { window.pageIdentity = 'preserved'; });
      const fetchText = path => page.evaluate(path => fetch(path).then(response => response.text()), path);
      assert.equal(await fetchText('/releases/a/entry.js'), '/releases/a/entry.js');
      assert.equal(await fetchText('/releases/a/entry.js'), '/releases/a/entry.js');
      assert.equal(requests.get('/releases/a/entry.js'), 1, `${engine}: explicit immutable assets should use Cache Storage`);
      await fetchText('/releases/a/private.js'); await fetchText('/releases/a/private.js');
      assert.equal(requests.get('/releases/a/private.js'), 2, 'Private responses must not be cached');
      await fetchText('/_kanso/data'); await fetchText('/_kanso/data');
      assert.equal(requests.get('/_kanso/data'), 2, 'Loader endpoints must reach the network');
      await page.evaluate(() => fetch('/_kanso/action/save', { method: 'POST', body: 'first' }));
      await page.evaluate(() => fetch('/_kanso/action/save', { method: 'POST', body: 'second' }));
      assert.equal(requests.get('/_kanso/action/save'), 2, 'Actions must reach the network');

      release = 'b';
      await page.evaluate(() => window.service.update());
      await page.waitForFunction(() => window.service.state.status === 'update-available');
      assert.equal(await page.evaluate(() => window.pageIdentity), 'preserved');
      assert.ok(await page.evaluate(() => window.service.state.registration.waiting));
      await page.locator('#activate').click();
      await page.waitForFunction(() => window.service.state.status === 'ready');
      assert.equal(await page.evaluate(() => window.pageIdentity), 'preserved', 'Activation must not reload the page');
      assert.equal(await fetchText('/releases/a/entry.js'), '/releases/a/entry.js');
      assert.equal(await fetchText('/releases/b/entry.js'), '/releases/b/entry.js');
      const caches = await page.evaluate(() => window.caches.keys());
      assert.ok(caches.some(name => name.endsWith(':release-a')));
      assert.ok(caches.some(name => name.endsWith(':release-b')));

      offline = true;
      assert.equal(await fetchText('/releases/a/entry.js'), '/releases/a/entry.js');
      assert.equal(await page.evaluate(() => fetch('/_kanso/data').then(() => 'unexpected', () => 'offline')), 'offline');
      await page.goto(origin + '/offline-product');
      assert.equal(await page.locator('h1').textContent(), 'Offline fallback');
      offline = false;
      await page.goto(origin);
      await page.waitForFunction(() => window.service);
      await page.evaluate(() => window.service.register());
      assert.equal(await page.evaluate(() => window.service.unregister()), true);
      assert.equal(await page.locator('output').textContent(), 'idle');
      assert.deepEqual(errors, []);
      results.push({ browser: engine, passed: true, packedVersion: packed.version, scenarios: ['explicit registration', 'cache policy', 'native actions', 'version isolation', 'manual activation', 'offline fallback', 'unregister'] });
    } finally { offline = false; await context.close(); await browser.close(); }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
}
console.log(JSON.stringify(results, null, 2));
