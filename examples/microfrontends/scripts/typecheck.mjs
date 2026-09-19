import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { remoteNames } from './build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
for (const name of ['host', ...(await remoteNames(root))]) {
  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      '--noEmit',
      '--project',
      path.join(root, name, 'tsconfig.json'),
    ],
    { stdio: 'inherit' },
  );
}
