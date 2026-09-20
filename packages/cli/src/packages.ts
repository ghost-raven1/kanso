import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
export const KANSO_VERSION = '0.9.0';
export const KANSO_PACKAGES = ['core', 'compiler', 'vite', 'app', 'cli', 'microfrontends', 'workers'] as const;

/** Resolve all unpublished workspace packages consistently in generated projects. */
export function kansoPackageVersion(name: string, local?: string): string {
  return local ? `file:${resolve(local, 'packages', name)}` : `^${KANSO_VERSION}`;
}

/** Find packaged resources independently of bundled chunk names. */
export function cliAsset(...segments: string[]): string {
  return join(dirname(createRequire(import.meta.url).resolve('@kanso/cli')), ...segments);
}
export interface PackageManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  exports?: unknown;
  imports?: Record<string, unknown>;
  main?: string;
  module?: string;
  browser?: string | Record<string, string | false>;
}

/** Inspect installed npm packages even when their exports intentionally hide the manifest or root. */
export async function installedPackage(
  root: string,
  name: string,
): Promise<{ file: string; manifest: PackageManifest }> {
  const require = createRequire(join(root, 'package.json'));
  for (const directory of require.resolve.paths(name) ?? []) {
    const candidate = join(directory, name, 'package.json');
    try {
      const manifest = JSON.parse(
        await readFile(candidate, 'utf8'),
      ) as PackageManifest;
      if (manifest.name === name)
        return { file: await realpath(candidate), manifest };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error(
    `Cannot inspect ${name}; install its dependencies before the audit.`,
  );
}
