import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';
import { nodeHandler } from '@kanso/app/node';

const output = resolve('output/services');
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'kanso-services-'));
const results = [];
let server;
try {
  const dependencies = { zustand: '5.0.15' };
  for (const name of [
    'core',
    'compiler',
    'app',
    'microfrontends',
    'vite',
    'cli',
  ]) {
    const packed = JSON.parse(
      execFileSync('npm', ['pack', '--json', '--pack-destination', output], {
        cwd: `packages/${name}`,
        encoding: 'utf8',
      }),
    );
    dependencies[`@kanso/${name}`] = `file:${join(output, packed[0].filename)}`;
  }
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      type: 'module',
      dependencies,
      devDependencies: { typescript: '^5.9.0', vite: '^8.3.0' },
    }),
  );
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--omit=peer', '--no-audit', '--no-fund'],
    { cwd: root, stdio: 'inherit' },
  );
  const lock = JSON.parse(
    await readFile(join(root, 'package-lock.json'), 'utf8'),
  );
  assert.equal(
    Object.keys(lock.packages).some(path =>
      /node_modules\/(react|react-dom)$/.test(path),
    ),
    false,
  );
  await cp('tests/fixtures/services', root, { recursive: true });
  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        skipLibCheck: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'preserve',
        jsxImportSource: '@kanso/core',
        lib: ['ES2022', 'DOM'],
      },
      include: ['*.tsx'],
    }),
  );
  execFileSync(
    process.execPath,
    ['node_modules/typescript/bin/tsc', '--noEmit'],
    { cwd: root, stdio: 'inherit' },
  );
  await writeFile(
    join(root, 'vite.config.ts'),
    `import {defineConfig} from 'vite';import kanso from '@kanso/vite';export default defineConfig({plugins:[kanso()],build:{rollupOptions:{input:['client.tsx','server.tsx']}}});`,
  );
  const cli = join(root, 'node_modules/@kanso/cli/dist/bin.js');
  const command = (cwd, ...args) => {
    const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
      cwd,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.deepEqual(command(root, 'doctor').diagnostics, []);
  const migration = join(root, 'migration');
  await mkdir(migration);
  await writeFile(
    join(migration, 'package.json'),
    JSON.stringify({
      type: 'module',
      dependencies: { ...dependencies, react: '*', 'react-dom': '*' },
      devDependencies: {
        '@kanso/vite': dependencies['@kanso/vite'],
        vite: '^8.3.0',
        typescript: '^5.9.0',
      },
    }),
  );
  await writeFile(
    join(migration, 'index.html'),
    '<div id="root"></div><script type="module" src="/main.tsx"></script>',
  );
  const original = `import {createRoot} from 'react-dom/client';import {value} from './store';function App(){return <p>{value}</p>}createRoot(document.getElementById('root')!).render(<App/>);`;
  await writeFile(join(migration, 'main.tsx'), original);
  await writeFile(
    join(migration, 'store.ts'),
    `import {createStore} from 'zustand/vanilla';const store=createStore(()=>({count:3}));export const value=store.getState().count;`,
  );
  await writeFile(
    join(migration, 'vite.config.ts'),
    `import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';export default defineConfig({plugins:[react()]});`,
  );
  await writeFile(
    join(migration, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        skipLibCheck: true,
        jsx: 'react-jsx',
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
      },
      include: ['main.tsx', 'store.ts'],
    }),
  );
  assert.deepEqual(command(migration, 'migrate', '--check').diagnostics, []);
  assert.equal(await readFile(join(migration, 'main.tsx'), 'utf8'), original);
  const applied = command(migration, 'migrate', '--apply');
  assert.equal(applied.applied, true);
  assert.deepEqual(command(migration, 'migrate', '--apply').changes, []);
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--omit=peer', '--no-audit', '--no-fund'],
    { cwd: migration, stdio: 'inherit' },
  );
  assert.deepEqual(command(migration, 'doctor').diagnostics, []);
  execFileSync(
    process.execPath,
    ['node_modules/typescript/bin/tsc', '--noEmit'],
    { cwd: migration, stdio: 'inherit' },
  );
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
    cwd: migration,
    stdio: 'inherit',
  });
  const migratedLock = JSON.parse(
    await readFile(join(migration, 'package-lock.json'), 'utf8'),
  );
  assert.equal(
    Object.keys(migratedLock.packages).some(path =>
      /node_modules\/(react|react-dom)$/.test(path),
    ),
    false,
  );
  const safe = await readFile(join(migration, 'store.ts'), 'utf8');
  const packageBefore = await readFile(join(migration, 'package.json'), 'utf8');
  await writeFile(
    join(migration, 'store.ts'),
    safe.replace('zustand/vanilla', 'zustand'),
  );
  for (const args of [['migrate', '--apply'], ['doctor']]) {
    const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
      cwd: migration,
      encoding: 'utf8',
    });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.ok(
      JSON.parse(result.stdout).diagnostics.some(
        item => item.code === 'REACT_DEPENDENCY',
      ),
    );
  }
  assert.equal(
    await readFile(join(migration, 'package.json'), 'utf8'),
    packageBefore,
  );
  results.push({
    scenario: 'packed-vanilla-audit',
    passed: true,
    migration: true,
    doctor: true,
    idempotent: true,
    reactEntryBlocked: true,
    typecheck: true,
    build: true,
  });
  console.log(
    'Packed CLI: vanilla migration, doctor, install/build, idempotence and React entry rejection passed',
  );
  const { compile } = await import(
    pathToFileURL(join(root, 'node_modules/@kanso/compiler/dist/index.js')).href
  );
  for (const kind of ['server', 'client']) {
    const ssr = kind === 'server';
    await build({
      entryPoints: [join(root, `${kind}.tsx`)],
      outfile: join(root, `${kind}.js`),
      bundle: true,
      format: 'esm',
      platform: ssr ? 'node' : 'browser',
      conditions: ssr ? ['node'] : ['browser'],
      tsconfigRaw: {},
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [
        {
          name: 'kanso-fixture',
          setup(builder) {
            builder.onLoad({ filter: /\.tsx$/ }, async ({ path }) => ({
              contents: compile(await readFile(path, 'utf8'), {
                filename: path,
                generate: ssr ? 'ssr' : 'dom',
              }).code,
              loader: 'js',
            }));
          },
        },
      ],
    });
  }
  const entry = await import(pathToFileURL(join(root, 'server.js')).href);
  const script = await readFile(join(root, 'client.js'));
  server = createServer((request, response) => {
    if (request.url === '/client.js') {
      response.setHeader('content-type', 'text/javascript');
      response.end(script);
      return;
    }
    void nodeHandler(entry.handle, `http://127.0.0.1:${server.address().port}`)(
      request,
      response,
    );
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    if (
      process.env.KANSO_BROWSERS &&
      !process.env.KANSO_BROWSERS.split(',').includes(name)
    )
      continue;
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      const errors = [];
      let dataRequests = 0;
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        if (request.url().includes('/_kanso/data')) dataRequests++;
      });
      let release;
      const gate = new Promise(resolve => {
        release = resolve;
      });
      await page.route('**/client.js', async route => {
        await gate;
        await route.continue();
      });
      await page.goto(origin + '/one', { waitUntil: 'commit' });
      await page.locator('#draft').waitFor();
      assert.equal(await page.locator('#server-snapshot').textContent(), '42');
      await page.evaluate(() => {
        window.original = document.querySelector('#draft');
        window.original.value = 'before hydration';
        window.original.focus();
      });
      release();
      await page.waitForFunction(() => window.ready);
      assert.equal(await page.locator('#server-snapshot').textContent(), '900');
      assert.equal(
        await page.locator('#draft').inputValue(),
        'before hydration',
      );
      assert.equal(
        await page.evaluate(
          () => window.original === document.querySelector('#draft'),
        ),
        true,
      );
      assert.equal(dataRequests, 0);
      assert.equal(await page.locator('#name').textContent(), 'one');
      assert.deepEqual(await page.locator('[data-count]').allTextContents(), [
        '3',
        '3',
      ]);
      await page.locator('[data-count]').first().click();
      assert.deepEqual(await page.locator('[data-count]').allTextContents(), [
        '4',
        '4',
      ]);
      const effects = await page.evaluate(() => trace.effects);
      await page.locator('#rename').click();
      assert.equal(await page.evaluate(() => trace.effects), effects);
      await page.locator('#refresh').click();
      await page.waitForFunction(
        () =>
          window.readStore().name === 'one' && window.readStore().count === 3,
      );
      await page.getByRole('link', { name: 'Two', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('#name')?.textContent === 'two',
      );
      await page.goBack();
      await page.waitForFunction(
        () => document.querySelector('#name')?.textContent === 'one',
      );
      await page.goForward();
      await page.waitForFunction(
        () => document.querySelector('#name')?.textContent === 'two',
      );
      assert.equal(
        await page.evaluate(() => trace.factories),
        1,
        'navigation restores the existing instance',
      );
      // Revalidation while a transition is waiting must target the destination URL.
      const overlapping = [];
      let resumeNavigation;
      let reachedNavigation;
      const navigationGate = new Promise(resolve => {
        resumeNavigation = resolve;
      });
      const navigationReached = new Promise(resolve => {
        reachedNavigation = resolve;
      });
      let held = false;
      await page.route('**/_kanso/data?*', async route => {
        const url = new URL(route.request().url()).searchParams.get('url');
        overlapping.push(url);
        if (url === '/one' && !held) {
          held = true;
          reachedNavigation();
          await navigationGate;
        }
        await route.continue();
      });
      await page.getByRole('link', { name: 'One', exact: true }).click();
      await navigationReached;
      await page.locator('#refresh').click();
      assert.equal(
        await page.locator('#refresh-status').textContent(),
        'pending',
      );
      resumeNavigation();
      await page.waitForFunction(
        () => document.querySelector('#refresh-status')?.textContent === 'idle',
      );
      assert.deepEqual(
        overlapping,
        ['/one', '/one'],
        'refresh must not fetch the page being left',
      );
      assert.equal(await page.locator('#name').textContent(), 'one');
      assert.equal(await page.locator('#refresh-error').textContent(), '');
      await page.unroute('**/_kanso/data?*');
      await page.getByRole('link', { name: 'Two', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('#name')?.textContent === 'two',
      );
      let releaseOld;
      let intercepted;
      const oldGate = new Promise(resolve => {
        releaseOld = resolve;
      });
      const oldRequest = new Promise(resolve => {
        intercepted = resolve;
      });
      await page.route('**/_kanso/data?*', async route => {
        if (
          new URL(route.request().url()).searchParams.get('url') !== '/slow'
        ) {
          await route.continue();
          return;
        }
        intercepted();
        await oldGate;
        await route
          .fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              version: 1,
              buildId: 'services-fixture',
              url: '/slow',
              data: { page: {} },
              services: { settings: { name: 'STALE', count: 99 } },
            }),
          })
          .catch(() => {});
      });
      await page.getByRole('link', { name: 'Slow', exact: true }).click();
      await oldRequest;
      await page.getByRole('link', { name: 'One', exact: true }).click();
      await page.waitForFunction(() => window.readStore().name === 'one');
      releaseOld();
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.readStore().name), 'one');
      assert.equal(await page.evaluate(() => trace.subscriptions), 3);
      await page.evaluate(() => window.dispose());
      assert.deepEqual(
        await page.evaluate(() => ({
          subscriptions: trace.subscriptions,
          cleanup: trace.cleanup,
        })),
        { subscriptions: 0, cleanup: 1 },
      );
      assert.deepEqual(errors, []);
      assert.equal(entry.trace.subscriptions, 0, 'SSR never subscribes');
      assert.equal(
        entry.trace.factories,
        entry.trace.cleanup,
        'each server scope is disposed',
      );
      results.push({
        browser: name,
        passed: true,
        packed: true,
        overlappingRevalidation: true,
        zustand: '5.0.15',
      });
      console.log(
        `${name}: packed stores, SSR hydration, navigation, stale responses and cleanup passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(results, null, 2),
  );
  // The compatibility suite publishes its results in the existing CI artifact directory.
  await mkdir('output/browser', { recursive: true });
  await writeFile(
    'output/browser/services-results.json',
    JSON.stringify(results, null, 2),
  );
  await rm(root, { recursive: true, force: true });
}
