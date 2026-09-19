import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { build } from 'vite';
const hash = createHash('sha256');
async function add(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = directory + '/' + entry.name;
    if (entry.isDirectory()) await add(path);
    else {
      hash.update(path);
      hash.update(await readFile(path));
    }
  }
}
await add('src');
for (const path of ['package.json', 'package-lock.json', 'vite.config.ts'])
  hash.update(await readFile(path));
process.env.KANSO_BUILD_ID = hash.digest('hex').slice(0, 16);
await build();
await build({ build: { ssr: 'src/server.ts', outDir: 'dist-server' } });
