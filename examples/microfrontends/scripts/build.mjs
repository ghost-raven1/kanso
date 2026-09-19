import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRemote, runVite } from '../catalog/scripts/build.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));

export async function remoteNames(root = directory) {
  const names = [];
  for (const name of ['catalog', 'promotion']) {
    try {
      if ((await stat(path.join(root, name, 'package.json'))).isFile())
        names.push(name);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return names;
}

/** Build independently deployed remotes first, then the SSR shell. */
export async function buildPlatform({
  root = directory,
  buildId = process.env.KANSO_BUILD_ID ?? 'A',
  remote,
} = {}) {
  const names = await remoteNames(root);
  if (remote && !names.includes(remote))
    throw new Error(`Unknown remote: ${remote}`);
  for (const name of remote ? [remote] : names) {
    await buildRemote({
      root: path.join(root, name),
      buildId,
      serverEntry: name === 'promotion' ? 'src/Banner.tsx' : 'src/routes.tsx',
    });
  }
  if (!remote) {
    runVite(path.join(root, 'host'), ['build'], { KANSO_BUILD_ID: buildId });
    runVite(
      path.join(root, 'host'),
      ['build', '--ssr', 'src/server.ts', '--outDir', 'dist-server'],
      { KANSO_BUILD_ID: buildId },
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--remote');
  await buildPlatform({
    remote: index < 0 ? undefined : process.argv[index + 1],
  });
}
