import { mkdir, mkdtemp, readFile, writeFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';
import { createProject, migrate, doctor } from '@kanso/cli';
import { run, start, stop, viteArgs } from './test-project.mjs';

await mkdir('output/dx', { recursive: true });
const packed = {};
for (const name of ['core', 'compiler', 'vite', 'app', 'cli', 'microfrontends', 'workers']) {
  const data = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', resolve('output/dx')], { cwd: `packages/${name}`, encoding: 'utf8' }));
  packed[`@kanso/${name}`] = `file:${resolve('output/dx', data[0].filename)}`;
}
const browsers = (process.env.KANSO_BROWSERS ?? 'chromium,firefox,webkit').split(',');
const engines = { chromium, firefox, webkit };
const results = [];
const install = (root, testTooling = false) => run(root, 'npm', [
  // npm 10.9.8 on Node 22 crashes resolving Vitest's peer graph (edgesOut).
  // Use a pinned installer for this fixture; preserve all peer checks and the global npm.
  ...(testTooling ? ['exec', '--yes', '--package=npm@11.12.1', '--', 'npm'] : []),
  'install', '--ignore-scripts', '--no-audit', '--no-fund', '--workspaces=false',
]);
async function usePacked(root) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  pkg.devDependencies = { ...pkg.devDependencies, ...packed };
  for (const name of Object.keys(packed)) if (pkg.dependencies?.[name]) { pkg.dependencies[name] = packed[name]; delete pkg.devDependencies[name]; }
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg, null, 2));
}
async function scenario(page, kind) {
  await page.goto('http://127.0.0.1:4181');
  if (kind === 'profile') {
    await page.getByLabel('Name').fill('Kanso'); await page.getByRole('button', { name: 'Theme' }).click();
    assert.equal(await page.locator('[data-name]').textContent(), 'Kanso'); assert.equal(await page.locator('[data-theme]').textContent(), 'dark');
    await page.getByRole('button', { name: 'Focus' }).click(); assert.equal(await page.getByLabel('Name').evaluate(node => node === document.activeElement), true);
    assert.equal(await page.getByLabel('Name').getAttribute('data-attached'), 'true');
    await page.getByLabel('Draft', { exact: true }).fill('Unsaved');
    await page.getByRole('button', { name: 'Reset draft' }).click();
    assert.equal(await page.getByLabel('Draft', { exact: true }).inputValue(), '');
    assert.equal(await page.locator('[data-markup]').innerHTML(), '<em>Draft reset</em>');
    assert.equal(await page.locator('[data-name]').textContent(), 'Kanso');
  } else if (kind === 'catalog') {
    await page.getByLabel('Note 1').fill('keep');
    await page.getByRole('button', { name: 'Reverse' }).click(); await page.getByRole('button', { name: 'Replace' }).click();
    assert.deepEqual(await page.locator('[data-row]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-row'))), ['2', '1']);
    assert.equal(await page.getByLabel('Note 1').inputValue(), 'keep'); assert.equal(await page.locator('[data-row="1"] span').textContent(), 'Alpha!.');
    await page.getByLabel('Search').fill('Beta'); assert.equal(await page.locator('[data-row]').count(), 1);
  } else {
    await page.locator('[data-counter]').first().click(); await page.getByRole('button', { name: 'Step', exact: true }).first().click(); await page.locator('[data-counter]').first().click();
    assert.deepEqual(await page.locator('[data-counter]').allTextContents(), ['Count: 4', 'Count: 0']); assert.deepEqual(await page.locator('output').allTextContents(), ['8', '0']);
  }
}
let server;
try {
  for (const kind of process.env.KANSO_DX_TEMPLATES_ONLY ? [] : ['profile', 'catalog', 'hooks']) {
    const root = await mkdtemp(join(tmpdir(), `kanso-dx-${kind}-`));
    await createProject(root, process.cwd()); await cp(`tests/fixtures/migration/${kind}/src`, join(root, 'src'), { recursive: true });
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    pkg.dependencies = { react: '^19.3.0', 'react-dom': '^19.3.0' };
    pkg.devDependencies = { vite: '^8.3.0', typescript: '^5.9.0', '@vitejs/plugin-react': '^6.1.1', '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0' };
    await writeFile(join(root, 'package.json'), JSON.stringify(pkg, null, 2));
    await writeFile(join(root, 'src/main.tsx'), `import{createRoot}from'react-dom/client';import{App}from'./App';createRoot(document.getElementById('root')!).render(<App/>);`);
    await writeFile(join(root, 'tsconfig.base.json'), JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', baseUrl: '.', paths: { '@/*': ['src/*'] }, lib: ['ES2022', 'DOM'], types: ['vite/client'] } }));
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ extends: './tsconfig.base.json', include: ['src'] }));
    await writeFile(join(root, 'vite.config.ts'), `import{defineConfig}from'vite';import react from'@vitejs/plugin-react';export default defineConfig({plugins:[react()],resolve:{tsconfigPaths:true}});`);
    if (kind === 'profile') {
      await mkdir(join(root, 'config'));
      await writeFile(join(root, 'config/client.ts'), await readFile(join(root, 'vite.config.ts'), 'utf8'));
      await writeFile(join(root, 'vite.config.ts'), "export {default} from './config/client';\n");
    }
    install(root); run(root, 'npm', ['run', 'typecheck']); run(root, 'npm', ['run', 'build']);
    for (const phase of ['react', 'kanso']) {
      if (phase === 'kanso') {
        const report = await migrate({ root, apply: true, local: process.cwd() }); assert.deepEqual(report.diagnostics, []); assert.equal(report.applied, true);
        assert.deepEqual((await migrate({ root })).changes, []);
        await usePacked(root); install(root); run(root, 'npm', ['run', 'typecheck']); run(root, 'npm', ['run', 'build']);
        assert.deepEqual((await doctor({ root })).diagnostics, []);
        const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
        assert.equal(Object.keys(lock.packages).some(name => /node_modules\/(react|react-dom)$/.test(name)), false);
      }
      server = await start(root, viteArgs('preview', 4181), 4181);
      for (const name of browsers) {
        const browser = await engines[name].launch();
        try { const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message)); await scenario(page, kind); assert.deepEqual(errors, []); results.push({ kind, phase, browser: name, passed: true }); }
        finally { await browser.close(); }
      }
      await stop(server); server = undefined;
    }
    console.log(`DX migration passed: ${kind}`);
  }
  for (const template of ['csr', 'ssr']) {
    const root = await mkdtemp(join(tmpdir(), `kanso-dx-starter-${template}-`));
    await createProject(root, undefined, { template }); await usePacked(root);
    if (template === 'csr') {
      const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      Object.assign(pkg.devDependencies, { vitest: '4.1.11', jsdom: '26.1.0', '@testing-library/dom': '10.4.1' });
      await writeFile(join(root, 'package.json'), JSON.stringify(pkg, null, 2));
      await cp('tests/fixtures/testing/Counter.test.tsx', join(root, 'src/Counter.test.tsx'));
      await cp('tests/fixtures/testing/vitest.config.ts', join(root, 'vitest.config.ts'));
    }
    install(root, template === 'csr');
    if (template === 'csr') {
      run(root, process.execPath, ['node_modules/vitest/vitest.mjs', 'run']);
      results.push({ template, packedTesting: true, portal: true, reactiveProps: true, routerServices: true });
    }
    assert.deepEqual((await doctor({ root })).diagnostics, []);
    const cli = join(root, 'node_modules/@kanso/cli/dist/bin.js');
    const valid = JSON.parse(execFileSync(process.execPath, [cli, 'doctor', '--root', root, '--json'], { encoding: 'utf8' })); assert.deepEqual(valid.diagnostics, []);
    const configPath = join(root, 'tsconfig.json'); const originalConfig = await readFile(configPath, 'utf8');
    await writeFile(configPath, originalConfig.replace('preserve', 'react-jsx'));
    let invalid; try { execFileSync(process.execPath, [cli, 'doctor', '--root', root, '--json'], { encoding: 'utf8', stdio: 'pipe' }); } catch (error) { invalid = error; }
    assert.equal(invalid?.status, 2); assert.ok(JSON.parse(invalid.stdout).diagnostics.some(item => item.code === 'JSX_CONFIG'));
    await writeFile(configPath, originalConfig);
    let failure; try { execFileSync(process.execPath, [cli, 'doctor', '--root', join(root, 'missing')], { stdio: 'pipe' }); } catch (error) { failure = error; } assert.equal(failure?.status, 1);
    run(root, 'npm', ['run', 'typecheck']); run(root, 'npm', ['run', 'build']);
    if (template === 'ssr') {
      for (const phase of ['dev', 'production']) {
        server = await start(root, phase === 'dev' ? viteArgs('', 4181) : ['scripts/serve.mjs'], 4181, { PORT: '4181' });
        const html = await (await fetch('http://127.0.0.1:4181')).text();
        assert.match(html, /Hello from Kanso SSR/); assert.match(html, /<title[^>]*>My Kanso app<\/title>/);
        for (const name of browsers) {
          console.log(`SSR starter: ${phase}, ${name}`);
          const browser = await engines[name].launch();
          try {
            const page = await browser.newPage(); const errors = []; const dataRequests = []; page.on('pageerror', error => errors.push(error.message)); page.on('request', req => { if (req.url().includes('/_kanso/data')) dataRequests.push(req.url()); });
            await page.addInitScript(() => {
              const observer = new MutationObserver(() => { const input = document.querySelector('input[name=name]'); if (input) { window.initialInput = input; window.initialId = input.id; input.value = 'before hydration'; observer.disconnect(); } });
              observer.observe(document, { childList: true, subtree: true });
            });
            await page.route('**/src/main.tsx', async route => { await new Promise(resolve => setTimeout(resolve, 150)); await route.continue(); });
            await page.goto('http://127.0.0.1:4181'); await page.locator('#counter').click();
            await page.waitForFunction(() => document.querySelector('#counter')?.textContent === 'Count: 1');
            assert.deepEqual(await page.evaluate(() => ({ same: window.initialInput === document.querySelector('input[name=name]'), id: window.initialId === document.querySelector('input[name=name]').id, value: document.querySelector('input[name=name]').value })), { same: true, id: true, value: 'before hydration' });
            assert.equal(await page.locator('#counter').textContent(), 'Count: 1'); assert.deepEqual(dataRequests, []); assert.deepEqual(errors, []);
            let actions = 0;
            page.on('request', request => { if (request.method() === 'POST') actions++; });
            await page.getByLabel('Name', { exact: true }).fill('A');
            await page.getByRole('button', { name: 'Save', exact: true }).click();
            await page.getByText('Use at least two characters.', { exact: true }).waitFor();
            assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'A');
            let failRefresh = true;
            await page.route('**/_kanso/data?*', route => failRefresh ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.continue());
            await page.getByLabel('Name', { exact: true }).fill('Saved once');
            await page.getByRole('button', { name: 'Save', exact: true }).click();
            await page.getByRole('button', { name: 'Retry refresh' }).waitFor();
            assert.equal(actions, 2);
            failRefresh = false;
            await page.getByRole('button', { name: 'Retry refresh' }).click();
            await page.waitForFunction(() => document.querySelector('output')?.textContent === 'Saved once');
            assert.equal(actions, 2);
            assert.deepEqual(errors, []);
            const native = await browser.newContext({ javaScriptEnabled: false });
            try {
              const page = await native.newPage();
              await page.goto('http://127.0.0.1:4181');
              await page.getByLabel('Name', { exact: true }).fill('B');
              const invalid = page.waitForResponse(response => response.request().method() === 'POST');
              await page.getByRole('button', { name: 'Save', exact: true }).click();
              assert.equal((await invalid).status(), 422);
              await page.getByText('Use at least two characters.', { exact: true }).waitFor();
              assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'B');
              await page.getByLabel('Name', { exact: true }).fill('Native form');
              await page.getByRole('button', { name: 'Save', exact: true }).click();
              await page.waitForFunction(() => document.querySelector('output')?.textContent === 'Native form');
              assert.equal(new URL(page.url()).pathname, '/');
            } finally { await native.close(); }
            results.push({ template, phase, browser: name, passed: true });
          } finally { await browser.close(); }
        }
        if (phase === 'production') {
          const manifestFile = join(root, 'dist/kanso-manifest.json');
          const before = await readFile(manifestFile, 'utf8');
          try {
            await writeFile(manifestFile, JSON.stringify({ ...JSON.parse(before), buildId: 'different-build' }));
            const stale = await fetch('http://127.0.0.1:4181');
            assert.equal(stale.status, 503);
            assert.equal(stale.headers.get('Cache-Control'), 'no-store');
            assert.match(await stale.text(), /Restart the preview/);
            assert.equal((await fetch('http://127.0.0.1:4181', { method: 'HEAD' })).status, 503);
          } finally { await writeFile(manifestFile, before); }
          assert.equal((await fetch('http://127.0.0.1:4181')).status, 200);
        }
        await stop(server); server = undefined;
      }
    }
    results.push({ template, packedInstall: true, doctor: true, typecheck: true, build: true });
  }
  await writeFile('output/dx/results.json', JSON.stringify(results, null, 2));
  console.log('DX passed: React scenarios, transactional migration, packed installs, doctor, CSR/SSR starters.');
} finally { await stop(server); }
