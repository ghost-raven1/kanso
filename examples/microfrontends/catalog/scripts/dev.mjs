import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const directory = fileURLToPath(new URL('../', import.meta.url));

/** Serve the live federation entry while keeping SSR loading inside the shell. */
export async function createRemoteDevelopment({
  root = directory,
  port = Number(process.env.KANSO_REMOTE_PORT ?? 4201),
  buildId = 'local',
} = {}) {
  process.env.KANSO_BUILD_ID = buildId;
  const origin = `http://127.0.0.1:${port}`;
  const server = await createServer({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    base: `${origin}/releases/${buildId}/`,
    appType: 'custom',
    server: { host: '127.0.0.1', port, strictPort: true, origin, cors: true },
  });
  try {
    await server.listen();
    return server;
  } catch (error) {
    await server.close();
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await createRemoteDevelopment();
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      server.close().then(() => process.exit());
    });
  console.log(
    `Kanso remote development: http://127.0.0.1:${process.env.KANSO_REMOTE_PORT ?? 4201}/kanso-remote.json`,
  );
}
