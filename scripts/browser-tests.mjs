import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox, webkit } from 'playwright';

const port = 4174;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['examples/lab/serve.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
server.stdout.on('data', chunk => { logs += chunk; });
server.stderr.on('data', chunk => { logs += chunk; });
const results = [];
await mkdir('output/browser', { recursive: true });
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${origin}/healthz`)).ok) break; } catch {}
    if (i > 100 || server.exitCode !== null) throw new Error(`Preview failed: ${logs}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    if (process.env.KANSO_BROWSERS && !process.env.KANSO_BROWSERS.split(',').includes(name)) continue;
    let browser;
    try { browser = await engine.launch(); }
    catch (error) { results.push({ browser: name, passed: false, error: error.message }); console.error(`${name}: ${error.message.split('\n')[0]}`); process.exitCode = 1; continue; }
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let loads = 0;
      page.on('request', request => { if (request.url().includes('/_kanso/data')) loads++; });
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await page.route('**/assets/*.js', async route => { await gate; await route.continue(); });
      await page.goto(origin, { waitUntil: 'commit' });
      await page.locator('#count').waitFor();
      await page.evaluate(() => {
        window.beforeHydration = document.querySelector('#count');
        window.beforeTitle = document.querySelector('title');
        window.beforeCanonical = document.querySelector('link[rel=canonical]');
        window.beforeInput = document.querySelector('[data-row="A"] input');
        window.beforeInput.value = 'Typed before JavaScript';
        window.beforeInput.focus();
      });
      assert.equal(await page.title(), 'Kanso · 0', `${name}: SSR title before JavaScript`);
      release();
      await page.waitForFunction(() => window.kansoReady);
      assert.equal(await page.evaluate(() => window.beforeHydration === document.querySelector('#count')), true, `${name}: DOM preserved`);
      assert.equal(await page.locator('[data-row="A"] input').inputValue(), 'Typed before JavaScript', `${name}: pre-hydration input`);
      assert.equal(await page.evaluate(() => window.beforeTitle === document.querySelector('title') && window.beforeCanonical === document.querySelector('link[rel=canonical]')), true, `${name}: head nodes adopted`);
      assert.equal(await page.locator('head title').count(), 1);
      assert.equal(loads, 0, `${name}: no duplicate initial loader request`);
      await page.locator('#increment').click();
      assert.equal(await page.locator('#count').textContent(), '1');
      assert.equal(await page.locator('#doubled').textContent(), '2');
      await page.locator('#step').click();
      await page.locator('#increment').click();
      assert.equal(await page.locator('#count').textContent(), '3');
      assert.equal(await page.title(), 'Kanso · 3');
      assert.equal(await page.evaluate(() => window.kansoMetrics.counterMounts), 1);
      await page.getByRole('button', { name: 'Count A', exact: true }).click();
      await page.locator('[data-row="A"] input').focus();
      await page.evaluate(() => { window.savedRow = document.querySelector('[data-row="A"]'); document.querySelector('#reverse').click(); });
      await page.waitForFunction(() => document.activeElement === window.savedRow.querySelector('input'));
      assert.equal(await page.evaluate(() => document.querySelectorAll('[data-row]')[2] === window.savedRow), true);
      assert.equal(await page.getByRole('button', { name: 'Count A', exact: true }).textContent(), '1');
      assert.equal(await page.evaluate(() => window.kansoMetrics.rowMounts), 3);
      await page.locator('#toggle-effect').click();
      assert.equal(await page.evaluate(() => window.kansoMetrics.activeEffects), 0);
      await page.locator('#toggle-effect').click();
      assert.equal(await page.evaluate(() => window.kansoMetrics.activeEffects), 1);
      await page.screenshot({ path: `output/browser/${name}-desktop.png`, fullPage: true });
      await page.getByRole('link', { name: '02 · Data & forms' }).click();
      await page.locator('#name').waitFor();
      await page.getByRole('button', { name: 'Save name' }).click();
      await page.waitForFunction(() => document.querySelector('#name-error')?.textContent.includes('2'));
      await page.locator('#name').fill(`Kanso ${name}`);
      await page.getByRole('button', { name: 'Save name' }).click();
      await page.waitForFunction(expected => document.querySelector('#server-name')?.textContent === expected, `Kanso ${name}`);
      assert.equal(await page.evaluate(() => window.kansoMetrics.activeEffects), 0);
      await page.getByRole('link', { name: '03 · Lazy route' }).click();
      await page.getByRole('heading', { name: 'This route arrived on demand.' }).waitFor();
      await page.reload();
      await page.waitForFunction(() => window.kansoReady);
      await page.getByRole('heading', { name: 'This route arrived on demand.' }).waitFor();
      assert.equal(await page.title(), 'Lazy route · Kanso');
      await page.getByRole('link', { name: '04 · SEO' }).click();
      await page.locator('#seo-title').fill('A reactive SEO title');
      await page.waitForFunction(() => document.title === 'A reactive SEO title · Kanso');
      assert.equal(await page.locator('meta[property="og:title"]').getAttribute('content'), 'A reactive SEO title · Kanso');
      assert.equal(await page.locator('[data-kanso-head="jsonld:article"]').count(), 1);
      assert.equal(await page.locator('head title').count(), 1);
      await page.screenshot({ path: `output/browser/${name}-seo.png`, fullPage: true });
      await page.getByRole('link', { name: 'Страница из loader →' }).click();
      await page.waitForFunction(() => document.title === 'SEO example: first · Kanso');
      assert.equal(await page.locator('[data-kanso-head="jsonld:article"]').count(), 0);
      await page.getByRole('link', { name: 'Second', exact: true }).click();
      await page.waitForFunction(() => document.title === 'SEO example: second · Kanso');
      await page.goBack();
      await page.waitForFunction(() => document.title === 'SEO example: first · Kanso');
      await page.goForward();
      await page.waitForFunction(() => document.title === 'SEO example: second · Kanso');
      let releaseOld;
      let intercepted;
      const oldGate = new Promise(resolve => { releaseOld = resolve; });
      const oldRequest = new Promise(resolve => { intercepted = resolve; });
      await page.route('**/_kanso/data?*', async route => {
        const target = new URL(route.request().url()).searchParams.get('url');
        if (target !== '/seo/example/first') { await route.continue(); return; }
        intercepted(); await oldGate;
        await route.continue().catch(() => {});
      });
      await page.getByRole('link', { name: 'First', exact: true }).click();
      await oldRequest;
      await page.getByRole('link', { name: '04 · SEO' }).click();
      await page.waitForFunction(() => document.title === 'SEO that ships with HTML · Kanso');
      releaseOld();
      await page.waitForTimeout(100);
      assert.equal(await page.title(), 'SEO that ships with HTML · Kanso', 'Stale navigation cannot overwrite current metadata');
      await page.unroute('**/_kanso/data?*');
      await page.goto(origin + '/seo/example/second');
      await page.waitForFunction(() => window.kansoReady);
      assert.equal(await page.title(), 'SEO example: second · Kanso');
      assert.equal(await page.locator('link[rel="canonical"]').count(), 1);
      await page.getByRole('link', { name: '05 · Stores & services' }).click();
      await page.waitForFunction(() => document.querySelector('#service-workspace')?.textContent === 'Workspace: alpha');
      await page.locator('#service-count').click();
      await page.locator('#service-theme').click();
      assert.equal(await page.locator('#service-count').textContent(), 'Count: 1');
      assert.equal(await page.locator('#service-theme').textContent(), 'Theme: dark');
      await page.getByRole('link', { name: 'Beta', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#service-workspace')?.textContent === 'Workspace: beta');
      assert.equal(await page.locator('#service-count').textContent(), 'Count: 0');
      await page.goBack();
      await page.waitForFunction(() => document.querySelector('#service-workspace')?.textContent === 'Workspace: alpha');
      await page.locator('#service-count').click();
      await page.getByRole('button', { name: 'Restore server data' }).click();
      await page.waitForFunction(() => document.querySelector('#service-count')?.textContent === 'Count: 0');
      await page.screenshot({ path: `output/browser/${name}-services.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(origin);
      await page.waitForFunction(() => window.kansoReady);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: mobile overflow`);
      await page.screenshot({ path: `output/browser/${name}-mobile.png`, fullPage: true });
      assert.deepEqual(errors, [], `${name}: console exceptions`);
      const offline = await browser.newPage();
      await offline.route('**/assets/*.js', route => route.abort());
      await offline.goto(origin);
      assert.equal(await offline.locator('#count').textContent(), '0');
      assert.equal(await offline.locator('[data-row]').count(), 3);
      await offline.close();
      results.push({ browser: name, version: browser.version(), passed: true, checks: ['SSR DOM identity', 'pre-hydration input', 'no duplicate loader', 'fine-grained updates', 'key identity and focus', 'effect disposal', 'forms and revalidation', 'lazy SSR', 'mobile layout', 'failed JavaScript retains HTML', 'SSR metadata', 'head hydration identity', 'reactive SEO', 'JSON-LD cleanup', 'route parameters and back/forward SEO', 'stale SEO response rejected', 'application service scopes'] });
      console.log(`${name}: all browser scenarios passed`);
    } finally { await browser.close(); }
  }
  await writeFile('output/browser/results.json', JSON.stringify(results, null, 2));
} finally { server.kill('SIGTERM'); }
