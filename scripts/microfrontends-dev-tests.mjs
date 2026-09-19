import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { start, stop } from './test-project.mjs';

await mkdir('output/microfrontends-dev', { recursive: true });
const root = await mkdtemp(path.resolve('output/microfrontends-dev/platform-'));
await cp('examples/microfrontends', root, { recursive: true, filter: file => !/(?:^|\/)(dist|dist-server|node_modules|\.kanso-build-[^/]*)(?:\/|$)/.test(file) });
const source = path.join(root, 'catalog/src/ProductCard.tsx');
const original = await readFile(source, 'utf8');
const changed = original.replace('One component. Its own release.', 'Hot module: catalog').replace('value + settings.step', 'value + settings.step * 2');
assert.notEqual(changed, original);
const incompatible = changed.replace('const [count, setCount] = useState(0);', 'const [count, setCount] = useState(0);\n  const [another] = useState(0);');
const environment = { KANSO_HOST_PORT: '4196', KANSO_REMOTE_PORT: '4287', KANSO_PROMOTION_PORT: '4288' };
const origin = 'http://127.0.0.1:4196';
const engines = { chromium, firefox, webkit };
const results = [];
let server;
try {
  server = await start(root, ['scripts/dev.mjs'], 4196, environment);
  const html = await (await fetch(origin)).text();
  assert.match(html, /data-remote-card=/);
  assert.match(html, /data-promotion="local"/);
  assert.match(html, /<title/);
  assert.match(html, /card\.module\.css\?direct/);
  for (const name of (process.env.KANSO_BROWSERS ?? 'chromium,firefox,webkit').split(',')) {
    await writeFile(source, original);
    const browser = await engines[name].launch();
    try {
      const page = await browser.newPage();
      let release;
      const blocked = new Promise(resolve => { release = resolve; });
      await page.route('**/src/main.tsx', async route => { await blocked; await route.continue(); });
      await page.goto(origin, { waitUntil: 'commit' });
      const camera = page.locator('[data-remote-card="camera"]');
      const lens = page.locator('[data-remote-card="lens"]');
      await camera.locator('input').fill('Typed before hydration');
      await page.evaluate(() => { window.initialRemoteInput = document.querySelector('[data-remote-card="camera"] input'); });
      release();
      await page.locator('html[data-kanso-ready=true]').waitFor();
      assert.equal(await camera.locator('input').inputValue(), 'Typed before hydration');
      assert.equal(await page.evaluate(() => window.initialRemoteInput === document.querySelector('[data-remote-card="camera"] input')), true);
      await camera.locator('button').click();
      await lens.locator('button').click();
      await lens.locator('button').click();
      assert.match(await camera.locator('button').textContent(), /camera: 1/);
      assert.match(await lens.locator('button').textContent(), /lens: 2/);
      await writeFile(source, changed);
      await camera.getByRole('heading', { name: 'Hot module: catalog', exact: true }).waitFor();
      assert.match(await camera.locator('button').textContent(), /camera: 1/);
      assert.match(await lens.locator('button').textContent(), /lens: 2/);
      await camera.locator('button').click();
      assert.match(await camera.locator('button').textContent(), /camera: 3/);
      await page.locator('#step').click();
      await camera.locator('button').click();
      assert.match(await camera.locator('button').textContent(), /camera: 7/);
      assert.match(await (await fetch(origin)).text(), /Hot module: catalog/);
      await writeFile(source, incompatible);
      await page.waitForFunction(() => document.querySelector('[data-remote-card="camera"] button')?.textContent?.includes('camera: 0'));
      assert.match(await lens.locator('button').textContent(), /lens: 0/);
      assert.match(await page.locator('#step').textContent(), /2/);
      await writeFile(source, incompatible.replace('return (', 'return @ ('));
      await page.locator('vite-error-overlay').first().waitFor();
      assert.equal(await camera.count(), 1);
      await writeFile(source, incompatible.replace('Hot module: catalog', 'Recovered remote'));
      await camera.getByRole('heading', { name: 'Recovered remote', exact: true }).waitFor();
      await page.locator('vite-error-overlay').waitFor({ state: 'detached' });
      await camera.locator('button').click();
      assert.match(await camera.locator('button').textContent(), /camera: 4/);
      results.push({ browser: name, ssr: true, prehydrationInput: true, hmrState: true, instances: true, newHandler: true, context: true, incompatibleReset: true, errorRecovery: true });
      console.log('Microfrontend SSR development and HMR passed:', name);
    } finally { await browser.close(); }
  }
  await writeFile('output/microfrontends-dev/results.json', JSON.stringify({ scenarios: results }, null, 2));
} finally { await stop(server); }
