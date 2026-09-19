import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const forbidden = /(?:^|node_modules\/)(?:react|react-dom|react-reconciler|babel-plugin-react-compiler)(?:$|\/)/;
const found = Object.keys(lock.packages).filter(name => forbidden.test(name));
assert.deepEqual(found, [], 'React must not enter the workspace dependency graph');
for (const file of await readdir('examples/lab/dist/assets')) {
  if (!file.endsWith('.js')) continue;
  const source = await readFile(`examples/lab/dist/assets/${file}`, 'utf8');
  assert.equal(/kanso\.hmr|Kanso HMR|hotRegistry/.test(source), false, `HMR runtime leaked into ${file}`);
  assert.equal(source.includes('KANSO_SERVER_IMPLEMENTATION_ONLY'), false, `Server code leaked into ${file}`);
}
for (const file of await readdir('examples/lab/dist-server', { recursive: true })) {
  if (!file.endsWith('.js')) continue;
  const source = await readFile(`examples/lab/dist-server/${file}`, 'utf8');
  assert.equal(/kanso\.hmr|Kanso HMR|hotRegistry/.test(source), false, `HMR runtime leaked into SSR ${file}`);
}
console.log(`Dependency audit passed: ${Object.keys(lock.packages).length} lockfile entries, no React packages; no HMR in production/SSR or server implementation in client chunks.`);
