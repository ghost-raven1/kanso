import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { installedPackage } from './packages.js';

interface Manifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: unknown;
  module?: string;
  main?: string;
}
interface Package {
  directory: string;
  manifest: Manifest;
}

/** Local source packages participate in the same audit as relative imports and aliases. */
export function createPackageSourceResolver(
  root: string,
  localFile: (file: string) => Promise<string | undefined>,
) {
  const owners = new Map<string, Promise<Package | undefined>>();
  const inside = (directory: string) => {
    const path = relative(root, directory);
    return path !== '..' && !path.startsWith('../') && !isAbsolute(path);
  };
  const owner = (directory: string): Promise<Package | undefined> => {
    let result = owners.get(directory);
    if (result) return result;
    result = (async () => {
      if (!inside(directory)) return undefined;
      try {
        return {
          directory,
          manifest: JSON.parse(
            await readFile(join(directory, 'package.json'), 'utf8'),
          ) as Manifest,
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      return directory === root ? undefined : owner(dirname(directory));
    })();
    owners.set(directory, result);
    return result;
  };
  const target = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return undefined;
    const conditions = value as Record<string, unknown>;
    if ('browser' in conditions || 'node' in conditions)
      throw new Error(
        'LOCAL_PACKAGE_CONDITIONS: select an explicit source alias for environment-specific workspace exports.',
      );
    return target(conditions.import ?? conditions.default);
  };
  return async (
    from: string,
    specifier: string,
  ): Promise<string | undefined> => {
    if (
      specifier.startsWith('.') ||
      specifier.startsWith('/') ||
      specifier.startsWith('node:')
    )
      return undefined;
    const name = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0];
    const subpath =
      specifier === name ? '.' : '.' + specifier.slice(name.length);
    let current = await owner(dirname(from));
    let directory: string | undefined;
    while (current) {
      const declared =
        current.manifest.dependencies?.[name] ??
        current.manifest.devDependencies?.[name];
      if (current.manifest.name === name) directory = current.directory;
      else if (declared?.startsWith('file:'))
        directory = resolve(current.directory, declared.slice(5));
      if (directory || current.directory === root) break;
      current = await owner(dirname(current.directory));
    }
    if (!directory) {
      try {
        directory = dirname((await installedPackage(dirname(from), name)).file);
      } catch {
        return undefined;
      }
    }
    directory = await realpath(directory);
    if (!inside(directory) || directory.split('/').includes('node_modules'))
      return undefined;
    const pkg = await owner(directory);
    if (!pkg || pkg.directory !== directory)
      throw new Error(
        `LOCAL_PACKAGE_SOURCE: missing package.json in ${directory}.`,
      );
    const exports = pkg.manifest.exports;
    let value = exports;
    if (
      exports &&
      typeof exports === 'object' &&
      !Array.isArray(exports) &&
      Object.keys(exports).some(key => key.startsWith('.'))
    )
      value = (exports as Record<string, unknown>)[subpath];
    else if (subpath !== '.') value = undefined;
    const entry =
      target(value) ??
      (exports === undefined
        ? subpath === '.'
          ? (pkg.manifest.module ?? pkg.manifest.main ?? './index.js')
          : subpath
        : undefined);
    if (!entry)
      throw new Error(
        `LOCAL_PACKAGE_SOURCE: ${specifier} needs an explicit ESM source export or source alias.`,
      );
    const candidate = resolve(directory, entry);
    if (!inside(candidate))
      throw new Error(
        `EXTERNAL_SOURCE: ${specifier} points outside this project.`,
      );
    const file = await localFile(candidate);
    if (!file || /\.d\.[cm]?ts$/.test(file))
      throw new Error(
        `LOCAL_PACKAGE_SOURCE: ${specifier} has no runtime source at ${entry}.`,
      );
    return file;
  };
}
