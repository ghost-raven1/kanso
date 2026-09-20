import { readFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { installedPackage } from './packages.js';
import {
  entryTargets,
  packageFile,
  packageName,
  type InstalledPackage,
} from './package-entries.js';
import { runtimeImports } from './runtime-imports.js';

const react = (name: string) =>
  ['react', 'react-dom'].includes(packageName(name));
type Risk = 'none' | 'optional' | 'required';

export class DependencyAuditError extends Error {
  constructor(
    public code: 'REACT_DEPENDENCY' | 'DEPENDENCY_AUDIT',
    message: string,
  ) {
    super(message);
  }
}

/** Per-project proof cache; a safe subpath never exempts other entries of the same package. */
export function createDependencyAudit() {
  const proven = new Set<string>();
  const imports = new Map<string, Promise<void>>();
  const packages = new Map<string, Promise<InstalledPackage>>();
  const installed = (root: string, name: string) => {
    const key = join(root, name);
    let item = packages.get(key);
    if (!item) {
      item = installedPackage(root, name);
      packages.set(key, item);
    }
    return item;
  };
  const risk = async (
    root: string,
    name: string,
    seen = new Set<string>(),
  ): Promise<Risk> => {
    if (react(name)) return 'required';
    if (name.startsWith('@kanso/') || isBuiltin(name)) return 'none';
    let item: InstalledPackage;
    try {
      item = await installed(root, name);
    } catch (error) {
      if (/^(?:@mui\/|antd$|styled-components$|react-|@react-)/.test(name))
        return 'required';
      throw error;
    }
    if (seen.has(item.file)) return 'none';
    seen.add(item.file);
    let result: Risk = 'none';
    for (const peer of Object.keys(item.manifest.peerDependencies ?? {}))
      if (react(peer)) {
        if (!item.manifest.peerDependenciesMeta?.[peer]?.optional)
          return 'required';
        result = 'optional';
      }
    for (const child of Object.keys(item.manifest.dependencies ?? {})) {
      const value = await risk(dirname(item.file), child, seen);
      if (value === 'required') return value;
      if (value === 'optional') result = value;
    }
    return result;
  };
  const rejectReact = (message: string): never => {
    throw new DependencyAuditError('REACT_DEPENDENCY', message);
  };

  const prove = async (root: string, specifier: string): Promise<void> => {
    const seen = new Set<string>();
    const browsers = new Set<string>();
    const aliases = new Set<string>();
    const visitFile = async (
      pkg: InstalledPackage,
      from: string,
      target: string,
    ): Promise<void> => {
      const file = await packageFile(pkg, from, target);
      if (seen.has(file)) return;
      seen.add(file);
      if (file.endsWith('.json')) {
        JSON.parse(await readFile(file, 'utf8'));
        return;
      }
      for (const child of runtimeImports(
        await readFile(file, 'utf8'),
        `${pkg.manifest.name}/${relative(dirname(pkg.file), file)}`,
      )) {
        if (child.startsWith('.')) await visitFile(pkg, dirname(file), child);
        else await visitImport(dirname(file), child, pkg);
      }
    };
    const visitImport = async (
      from: string,
      name: string,
      owner?: InstalledPackage,
    ): Promise<void> => {
      if (react(name))
        rejectReact(
          `${specifier} loads ${name}; replace this import with a React-free entry.`,
        );
      if (['module', 'node:module', 'vm', 'node:vm'].includes(name))
        throw new Error(`${specifier} uses custom module loading via ${name}.`);
      if (isBuiltin(name) || name.startsWith('@kanso/')) return;
      if (/^(?:[./]|[a-z][a-z\d+.-]*:)/i.test(name))
        throw new Error(`Unsupported module specifier ${name}.`);
      const pkg =
        owner &&
        (name.startsWith('#') || packageName(name) === owner.manifest.name)
          ? owner
          : await installed(from, packageName(name));
      if (
        Object.keys(pkg.manifest.dependencies ?? {}).some(react) ||
        Object.keys(pkg.manifest.peerDependencies ?? {}).some(
          peer =>
            react(peer) && !pkg.manifest.peerDependenciesMeta?.[peer]?.optional,
        )
      )
        rejectReact(
          `${specifier} loads ${name}, which requires React; replace or port this dependency.`,
        );
      for (const target of entryTargets(pkg.manifest, name)) {
        if (name.startsWith('#') && !target.startsWith('.')) {
          const key = pkg.file + ':' + name;
          if (aliases.has(key))
            throw new Error(`Circular package import alias ${name}.`);
          aliases.add(key);
          try {
            await visitImport(dirname(pkg.file), target, pkg);
          } finally {
            aliases.delete(key);
          }
        } else await visitFile(pkg, dirname(pkg.file), target);
      }
      // Browser mappings may replace files or imports in any reachable module. Inspect all
      // replacements as well as originals; unsupported conditions fail closed.
      if (!browsers.has(pkg.file)) {
        browsers.add(pkg.file);
        const browser = pkg.manifest.browser;
        for (const target of typeof browser === 'string'
          ? [browser]
          : Object.values(browser ?? {})) {
          if (target === false) continue;
          if (typeof target !== 'string')
            throw new Error('Invalid browser mapping.');
          if (typeof browser === 'string' || target.startsWith('.'))
            await visitFile(pkg, dirname(pkg.file), target);
          else await visitImport(dirname(pkg.file), target, pkg);
        }
      }
    };
    await visitImport(root, specifier);
  };
  const check = (root: string, specifier: string): Promise<void> => {
    const key = join(root, specifier);
    let result = imports.get(key);
    if (!result) {
      result = (async () => {
        try {
          const name = packageName(specifier);
          const value = await risk(root, name);
          if (value === 'required')
            rejectReact(
              `${specifier} requires React through its dependencies or non-optional peers; replace or port this dependency.`,
            );
          if (value === 'optional') {
            await prove(root, specifier);
            proven.add((await installed(root, name)).file);
          }
        } catch (error) {
          if (error instanceof DependencyAuditError) throw error;
          throw new DependencyAuditError(
            'DEPENDENCY_AUDIT',
            `${specifier}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })();
      imports.set(key, result);
    }
    return result;
  };
  return {
    check,
    risk,
    /** Unused optional-peer packages need a safe root entry or must be removed. */
    async declaration(root: string, name: string) {
      const item =
        name.startsWith('@kanso/') || react(name)
          ? undefined
          : await installed(root, name).catch(() => undefined);
      if (item && proven.has(item.file)) return;
      await check(root, name);
    },
  };
}
