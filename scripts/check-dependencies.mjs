import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const forbidden = /(?:^|node_modules\/)(?:react|react-dom|react-reconciler|babel-plugin-react-compiler)(?:$|\/)/;
const found = Object.keys(lock.packages).filter(name => forbidden.test(name));
assert.deepEqual(found, [], 'React must not enter the workspace dependency graph');
const federationRuntime = /@module-federation\/|__FEDERATION__|__GLOBAL_LOADING_REMOTE_ENTRY__|kanso_browser_|kanso_server_/;
for (const example of ['lab', 'catalog']) {
for (const file of await readdir(`examples/${example}/dist/assets`)) {
  if (!file.endsWith('.js')) continue;
  const source = await readFile(`examples/${example}/dist/assets/${file}`, 'utf8');
  assert.equal(/kanso\.hmr|Kanso HMR|hotRegistry/.test(source), false, `HMR runtime leaked into ${file}`);
  assert.equal(/KANSO_TEST_(?:ENVIRONMENT|CONTAINER|UNMOUNTED)/.test(source), false, `Testing runtime leaked into ${file}`);
  assert.equal(federationRuntime.test(source), false, `Federation runtime leaked into ordinary ${example} client ${file}`);
  assert.equal(/KANSO_SERVER_IMPLEMENTATION_ONLY|createDemoRequestStore|never-reflect/.test(source), false, `Server code leaked into ${file}`);
}
for (const file of await readdir(`examples/${example}/dist-server`, { recursive: true })) {
  if (!file.endsWith('.js')) continue;
  const source = await readFile(`examples/${example}/dist-server/${file}`, 'utf8');
  assert.equal(/kanso\.hmr|Kanso HMR|hotRegistry/.test(source), false, `HMR runtime leaked into SSR ${file}`);
  assert.equal(federationRuntime.test(source), false, `Federation runtime leaked into ordinary ${example} SSR ${file}`);
}
}
console.log(`Dependency audit passed: ${Object.keys(lock.packages).length} lockfile entries, no React packages; ordinary applications contain no federation/HMR runtime or client-side server implementation.`);
