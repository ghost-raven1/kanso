import { readFile, readdir, writeFile, rename, rm, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, join } from 'node:path';
import { isBuiltin } from 'node:module';
import ts from 'typescript';
import { migrateSource } from './source.js';
import type { Change, Diagnostic, MigrationOptions, MigrationReport } from './types.js';
import { createHookAudit } from './hook-audit.js';
import { createProjectResolver, type ProjectResolver } from './resolver.js';
import { installedPackage, kansoPackageVersion } from './packages.js';
import { enableTsconfigPaths } from './vite-config.js';
import { migrationEntries } from './entries.js';

export async function dependsOnReact(root: string, name: string, seen = new Set<string>()): Promise<boolean> {
  if (name.startsWith('@kanso/') || isBuiltin(name)) return false;
  if (['react', 'react-dom'].includes(name)) return true;
  let item;
  try { item = await installedPackage(root, name); }
  catch (error) { if (/^(?:@mui\/|antd$|styled-components$|react-|@react-)/.test(name)) return true; throw error; }
  const { file, manifest: pkg } = item;
  if (seen.has(file)) return false;
  seen.add(file);
  if (Object.keys(pkg.peerDependencies ?? {}).some(item => ['react', 'react-dom'].includes(item))) return true;
  for (const child of Object.keys(pkg.dependencies ?? {})) if (await dependsOnReact(dirname(file), child, seen)) return true;
  return false;
}

/** Audit first; commit only a fully checked change set, rolling back our own writes on failure. */
export async function migrate(options: MigrationOptions): Promise<MigrationReport> {
  const root = await realpath(resolve(options.root));
  const diagnostics: Diagnostic[] = [];
  const changes: Change[] = [];
  const seen = new Set<string>();
  const entryFiles = new Set<string>();
  const configFiles = new Set<string>();
  let complete = true;

  const packageFile = join(root, 'package.json');
  const originalPackage = await readFile(packageFile, 'utf8');
  const pkg = JSON.parse(originalPackage);
  const error = (file: string, code: string, message: string) => diagnostics.push({ file: relative(root, file), code, message, severity: 'error' });
  const resolvers: ProjectResolver[] = [];
  for (const config of options.configs?.length ? options.configs : [undefined]) {
    try {
      const resolver = await createProjectResolver(root, { config, inventory: true });
      resolvers.push(resolver);
      resolver.configFiles.forEach(file => configFiles.add(file));
      if (resolver.configError) {
        complete = false;
        error(resolver.configFile ?? root, resolver.configError.message.match(/[A-Z_]+:/)?.[0].slice(0, -1) ?? 'CONFIG', resolver.configError.message);
      }
    } catch (caught) {
      complete = false;
      const message = String(caught);
      error(config ? resolve(root, config) : root, message.match(/[A-Z_]+:/)?.[0].slice(0, -1) ?? 'CONFIG', message);
    }
  }
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    try {
      if (!['react', 'react-dom'].includes(name) && await dependsOnReact(root, name)) error(packageFile, 'REACT_DEPENDENCY', `${name} depends on React and must be replaced or ported.`);
    } catch (caught) { error(packageFile, 'DEPENDENCY_AUDIT', String(caught)); }
  }
  const stage = (change: Change) => {
    const existing = changes.find(item => item.file === change.file);
    if (!existing) changes.push(change);
    else if (existing.after !== change.after) { complete = false; error(join(root, change.file), 'GRAPH_CONFLICT', 'Selected configurations require different transformations of this source. Migrate these applications separately.'); }
  };
  for (const resolver of resolvers) {
    const auditHooks = createHookAudit(root, resolver.resolve);
    const visited = new Set<string>();
    const visit = async (file: string): Promise<void> => {
    if (visited.has(file) || !/\.[cm]?[jt]sx?$/.test(file)) return;
    if (relative(root, file).startsWith('..')) { complete = false; error(file, 'EXTERNAL_SOURCE', 'Audit shared source in its owning project before migration.'); return; }
    visited.add(file);
    seen.add(file);
    const before = await readFile(file, 'utf8');
    try {
      const result = migrateSource(before, relative(root, file), await auditHooks(file), { configuration: configFiles.has(file) });
      if (file === resolver.configFile && resolver.paths && !resolver.configError) result.code = enableTsconfigPaths(result.code, file, resolver.configExport);
      diagnostics.push(...result.diagnostics);
      if (result.diagnostics.some(item => item.code === 'DYNAMIC_IMPORT')) complete = false;
      if (before !== result.code) stage({ file: relative(root, file), before, after: result.code });
      for (const specifier of result.imports) {
        try {
        const dependency = await resolver.resolve(file, specifier);
        if (specifier.startsWith('.') || dependency) {
          if (!dependency) { complete = false; error(file, 'UNRESOLVED_IMPORT', `Cannot resolve ${specifier}.`); }
          else if (relative(root, dependency).startsWith('..')) { complete = false; error(file, 'EXTERNAL_SOURCE', `Audit shared source ${specifier} in its owning project first.`); }
          else await visit(dependency);
        }
        else if (!['react', 'react-dom/client', 'vite', '@vitejs/plugin-react', '@vitejs/plugin-react-swc'].includes(specifier) && !specifier.startsWith('@kanso/') && !specifier.startsWith('node:')) {
          const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
          try { if (await dependsOnReact(root, name)) error(file, 'REACT_DEPENDENCY', `${specifier} depends on React and requires a port.`); }
          catch (caught) { complete = false; error(file, 'DEPENDENCY_AUDIT', String(caught)); }
        }
        } catch (caught) {
          complete = false;
          const message = caught instanceof Error ? caught.message : String(caught);
          error(file, message.match(/^[A-Z_]+:/)?.[0].slice(0, -1) ?? 'RESOLVE', message);
        }
      }
    } catch (caught) { complete = false; error(file, 'PARSE', caught instanceof Error ? caught.message : String(caught)); }
  };
    try {
      const entries = await migrationEntries(root, options.entries?.length ? options.entries : resolver.entries, resolver.entryRoot);
      for (const entry of entries) { entryFiles.add(entry); await visit(entry); }
    } catch (caught) { complete = false; error(root, 'ENTRY', caught instanceof Error ? caught.message : String(caught)); }
    for (const file of resolver.configFiles) await visit(file);
  }
  for (const file of await readdir(root)) {
    if (/^tsconfig.*\.json$/.test(file)) {
      const before = await readFile(join(root, file), 'utf8');
      const parsed = ts.parseConfigFileTextToJson(file, before);
      if (parsed.error) { error(join(root, file), 'TSCONFIG', 'Cannot parse TypeScript configuration.'); continue; }
      if (parsed.config.compilerOptions?.jsx || file === 'tsconfig.json' && resolvers.some(resolver => resolver.compilerOptions.jsx)) {
        parsed.config.compilerOptions ??= {};
        if (parsed.config.compilerOptions.jsx === 'preserve' && parsed.config.compilerOptions.jsxImportSource === '@kanso/core') continue;
        parsed.config.compilerOptions.jsx = 'preserve'; parsed.config.compilerOptions.jsxImportSource = '@kanso/core';
        const after = JSON.stringify(parsed.config, null, 2) + '\n';
        if (before !== after) stage({ file, before, after });
      }
    }
  }
  const needsMigration = Object.keys(pkg.dependencies ?? {}).some(name => ['react', 'react-dom'].includes(name)) || changes.length > 0;
  if (needsMigration) {
    for (const section of ['dependencies', 'devDependencies']) {
      for (const name of ['react', 'react-dom', '@types/react', '@types/react-dom', '@vitejs/plugin-react', '@vitejs/plugin-react-swc']) delete pkg[section]?.[name];
    }
    const version = (name: string) => kansoPackageVersion(name, options.local);
    pkg.dependencies = { ...pkg.dependencies, '@kanso/core': pkg.dependencies?.['@kanso/core'] ?? version('core') };
    pkg.devDependencies = { ...pkg.devDependencies, '@kanso/vite': pkg.devDependencies?.['@kanso/vite'] ?? version('vite') };
    stage({ file: 'package.json', before: originalPackage, after: JSON.stringify(pkg, null, 2) + '\n' });
  }
  const unique = diagnostics.filter((item, index) => diagnostics.findIndex(other => JSON.stringify(other) === JSON.stringify(item)) === index);
  const relativeFiles = (files: Set<string>) => [...files].map(file => relative(root, file)).sort();
  const report: MigrationReport = { diagnostics: unique, changes, applied: false, modules: seen.size,
    coverage: { complete, entries: relativeFiles(entryFiles), configs: relativeFiles(configFiles), files: relativeFiles(seen) } };
  if (!options.apply || diagnostics.some(item => item.severity === 'error')) return report;
  for (const change of changes) if (await readFile(join(root, change.file), 'utf8') !== change.before) throw new Error(`Concurrent edit: ${change.file}`);
  const written: Change[] = [];
  try {
    for (const change of changes) {
      const target = join(root, change.file);
      const temporary = `${target}.kanso-${process.pid}`;
      try { await writeFile(temporary, change.after); await rename(temporary, target); written.push(change); }
      finally { await rm(temporary, { force: true }); }
    }
  } catch (caught) {
    for (const change of written.reverse()) if (await readFile(join(root, change.file), 'utf8') === change.after) await writeFile(join(root, change.file), change.before);
    throw caught;
  }
  report.applied = true;
  return report;
}
