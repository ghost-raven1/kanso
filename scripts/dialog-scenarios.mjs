import assert from 'node:assert/strict';

/** Exercise native focus/inert behavior in actual browser engines, not a dialog mock. */
export async function checkDialogs(page, origin) {
  const html = await (await fetch(origin + '/lifecycle')).text();
  assert.equal(html.includes('<dialog'), false, 'Portalled modals are client-only');
  await page.goto(origin + '/lifecycle');
  await page.waitForFunction(() => window.kansoReady);
  const trigger = page.getByRole('button', { name: 'Open profile editor' });
  const editor = page.getByRole('dialog', { name: 'Edit profile' });
  await trigger.click();
  await editor.waitFor();
  await page.waitForFunction(() => document.activeElement?.matches('dialog input:not([type="checkbox"])'));
  await page.getByLabel('Profile name').fill('Saved draft');
  for (const key of ['Tab', 'Shift+Tab']) for (let index = 0; index < 8; index++) {
    await page.keyboard.press(key);
    assert.equal(await page.evaluate(() => document.activeElement?.closest('dialog')?.open ?? document.activeElement === document.body), true, 'Tab cannot focus background controls');
  }
  await trigger.evaluate(element => element.focus());
  assert.equal(await trigger.evaluate(element => element === document.activeElement), false, 'Background is inert');
  assert.equal(await page.evaluate(() => document.documentElement.style.overflow), 'hidden');
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.mouse.move(2, 2);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.scrollY), scrollY, 'Modal locks background scrolling');
  await page.getByLabel('Keep dialog open').check();
  await page.keyboard.press('Escape');
  assert.equal(await editor.count(), 1, 'Application may decline a close request');
  await page.getByLabel('Keep dialog open').uncheck();
  const nestedTrigger = page.getByRole('button', { name: 'Delete profile', exact: true });
  await nestedTrigger.click();
  await page.getByRole('alertdialog', { name: 'Confirm deletion' }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelectorAll('dialog').length === 1);
  assert.equal(await nestedTrigger.evaluate(element => element === document.activeElement), true);
  assert.equal(await page.evaluate(() => document.documentElement.style.overflow), 'hidden', 'Parent retains scroll lock');
  assert.equal(await page.getByLabel('Profile name').inputValue(), 'Saved draft');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelectorAll('dialog').length === 0);
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
  assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
  await page.getByRole('button', { name: 'Dialog theme: light' }).click();
  await trigger.click();
  assert.equal(await page.getByLabel('Profile name').inputValue(), '', 'Closing disposes child state');
  assert.ok((await editor.textContent()).includes('dark'), 'Context survives the portal');
  await page.mouse.click(2, 2);
  await page.waitForFunction(() => document.querySelectorAll('dialog').length === 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  const box = await editor.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 391, 'Mobile dialog fits viewport');
  await page.getByRole('link', { name: 'Leave modal route' }).click();
  await page.locator('#increment').waitFor();
  assert.equal(await page.locator('dialog').count(), 0, 'Route disposal removes dialog');
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  await page.setViewportSize({ width: 1280, height: 900 });
}
