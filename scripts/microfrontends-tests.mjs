import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { run, start, stop } from './test-project.mjs';

const output = resolve('output/microfrontends');
await mkdir(output, { recursive: true });
const project = await mkdtemp(join(output, 'platform-'));
await cp('examples/microfrontends', project, { recursive: true, filter: source => !['dist', 'dist-server', 'node_modules'].includes(basename(source)) && !basename(source).startsWith('.kanso-') });
Object.assign(process.env, {
  KANSO_HOST_PORT: '4197', KANSO_REMOTE_PORT: '4211', KANSO_PRIVATE_PORT: '4311',
  KANSO_PROMOTION_PORT: '4212', KANSO_PROMOTION_PRIVATE_PORT: '4312',
  VITE_CATALOG_ORIGIN: 'http://127.0.0.1:4211', VITE_PROMOTION_ORIGIN: 'http://127.0.0.1:4212',
  KANSO_CATALOG_SERVER_ORIGIN: 'http://127.0.0.1:4311', KANSO_PROMOTION_SERVER_ORIGIN: 'http://127.0.0.1:4312',
  KANSO_BUILD_ID: 'A',
});
run(project, process.execPath, ['scripts/build.mjs']);
process.env.KANSO_BUILD_ID = 'B';
run(project, process.execPath, ['scripts/build.mjs', '--remote', 'catalog']);
const pointer = join(project, 'catalog/dist/kanso-remote.json');
const publish = async id => cp(join(project, `catalog/dist/releases/${id}/kanso-remote.json`), pointer);
await publish('A');
const origin = 'http://127.0.0.1:4197';
const results = [];
let server;
const snapshot = html => JSON.parse(html.match(/<script[^>]*id="kanso-data"[^>]*>(.*?)<\/script>/s)?.[1] ?? 'null');
const html = async (path = '/', options) => {
  const response = await fetch(origin + path, options);
  return { response, html: await response.text() };
};
try {
  server = await start(project, ['scripts/serve.mjs'], 4197);
  const first = await html();
  assert.equal(first.response.status, 200);
  assert.match(first.html, /data-remote-card="camera"/);
  assert.match(first.html, /data-promotion="A"/);
  assert.match(first.html, /<title[^>]*>Independent pieces/);
  assert.equal(snapshot(first.html).remotes.catalog.buildId, 'A');
  assert.equal(snapshot(first.html).remotes.promotion.buildId, 'A');
  assert.ok(!first.html.includes('kanso-server.json'));
  assert.equal((await fetch(origin, { method: 'HEAD' })).status, 200);
  const requests = await Promise.all(['alice', 'bob'].map(user => html('/catalog/product/camera', { headers: { 'X-User': user } })));
  for (let i = 0; i < requests.length; i++) assert.equal(snapshot(requests[i].html).data.catalog__product.user, ['alice', 'bob'][i]);
  assert.match((await html('/sitemap.xml')).html, /\/catalog/);
  results.push({ scenario: 'SSR, SEO, HEAD, request isolation and sitemap', passed: true });

  for (const name of (process.env.KANSO_BROWSERS ?? 'chromium,firefox,webkit').split(',')) {
    await publish('A');
    const browser = await ({ chromium, firefox, webkit })[name].launch();
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = []; const dataRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (request.url().includes('/_kanso/data')) dataRequests.push(request.url()); });
      await page.addInitScript(() => {
        const observer = new MutationObserver(() => {
          const input = document.querySelector('[data-remote-card="camera"] input');
          if (input) { window.initialInput = input; window.initialId = input.id; input.value = 'before hydration'; observer.disconnect(); }
        });
        observer.observe(document, { childList: true, subtree: true });
      });
      await page.goto(origin);
      await page.waitForFunction(() => document.documentElement.dataset.kansoReady);
      assert.equal(await page.evaluate(() => window.initialInput === document.querySelector('[data-remote-card="camera"] input')), true);
      assert.equal(await page.locator('[data-remote-card="camera"] input').inputValue(), 'before hydration');
      assert.equal(await page.evaluate(() => window.initialId === document.querySelector('[data-remote-card="camera"] input').id), true);
      assert.equal(dataRequests.length, 0);
      const camera = page.locator('[data-remote-card="camera"] button');
      await camera.click(); await page.locator('#step').click(); await camera.click();
      assert.equal(await camera.textContent(), 'camera: 3');
      assert.equal(await page.locator('[data-remote-card="lens"] button').textContent(), 'lens: 0');
      await page.locator('#dismiss-promotion').click();
      assert.equal(await page.locator('#dismiss-promotion').isDisabled(), true);
      // Cancel in the same browser task; very fast workers can finish between Playwright round trips.
      await page.evaluate(() => {
        document.querySelector('#worker-start').click();
        document.querySelector('#worker-ui').click();
        document.querySelector('#worker-cancel').click();
      });
      await page.waitForFunction(() => document.querySelector('#worker-status')?.textContent === 'Поиск отменён');
      await page.locator('#worker-start').click();
      await page.waitForFunction(() => document.querySelector('#worker-status')?.textContent === 'Поиск завершён');
      assert.equal(await page.locator('#worker-matches').textContent(), 'Найдено: 40000');
      await page.locator('#service-register').click();
      await page.waitForFunction(() => document.querySelector('#service-status')?.textContent === 'Готов');
      await page.locator('#service-unregister').click();

      await publish('B');
      await page.locator('a[href="/catalog"]').click();
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Independent catalog');
      await page.locator('a[href="/catalog/product/camera"]').click();
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Product: camera');
      assert.match(await page.locator('.eyebrow').textContent(), /A/);
      const action = page.waitForResponse(response => response.url().includes('/_kanso/action/'));
      await page.locator('input[name="note"]').fill('pinned action');
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      assert.equal((await (await action).json()).data.release, 'A');
      await page.goBack(); await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Independent catalog');
      await page.goForward(); await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Product: camera');
      assert.equal(await page.locator('head title').count(), 1);
      const newer = await context.newPage(); await newer.goto(origin + '/catalog/product/lens');
      await newer.waitForFunction(() => document.documentElement.dataset.kansoReady);
      assert.match(await newer.locator('.eyebrow').textContent(), /B/);
      await publish('A');
      assert.equal(snapshot((await html('/catalog')).html).remotes.catalog.buildId, 'A');
      const native = await browser.newContext({ javaScriptEnabled: false });
      const nativePage = await native.newPage(); await nativePage.goto(origin + '/catalog/product/camera');
      await publish('B');
      const posted = nativePage.waitForResponse(response => response.request().method() === 'POST');
      await nativePage.locator('input[name="note"]').fill('native');
      await nativePage.getByRole('button', { name: 'Сохранить', exact: true }).click();
      assert.equal(snapshot(await (await posted).text()).action.result.data.release, 'A');
      await native.close();
      assert.deepEqual(errors, []);
      await page.screenshot({ path: join(output, `${name}-remote-page.png`), fullPage: true });
      results.push({ browser: name, scenario: 'hydration identity, Context, instances, workers, routes, forms, releases and rollback', passed: true });
      await context.close();

      await publish('A');
      for (const resource of ['**/remoteEntry.js', '**/assets/ProductCard-*.js']) {
        const recovery = await browser.newContext(); const failed = await recovery.newPage();
        await failed.route(resource, route => route.abort());
        await failed.goto(origin); await failed.locator('#retry-hydration').waitFor();
        assert.equal(await failed.locator('[data-remote-card]').count(), 2);
        assert.equal(await failed.evaluate(() => document.documentElement.dataset.kansoReady), undefined);
        await failed.locator('[data-remote-card="camera"] input').fill('Offline draft');
        await failed.evaluate(() => { window.offlineInput = document.querySelector('[data-remote-card="camera"] input'); });
        await failed.unroute(resource); await failed.locator('#retry-hydration').click();
        await failed.waitForFunction(() => document.documentElement.dataset.kansoReady);
        assert.equal(await failed.locator('[data-remote-card="camera"] input').inputValue(), 'Offline draft');
        assert.equal(await failed.evaluate(() => window.offlineInput === document.querySelector('[data-remote-card="camera"] input')), true);
        await failed.locator('[data-remote-card="camera"] button').click();
        assert.equal(await failed.locator('[data-remote-card="camera"] button').textContent(), 'camera: 1');
        results.push({ browser: name, scenario: `${resource}: failed initial load preserves SSR and manual retry hydrates`, passed: true });
        await recovery.close();
      }
    } finally { await browser.close(); }
  }
  await rename(pointer, pointer + '.unavailable');
  try {
    for (const path of ['/', '/catalog']) {
      const unavailable = await html(path);
      assert.equal(unavailable.response.status, 503);
      assert.equal(unavailable.response.headers.get('Cache-Control'), 'no-store');
    }
  }
  finally { await rename(pointer + '.unavailable', pointer); }
  results.push({ scenario: 'required unavailable remote is uncacheable 503', passed: true });
} finally {
  await stop(server);
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
}
console.log(`Microfrontends: ${results.length} scenarios passed.`);
