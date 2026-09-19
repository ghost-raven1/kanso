import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const vite = path.join(
  path.dirname(require.resolve('vite/package.json')),
  'bin/vite.js',
);

export function runVite(root, args, environment = {}) {
  execFileSync(process.execPath, [vite, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...environment },
  });
}

async function content(directory) {
  const files = {};
  for (const entry of await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    files[path.relative(directory, file)] = await readFile(file);
  }
  return files;
}

async function publish(staged, destination) {
  let exists = false;
  try {
    exists = (await stat(destination)).isDirectory();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (exists) {
    const [previous, next] = await Promise.all([
      content(destination),
      content(staged),
    ]);
    const keys = Object.keys(previous);
    if (
      keys.length !== Object.keys(next).length ||
      keys.some(key => !next[key] || !previous[key].equals(next[key]))
    ) {
      throw new Error(
        `Release ${path.basename(destination)} already exists with different files. Choose a new KANSO_BUILD_ID.`,
      );
    }
    return;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await rename(staged, destination);
}

/** Publish a complete browser/server release before changing its current pointer. */
export async function buildRemote({
  root = directory,
  buildId = process.env.KANSO_BUILD_ID ?? 'A',
  serverEntry = 'src/routes.tsx',
  environment = {},
} = {}) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(buildId))
    throw new Error('KANSO_BUILD_ID must be a URL-safe release identifier.');
  const stage = await mkdtemp(path.join(root, '.kanso-build-'));
  const variables = { ...environment, KANSO_BUILD_ID: buildId };
  try {
    runVite(
      root,
      ['build', '--outDir', path.join(stage, 'client'), '--emptyOutDir'],
      variables,
    );
    runVite(
      root,
      [
        'build',
        '--ssr',
        serverEntry,
        '--outDir',
        path.join(stage, 'server'),
        '--emptyOutDir',
      ],
      variables,
    );
    const client = path.join(root, 'dist', 'releases', buildId);
    const server = path.join(root, 'dist-server', 'releases', buildId);
    await publish(path.join(stage, 'server'), server);
    await publish(path.join(stage, 'client'), client);
    await cp(
      path.join(server, 'kanso-server.json'),
      path.join(root, 'dist-server', '.kanso-current.json'),
    );
    await rename(
      path.join(root, 'dist-server', '.kanso-current.json'),
      path.join(root, 'dist-server', 'kanso-server.json'),
    );
    await cp(
      path.join(client, 'kanso-remote.json'),
      path.join(root, 'dist', '.kanso-current.json'),
    );
    await rename(
      path.join(root, 'dist', '.kanso-current.json'),
      path.join(root, 'dist', 'kanso-remote.json'),
    );
    return { buildId, client, server };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildRemote();
