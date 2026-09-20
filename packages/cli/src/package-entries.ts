import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { PackageManifest } from './packages.js';

export interface InstalledPackage {
  file: string;
  manifest: PackageManifest;
}

export const packageName = (specifier: string) =>
  specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];

/** Audit every runtime condition, conservatively including both import and require targets. */
function targets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value === null || value === false) return [];
  if (Array.isArray(value)) return value.flatMap(targets);
  if (value && typeof value === 'object')
    return Object.entries(value)
      .filter(([key]) => key !== 'types' && !key.startsWith('types@'))
      .flatMap(([, item]) => targets(item));
  throw new Error('Export has no statically inspectable runtime target.');
}

/** Exact subpaths precede patterns; the most specific pattern wins, including null exclusions. */
function mapped(map: Record<string, unknown>, key: string): string[] {
  if (Object.hasOwn(map, key)) return targets(map[key]);
  const patterns = Object.keys(map)
    .filter(item => item.includes('*'))
    .sort((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length);
  for (const pattern of patterns) {
    const [prefix, suffix] = pattern.split('*');
    if (pattern.split('*').length !== 2)
      throw new Error('Ambiguous package export pattern.');
    if (
      key.startsWith(prefix) &&
      key.endsWith(suffix) &&
      key.length >= prefix.length + suffix.length
    ) {
      const match = key.slice(prefix.length, key.length - suffix.length);
      return targets(map[pattern]).map(value => value.replaceAll('*', match));
    }
  }
  throw new Error(`Package does not export ${key}.`);
}

export function entryTargets(
  pkg: PackageManifest,
  specifier: string,
): string[] {
  if (specifier.startsWith('#')) return mapped(pkg.imports ?? {}, specifier);
  const subpath =
    specifier === pkg.name ? '.' : '.' + specifier.slice(pkg.name.length);
  if (pkg.exports !== undefined) {
    const value = pkg.exports;
    const result =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).some(key => key.startsWith('.'))
        ? mapped(value as Record<string, unknown>, subpath)
        : subpath === '.'
          ? targets(value)
          : [];
    if (result.some(item => !item.startsWith('./')))
      throw new Error('Package exports must be relative ./ targets.');
    if (!result.length)
      throw new Error(
        `Package does not export a runtime entry for ${specifier}.`,
      );
    return [...new Set(result)];
  }
  if (subpath !== '.') return [subpath];
  const entries = [
    ...new Set(
      [
        pkg.module,
        pkg.main,
        typeof pkg.browser === 'string' ? pkg.browser : undefined,
      ].filter((item): item is string => !!item),
    ),
  ];
  return entries.length ? entries : ['./index.js'];
}

/** Resolve real files inside the package; binary/custom loaders cannot establish a vanilla proof. */
export async function packageFile(
  pkg: InstalledPackage,
  from: string,
  target: string,
): Promise<string> {
  const directory = dirname(pkg.file);
  const base = resolve(from, target);
  const inside = (file: string) => {
    const path = relative(directory, file);
    return (
      path !== '..' &&
      !path.startsWith('../') &&
      !isAbsolute(path) &&
      !path.split('/').includes('node_modules')
    );
  };
  if (!inside(base) || /[?#%]/.test(target))
    throw new Error(`Unsupported package target ${target}.`);
  for (const suffix of [
    '',
    '.js',
    '.mjs',
    '.cjs',
    '.json',
    '/index.js',
    '/index.mjs',
    '/index.cjs',
  ]) {
    try {
      if (suffix.startsWith('/index')) {
        let scoped = false;
        try {
          await readFile(resolve(base, 'package.json'));
          scoped = true;
        } catch (error) {
          if (
            !['ENOENT', 'ENOTDIR'].includes(
              (error as NodeJS.ErrnoException).code ?? '',
            )
          )
            throw error;
        }
        if (scoped)
          throw new Error(
            `Directory entry ${target} has its own package.json; use an explicit file entry.`,
          );
      }
      if (!(await stat(base + suffix)).isFile()) continue;
      const file = await realpath(base + suffix);
      if (
        !inside(file) ||
        !/\.(?:[cm]?[jt]sx?|json)$/.test(file) ||
        /\.d\.[cm]?ts$/.test(file)
      )
        throw new Error(`Cannot audit runtime file ${file}.`);
      return file;
    } catch (error) {
      if (
        !['ENOENT', 'ENOTDIR'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      )
        throw error;
    }
  }
  throw new Error(`Cannot resolve ${target} from ${from}.`);
}
