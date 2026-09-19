import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const example = process.argv[2] ?? 'lab';
if (!['lab', 'catalog'].includes(example)) throw new Error('Unknown example');
const directory = `examples/${example}`;
const hash = createHash('sha256');
async function add(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (['dist', 'dist-server', 'node_modules'].includes(entry.name)) continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await add(path);
    else { hash.update(path); hash.update(await readFile(path)); }
  }
}
await add('packages'); await add(directory);
for (const file of ['package-lock.json', 'tsconfig.json', 'scripts/build.mjs', 'scripts/build-example.mjs']) hash.update(await readFile(file));
const env = { ...process.env, KANSO_BUILD_ID: hash.digest('hex').slice(0, 16) };
for (const extra of [[], ['--ssr', example === 'lab' ? 'server.ts' : 'src/server.ts', '--outDir', 'dist-server']]) {
  execFileSync('node_modules/.bin/vite', ['build', '--config', `${directory}/vite.config.ts`, ...extra], { stdio: 'inherit', env });
}
