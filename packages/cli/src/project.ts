import { readFile, readdir, writeFile, rename, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, relative, dirname, extname, join } from 'node:path';
import ts from 'typescript';
import { migrateSource } from './source.js';
import type { Change, Diagnostic, MigrationOptions, MigrationReport } from './types.js';

const extensions = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];
const exists = async (path: string) => { try { return (await stat(path)).isFile(); } catch { return false; } };

async function resolveModule(from: string, specifier: string): Promise<string | undefined> {
  const base = resolve(dirname(from), specifier);
  for (const suffix of extensions) if (await exists(base + suffix)) return base + suffix;
  if (/\.js$/.test(base)) for (const suffix of ['.ts', '.tsx']) if (await exists(base.slice(0, -3) + suffix)) return base.slice(0, -3) + suffix;
  return undefined;
}

async function dependsOnReact(root: string, name: string, seen = new Set<string>()): Promise<boolean> {
  if (seen.has(name) || name.startsWith('@kanso/')) return false;
  seen.add(name);
  if (['react', 'react-dom'].includes(name)) return true;
  const require = createRequire(join(root, 'package.json'));
  let file: string;
  try { file = require.resolve(`${name}/package.json`); }
  catch {
    try {
      let directory = dirname(require.resolve(name));
      while (!await exists(join(directory, 'package.json'))) {
        const parent = dirname(directory); if (parent === directory) return false; directory = parent;
      }
      file = join(directory, 'package.json');
    } catch {
      if (/^(?:@mui\/|antd$|styled-components$|react-|@react-)/.test(name)) return true;
      throw new Error(`Cannot inspect ${name}; install its dependencies before migration.`);
    }
  }
  const pkg = JSON.parse(await readFile(file, 'utf8')) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
  if (Object.keys(pkg.peerDependencies ?? {}).some(item => ['react', 'react-dom'].includes(item))) return true;
  for (const child of Object.keys(pkg.dependencies ?? {})) if (await dependsOnReact(dirname(file), child, seen)) return true;
  return false;
}

/** Audit first; commit only a fully checked change set, rolling back our own writes on failure. */
export async function migrate(options: MigrationOptions): Promise<MigrationReport> {
  const root = resolve(options.root);
  const diagnostics: Diagnostic[] = [];
  const changes: Change[] = [];
  const seen = new Set<string>();
  const packageFile = join(root, 'package.json');
  const originalPackage = await readFile(packageFile, 'utf8');
  const pkg = JSON.parse(originalPackage);
  const error = (file: string, code: string, message: string) => diagnostics.push({ file: relative(root, file), code, message, severity: 'error' });
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    try {
      if (!['react', 'react-dom'].includes(name) && await dependsOnReact(root, name)) error(packageFile, 'REACT_DEPENDENCY', `${name} depends on React and must be replaced or ported.`);
    } catch (caught) { error(packageFile, 'DEPENDENCY_AUDIT', String(caught)); }
  }
  const visit = async (file: string): Promise<void> => {
    if (seen.has(file) || !/\.[cm]?[jt]sx?$/.test(file)) return;
    seen.add(file);
    const before = await readFile(file, 'utf8');
    try {
      const result = migrateSource(before, relative(root, file));
      diagnostics.push(...result.diagnostics);
      if (before !== result.code) changes.push({ file: relative(root, file), before, after: result.code });
      for (const specifier of result.imports) {
        if (specifier.startsWith('.')) {
          const dependency = await resolveModule(file, specifier);
          if (!dependency) error(file, 'UNRESOLVED_IMPORT', `Cannot resolve ${specifier}.`);
          else if (relative(root, dependency).startsWith('..')) error(file, 'EXTERNAL_SOURCE', `Audit shared source ${specifier} in its owning project first.`);
          else await visit(dependency);
        } else if (/^[@~]\//.test(specifier)) error(file, 'PATH_ALIAS', `Resolve source alias ${specifier} before automatic migration.`);
        else if (!['react', 'react-dom/client', 'vite', '@vitejs/plugin-react', '@vitejs/plugin-react-swc'].includes(specifier) && !specifier.startsWith('@kanso/') && !specifier.startsWith('node:')) {
          const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
          try { if (await dependsOnReact(root, name)) error(file, 'REACT_DEPENDENCY', `${specifier} depends on React and requires a port.`); }
          catch (caught) { error(file, 'DEPENDENCY_AUDIT', String(caught)); }
        }
      }
    } catch (caught) { error(file, 'PARSE', caught instanceof Error ? caught.message : String(caught)); }
  };
  const html = join(root, 'index.html');
  const entry = await exists(html) ? (await readFile(html, 'utf8')).match(/<script\b[^>]*\bsrc=["']([^"']+\.[jt]sx?)["']/)?.[1] : undefined;
  if (entry) await visit(resolve(root, entry.replace(/^\//, '')));
  else error(html, 'ENTRY', 'A Vite index.html with a static module entry is required.');
  for (const file of await readdir(root)) {
    if (/^vite\.config\.[cm]?[jt]s$/.test(file)) await visit(join(root, file));
    if (/^tsconfig.*\.json$/.test(file)) {
      const before = await readFile(join(root, file), 'utf8');
      const parsed = ts.parseConfigFileTextToJson(file, before);
      if (parsed.error) { error(join(root, file), 'TSCONFIG', 'Cannot parse TypeScript configuration.'); continue; }
      if (parsed.config.compilerOptions?.jsx) {
        if (parsed.config.compilerOptions.jsx === 'preserve' && parsed.config.compilerOptions.jsxImportSource === '@kanso/core') continue;
        parsed.config.compilerOptions.jsx = 'preserve'; parsed.config.compilerOptions.jsxImportSource = '@kanso/core';
        const after = JSON.stringify(parsed.config, null, 2) + '\n';
        if (before !== after) changes.push({ file, before, after });
      }
    }
  }
  const needsMigration = Object.keys(pkg.dependencies ?? {}).some(name => ['react', 'react-dom'].includes(name)) || changes.length > 0;
  if (needsMigration) {
    for (const section of ['dependencies', 'devDependencies']) {
      for (const name of ['react', 'react-dom', '@types/react', '@types/react-dom', '@vitejs/plugin-react', '@vitejs/plugin-react-swc']) delete pkg[section]?.[name];
    }
    const version = (name: string) => options.local ? `file:${resolve(options.local, 'packages', name)}` : '^0.1.0';
    pkg.dependencies = { ...pkg.dependencies, '@kanso/core': pkg.dependencies?.['@kanso/core'] ?? version('core') };
    pkg.devDependencies = { ...pkg.devDependencies, '@kanso/vite': pkg.devDependencies?.['@kanso/vite'] ?? version('vite') };
    changes.push({ file: 'package.json', before: originalPackage, after: JSON.stringify(pkg, null, 2) + '\n' });
  }
  const report: MigrationReport = { diagnostics, changes, applied: false, modules: seen.size };
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
