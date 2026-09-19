import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { createProjectResolver } from './resolver.js';
import { hasKansoPlugin } from './vite-config.js';
import { dependsOnReact } from './project.js';
import {
  installedPackage as installed,
  type PackageManifest as Manifest,
} from './packages.js';
import type { Diagnostic } from './types.js';
export interface DoctorReport {
  root: string;
  diagnostics: Diagnostic[];
  versions: Record<string, string>;
}

/** Inspect configuration and installed package graphs without executing project code or writing files. */
export async function doctor(
  options: { root?: string } = {},
): Promise<DoctorReport> {
  const root = resolve(options.root ?? process.cwd());
  const pkg = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8'),
  ) as Manifest;
  const report: DoctorReport = {
    root,
    diagnostics: [],
    versions: { node: process.versions.node },
  };
  const problem = (
    code: string,
    message: string,
    hint: string,
    file = 'package.json',
  ) =>
    report.diagnostics.push({ file, code, message, hint, severity: 'error' });
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!(
    (major === 20 && minor >= 19) ||
    (major === 22 && minor >= 12) ||
    major > 22
  ))
    problem(
      'NODE_VERSION',
      'Node does not satisfy Vite requirements.',
      'Use Node 20.19+ or 22.12+.',
    );
  const manifests = new Map<string, { file: string; manifest: Manifest }>();
  for (const name of new Set([
    '@kanso/core',
    '@kanso/vite',
    'vite',
    ...Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(
      name => name.startsWith('@kanso/'),
    ),
  ])) {
    try {
      const item = await installed(root, name);
      manifests.set(name, item);
      report.versions[name] = item.manifest.version;
    } catch {
      problem(
        'PACKAGE_MISSING',
        `${name} cannot be resolved.`,
        'Install the declared dependencies, then run kanso doctor again.',
      );
    }
  }
  const vite = report.versions.vite;
  if (vite && Number(vite.split('.')[0]) !== 8)
    problem(
      'VITE_VERSION',
      `Vite ${vite} is outside the tested major version.`,
      'Use Vite 8 with Kanso 0.4.',
    );
  const solid = new Set<string>();
  const visited = new Set<string>();
  const inspect = async (item: {
    file: string;
    manifest: Manifest;
  }): Promise<void> => {
    if (visited.has(item.file)) return;
    visited.add(item.file);
    if (item.manifest.name === 'solid-js') solid.add(item.file);
    if (
      item.manifest.name.startsWith('@kanso/') &&
      item.manifest.version !== report.versions['@kanso/core']
    )
      problem(
        'KANSO_VERSION',
        `${item.manifest.name}@${item.manifest.version} differs from core.`,
        'Install or rebuild all Kanso packages at one identical version.',
      );
    for (const name of Object.keys(item.manifest.dependencies ?? {})) {
      try {
        await inspect(await installed(dirname(item.file), name));
      } catch {
        problem(
          'DEPENDENCY_MISSING',
          `${item.manifest.name} cannot resolve ${name}.`,
          'Reinstall dependencies from the lockfile.',
        );
      }
    }
  };
  for (const item of manifests.values()) await inspect(item);
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    try {
      if (await dependsOnReact(root, name))
        problem(
          'REACT_DEPENDENCY',
          `${name} requires React.`,
          'Port or replace this dependency before running Kanso.',
        );
      await inspect(await installed(root, name));
    } catch (error) {
      problem(
        'DEPENDENCY_AUDIT',
        String(error),
        'Install dependencies before running the audit.',
      );
    }
  }
  if (solid.size > 1)
    problem(
      'SOLID_DUPLICATE',
      `${solid.size} physical copies of Solid are installed.`,
      'Align Solid versions and deduplicate dependencies; keep the Kanso Vite plugin enabled.',
    );
  try {
    const resolver = await createProjectResolver(root);
    let compilerOptions = resolver.compilerOptions;
    if (!compilerOptions.jsx) {
      const app = ts.readConfigFile(
        join(root, 'tsconfig.app.json'),
        ts.sys.readFile,
      );
      if (!app.error)
        compilerOptions = ts.parseJsonConfigFileContent(
          app.config,
          ts.sys,
          root,
        ).options;
    }
    if (
      compilerOptions.jsx !== ts.JsxEmit.Preserve ||
      compilerOptions.jsxImportSource !== '@kanso/core'
    )
      problem(
        'JSX_CONFIG',
        'TypeScript JSX settings do not target Kanso.',
        'Set jsx: "preserve" and jsxImportSource: "@kanso/core".',
        'tsconfig.json',
      );
    let enabled = false;
    if (resolver.configFile) {
      enabled = hasKansoPlugin(
        await readFile(resolver.configFile, 'utf8'),
        resolver.configFile,
      );
    }
    if (!enabled)
      problem(
        'VITE_PLUGIN',
        'The Kanso plugin is missing from the Vite configuration.',
        'Import kanso from "@kanso/vite" and add kanso() to plugins.',
        'vite.config.ts',
      );
  } catch (error) {
    problem(
      'CONFIG_AUDIT',
      String(error),
      'Use a statically inspectable configuration; see the migration guide.',
    );
  }
  return report;
}
