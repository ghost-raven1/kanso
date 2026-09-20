import assert from 'node:assert/strict';

/** Observe actual requests: route and interaction modules must stay out of the initial graph. */
export async function checkLazy(browser, origin) {
  const page = await browser.newPage();
  const requests = [], errors = [];
  page.on('request', request => { if (request.resourceType() === 'script') requests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin);
    await page.waitForFunction(() => window.kansoReady);
    await page.locator('#increment').click();
    assert.equal(await page.locator('#count').textContent(), '1');
    assert.equal(requests.some(url => /\/(?:Lazy|Lifecycle|InteractionCounter|AdvancedPanel)-/.test(url)), false);
    await page.getByRole('link', { name: '03 · Lazy route' }).click();
    await page.getByRole('heading', { name: 'This route arrived on demand.' }).waitFor();
    assert.equal(requests.some(url => /\/Lazy-/.test(url)), true);
    assert.equal(requests.some(url => /\/(?:InteractionCounter|AdvancedPanel)-/.test(url)), false);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/assets/InteractionCounter-*.js', async route => { await gate; await route.continue(); });
    const button = page.getByRole('button', { name: 'Deferred count first: 0', exact: true });
    await button.click();
    await page.getByRole('status').filter({ hasText: 'Подключаем' }).waitFor();
    await page.getByLabel('Deferred draft first').fill('Draft while downloading');
    release();
    await page.getByRole('button', { name: 'Deferred count first: 1', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Deferred value first').textContent(), 'Draft while downloading');
    await page.getByLabel('Deferred draft second').focus();
    await page.getByLabel('Deferred value second').waitFor({ state: 'attached' });
    assert.equal(await page.getByLabel('Deferred draft second').evaluate(element => element === document.activeElement), true);
    assert.equal(requests.filter(url => /\/InteractionCounter-/.test(url)).length, 1);
    assert.equal(await page.getByRole('button', { name: 'Deferred count second: 0', exact: true }).count(), 1);

    let resolvePanel;
    const panelGate = new Promise(resolve => { resolvePanel = resolve; });
    await page.route('**/assets/AdvancedPanel-*.js', async route => { await panelGate; await route.continue(); });
    await page.evaluate(() => {
      window.animationCalls = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function(frames, options) { window.animationCalls.push({ frames, options }); return animate.call(this, frames, options); };
    });
    await page.getByLabel('Transition panel').selectOption('advanced');
    await page.getByText('Preparing panel…', { exact: true }).waitFor();
    assert.equal(await page.getByText('Basic panel remains visible while loading.', { exact: true }).isVisible(), true);
    resolvePanel();
    await page.getByRole('button', { name: 'Advanced count: 0' }).waitFor();
    await page.getByText('Panel ready', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Advanced count: 0' }).click();
    assert.equal(await page.getByRole('button', { name: 'Advanced count: 1' }).count(), 1);
    assert.equal(requests.filter(url => /\/AdvancedPanel-/.test(url)).length, 1);
    assert.equal(await page.locator('[aria-busy]').evaluate(element => element.getAnimations().length), 0, 'Transition releases its animations');
    assert.deepEqual(await page.evaluate(() => window.animationCalls.map(call => call.options.duration)), [240]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByLabel('Transition panel').selectOption('basic');
    await page.getByText('Panel ready', { exact: true }).waitFor();
    assert.equal(await page.locator('[aria-busy]').evaluate(element => element.getAnimations().length), 0);
    assert.equal(await page.evaluate(() => window.animationCalls.length), 1, 'Reduced motion skips the custom animation');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }

  const touch = await browser.newPage({ hasTouch: true, viewport: { width: 390, height: 844 } });
  try {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await touch.route('**/assets/InteractionCounter-*.js', async route => { await gate; await route.continue(); });
    await touch.goto(origin + '/lazy');
    await touch.waitForFunction(() => window.kansoReady);
    await touch.getByRole('button', { name: 'Deferred count first: 0', exact: true }).tap();
    await touch.getByRole('status').filter({ hasText: 'Подключаем' }).waitFor();
    release();
    await touch.getByRole('button', { name: 'Deferred count first: 1', exact: true }).waitFor();
  } finally { await touch.close(); }

  const unavailable = await browser.newPage();
  try {
    await unavailable.route('**/assets/Home-*.js', route => route.abort());
    await unavailable.goto(origin);
    await unavailable.waitForFunction(() => document.getElementById('root')?.dataset.kansoHydration === 'failed');
    assert.equal(await unavailable.locator('#count').textContent(), '0', 'Missing active page chunk retains SSR HTML');
  } finally { await unavailable.close(); }
}
