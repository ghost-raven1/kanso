import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, firefox, webkit } from 'playwright';
import { run, start, stop } from './test-project.mjs';

await mkdir('output/web', { recursive: true });
const packed = {};
for (const name of ['core', 'compiler', 'vite', 'app', 'cli', 'microfrontends', 'workers']) {
  const result = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', resolve('output/web')], { cwd: `packages/${name}`, encoding: 'utf8' }));
  packed[`@kanso/${name}`] = `file:${resolve('output/web', result[0].filename)}`;
}
const root = await mkdtemp(resolve('output/web/catalog-'));
await cp('examples/catalog', root, { recursive: true, filter: path => !/(?:^|\/)(dist|dist-server|node_modules)(?:\/|$)/.test(path) });
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
pkg.devDependencies = { ...pkg.devDependencies, ...packed };
for (const name of Object.keys(pkg.dependencies)) if (packed[name]) { pkg.dependencies[name] = packed[name]; delete pkg.devDependencies[name]; }
await writeFile(join(root, 'package.json'), JSON.stringify(pkg, null, 2));
run(root, 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--workspaces=false']);
run(root, 'npm', ['run', 'typecheck']); run(root, 'npm', ['run', 'build']);
const origin = 'http://127.0.0.1:4183';
const engines = { chromium, firefox, webkit };
const browsers = (process.env.KANSO_BROWSERS ?? 'chromium,firefox,webkit').split(',');
const results = [];
let server;

async function ready(page) { await page.locator('html[data-kanso-ready=true]').waitFor(); }
async function formScenario(browser, mode) {
  const context = await browser.newContext({ javaScriptEnabled: mode !== 'disabled' });
  const page = await context.newPage();
  const errors = []; const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  try {
    if (mode === 'delayed') {
      let release;
      const blocked = new Promise(resolve => { release = resolve; });
      await page.route('**/assets/*.js', async route => { await blocked; await route.continue(); });
      await page.goto(origin + '/products/akari', { waitUntil: 'commit' });
      await page.getByLabel('Имя', { exact: true }).fill('До гидратации');
      await page.getByLabel('Характеристики', { exact: true }).check();
      await page.evaluate(() => { window.originalInput = document.querySelector('[name=name]'); });
      release(); await ready(page);
      assert.equal(await page.getByLabel('Имя', { exact: true }).inputValue(), 'До гидратации');
      assert.equal(await page.getByLabel('Характеристики', { exact: true }).isChecked(), true);
      assert.equal(await page.evaluate(() => window.originalInput === document.querySelector('[name=name]')), true);
      assert.equal(requests.some(request => request.url.includes('/_kanso/data')), false);
    } else {
      await page.goto(origin);
      if (mode === 'enabled') await ready(page);
      assert.equal(await page.locator('#result-count').textContent(), '3');
      await page.getByLabel('Поиск', { exact: true }).fill('Лампа');
      await page.getByRole('button', { name: 'Найти', exact: true }).click();
      await page.waitForURL(url => url.searchParams.get('q') === 'Лампа');
      await page.waitForFunction(() => document.querySelector('#result-count')?.textContent === '1');
      await page.getByRole('link', { name: /Лампа Akari/ }).click();
      await page.waitForURL('**/products/akari');
      await page.getByRole('heading', { name: 'Лампа Akari', exact: true }).waitFor();
      await page.goBack();
      await page.waitForFunction(() => document.querySelector('#result-count')?.textContent === '1');
      await page.goForward();
      await page.getByRole('heading', { name: 'Лампа Akari', exact: true }).waitFor();
    }
    // Router content and head subscriptions can settle on different browser turns.
    await page.waitForFunction(() => document.title.includes('Лампа Akari'));
    assert.match(await page.title(), /Лампа Akari/);
    assert.equal(await page.locator('title').count(), 1);
    assert.equal(await page.locator('link[rel=canonical]').count(), 1);
    assert.equal(await page.locator('form').getAttribute('action'), '/products/akari');
    assert.equal(JSON.parse(await page.locator('script[type="application/ld+json"]').textContent()).sku, 'akari');
    await page.getByRole('button', { name: 'Задать вопрос', exact: true }).click();
    assert.equal(requests.filter(request => request.method === 'POST').length, 0, 'Native constraints must prevent an empty submission');
    await page.getByLabel('Имя', { exact: true }).fill('А');
    await page.getByLabel('Email', { exact: true }).fill('test@example.com');
    await page.getByLabel('Что хотите узнать?', { exact: true }).fill('Мало');
    await page.getByLabel('Характеристики', { exact: true }).check();
    await page.getByLabel('Наличие', { exact: true }).check();
    const invalid = page.waitForResponse(response => response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Задать вопрос', exact: true }).click();
    assert.equal((await invalid).status(), 422);
    await page.getByText('Укажите имя: минимум два символа.', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Имя', { exact: true }).inputValue(), 'А');
    assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), 'test@example.com');
    assert.equal(await page.getByLabel('Характеристики', { exact: true }).isChecked(), true);
    assert.equal(await page.getByLabel('Наличие', { exact: true }).isChecked(), true);
    assert.equal(new URL(page.url()).pathname, '/products/akari');
    if (mode !== 'disabled') await ready(page);
    await page.getByLabel('Имя', { exact: true }).fill('Алексей');
    await page.getByLabel('Что хотите узнать?', { exact: true }).fill('Подскажите размеры и наличие, пожалуйста.');
    await page.getByRole('button', { name: 'Задать вопрос', exact: true }).click();
    await page.waitForURL('**/requests/*');
    await page.getByRole('heading', { name: 'Заявка принята.', exact: true }).waitFor();
    assert.equal(await page.locator('[data-intent]').getAttribute('data-intent'), 'question');
    assert.equal(await page.locator('[data-interests]').getAttribute('data-interests'), 'details,availability');
    const requestId = await page.locator('#request-id').textContent();
    const postCount = requests.filter(request => request.method === 'POST').length;
    await page.reload();
    assert.equal(await page.locator('#request-id').textContent(), requestId);
    assert.equal(requests.filter(request => request.method === 'POST').length, postCount);
    assert.equal(postCount, 2);
    assert.equal(await page.locator('body').textContent().then(text => text.includes('test@example.com')), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function navigationScenario(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(origin); await ready(page);
    let release; let received;
    const waiting = new Promise(resolve => { received = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    await page.route('**/_kanso/data?*', async route => {
      if (new URL(route.request().url()).searchParams.get('url') === '/products/akari') {
        received(); await blocked;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 1, buildId: 'stale', url: '/products/akari', data: { layout: {}, product: { product: { id: 'stale', name: 'STALE' }, canonical: origin + '/stale', jsonLd: {} } } }) });
      } else await route.continue();
    });
    await page.getByRole('link', { name: /Лампа Akari/ }).click(); await waiting;
    const returned = page.waitForResponse(response => response.url().includes('/_kanso/data?') && new URL(response.url()).searchParams.get('url') === '/products/midori');
    await page.getByRole('link', { name: /Блокнот Midori/ }).click();
    release();
    await (await returned).finished();
    await page.getByRole('heading', { name: 'Блокнот Midori', exact: true }).waitFor();
    assert.doesNotMatch(await page.title(), /STALE/);
    await page.unroute('**/_kanso/data?*');
    await page.getByRole('link', { name: /Kanso studio/ }).click();
    await page.locator('#result-count').waitFor();
    let fail = true;
    await page.route('**/_kanso/data?*', route => fail ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.continue());
    await page.getByRole('button', { name: 'Обновить каталог' }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('#result-count').textContent(), '3');
    fail = false;
    await page.getByRole('button', { name: 'Обновить каталог' }).click();
    await page.getByRole('alert').waitFor({ state: 'detached' });
    assert.equal(await page.locator('#result-count').textContent(), '3');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: 'output/web/catalog-mobile.png', fullPage: true });
  } finally { await page.close(); }
}

try {
  server = await start(root, ['scripts/serve.mjs'], 4183, { PORT: '4183' });
  const html = await (await fetch(origin + '/products/akari')).text();
  assert.match(html, /<title[^>]*>Лампа Akari/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /method="post" action="\/products\/akari"/);
  for (const name of browsers) {
    const browser = await engines[name].launch();
    try {
      for (const mode of ['enabled', 'disabled', 'delayed']) {
        await formScenario(browser, mode); results.push({ browser: name, mode, catalog: true, validation: true, submitter: true, prg: true });
        console.log(`Catalog passed: ${name}, ${mode}`);
      }
      await navigationScenario(browser); results.push({ browser: name, races: true, revalidation: true });
    } finally { await browser.close(); }
  }
  await writeFile('output/web/results.json', JSON.stringify({ packedInstall: true, typecheck: true, productionBuild: true, scenarios: results }, null, 2));
  console.log('Web acceptance passed with isolated packed packages.');
} finally { await stop(server); }
