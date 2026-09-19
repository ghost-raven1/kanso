import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { start, stop } from './test-project.mjs';

const output = path.resolve('output/microfrontends-dx');
await mkdir(output, { recursive: true });
const root = await mkdtemp(path.join(output, 'run-'));
const packages = ['core', 'compiler', 'vite', 'app', 'cli', 'microfrontends', 'workers'];
const packed = {};
for (const name of packages) {
  const result = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', output], { cwd: `packages/${name}`, encoding: 'utf8' }))[0];
  packed[`@kanso/${name}`] = `file:${path.join(output, result.filename)}`;
}
function run(directory, args, environment = {}) {
  execFileSync(process.execPath, args, { cwd: directory, stdio: 'inherit', env: { ...process.env, ...environment } });
}
function npm(directory, args, environment = {}) {
  execFileSync('npm', args, { cwd: directory, stdio: 'inherit', env: { ...process.env, ...environment } });
}

const installer = path.join(root, 'installer');
await mkdir(installer);
await writeFile(path.join(installer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: packed }, null, 2));
npm(installer, ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
const cli = path.join(installer, 'node_modules/@kanso/cli/dist/bin.js');
const results = [];

for (const template of ['microfrontends', 'remote']) {
  const project = path.join(root, template);
  run(installer, [cli, 'create', project, '--template', template]);
  for (const entry of await readdir(project, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name !== 'package.json') continue;
    const file = path.join(entry.parentPath, entry.name);
    const pkg = JSON.parse(await readFile(file, 'utf8'));
    for (const field of ['dependencies', 'devDependencies']) {
      for (const name of Object.keys(pkg[field] ?? {})) if (packed[name]) pkg[field][name] = packed[name];
    }
    if (file === path.join(project, 'package.json')) {
      pkg.devDependencies ??= {};
      for (const [name, version] of Object.entries(packed)) if (!pkg.dependencies?.[name]) pkg.devDependencies[name] = version;
    }
    await writeFile(file, JSON.stringify(pkg, null, 2) + '\n');
  }
  npm(project, ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
  const require = createRequire(path.join(project, 'package.json'));
  for (const name of packages) assert.ok((await realpath(require.resolve(`@kanso/${name}`))).startsWith(project + path.sep), `Packed @kanso/${name} must resolve inside the isolated project`);

  const environment = template === 'microfrontends' ? {
    KANSO_BUILD_ID: 'A', KANSO_HOST_PORT: '4189',
    KANSO_REMOTE_PORT: '4281', KANSO_PRIVATE_PORT: '4381',
    KANSO_PROMOTION_PORT: '4282', KANSO_PROMOTION_PRIVATE_PORT: '4382',
    VITE_CATALOG_ORIGIN: 'http://127.0.0.1:4281', VITE_PROMOTION_ORIGIN: 'http://127.0.0.1:4282',
    KANSO_CATALOG_SERVER_ORIGIN: 'http://127.0.0.1:4381', KANSO_PROMOTION_SERVER_ORIGIN: 'http://127.0.0.1:4382',
  } : { KANSO_BUILD_ID: 'A', KANSO_REMOTE_PORT: '4283', KANSO_PRIVATE_PORT: '4383' };
  if (template === 'microfrontends') {
    for (const name of ['kanso.microfrontends.json', 'kanso-remotes.lock.json']) {
      const file = path.join(project, 'host', name);
      const text = (await readFile(file, 'utf8')).replaceAll(':4201', ':4281').replaceAll(':4301', ':4381').replaceAll(':4202', ':4282').replaceAll(':4302', ':4382');
      await writeFile(file, text);
    }
  }
  npm(project, ['run', 'typecheck']);
  npm(project, ['run', 'build'], environment);
  let server;
  try {
    const port = template === 'microfrontends' ? 4189 : 4283;
    server = await start(project, ['scripts/serve.mjs'], port, environment);
    const origin = `http://127.0.0.1:${port}`;
    if (template === 'microfrontends') {
      const response = await fetch(origin);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /data-remote-card=/);
      assert.match(html, /data-promotion="A"/);
      assert.match(html, /<title/);
      assert.match(await (await fetch(origin + '/catalog/product/camera')).text(), /Product: camera/);
      run(project, [cli, 'microfrontends', 'check', '--root', path.join(project, 'host'), '--json']);
    }
    const remoteOrigin = `http://127.0.0.1:${template === 'microfrontends' ? 4281 : 4283}`;
    const manifest = await (await fetch(remoteOrigin + '/kanso-remote.json')).json();
    assert.equal(manifest.buildId, 'A');
    assert.equal(manifest.server, undefined);
    assert.equal((await fetch(remoteOrigin + '/releases/A/kanso-server.json')).status, 404);
    assert.equal((await fetch(manifest.entry)).status, 200);
    assert.equal((await fetch(manifest.types)).status, 200);
    const privateOrigin = `http://127.0.0.1:${template === 'microfrontends' ? 4381 : 4383}`;
    const privateManifest = await (await fetch(privateOrigin + '/releases/A/kanso-server.json')).json();
    assert.equal(privateManifest.server, true);
    assert.equal(privateManifest.buildId, manifest.buildId);
    results.push({ template, packedInstall: true, typecheck: true, productionBuild: true, preview: true, privateArtifacts: true, ...(template === 'microfrontends' ? { ssr: true, seo: true, contracts: true } : {}) });
    console.log(`Packed microfrontend template passed: ${template}`);
  } finally { await stop(server); }
}
await writeFile(path.join(output, 'results.json'), JSON.stringify({ scenarios: results }, null, 2));
