import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { hasKansoPlugin } from './vite-config.js';
import { readMicrofrontendsConfig } from './microfrontends.js';
import { RUNTIME_VERSIONS } from '@kanso/microfrontends/manifest';
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

/** A direct config callback can be inspected without invoking it or evaluating its values. */
function inspectableConfig(source: string, file: string): string {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set<string>();
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'vite') continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) if ((item.propertyName ?? item.name).text === 'defineConfig') names.add(item.name.text);
  }
  const exported = ast.statements.find(ts.isExportAssignment)?.expression;
  if (!exported || !ts.isCallExpression(exported) || !ts.isIdentifier(exported.expression) || !names.has(exported.expression.text)) return source;
  const callback = exported.arguments[0];
  if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) return source;
  let body: ts.Node = callback.body;
  if (ts.isBlock(body)) {
    if (body.statements.length !== 1 || !ts.isReturnStatement(body.statements[0]) || !body.statements[0].expression) return source;
    body = body.statements[0].expression;
  }
  while (ts.isParenthesizedExpression(body)) body = body.expression;
  if (!ts.isObjectLiteralExpression(body)) return source;
  return source.slice(0, callback.getStart(ast)) + body.getText(ast) + source.slice(callback.end);
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
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  let microfrontends = Boolean(declared['@kanso/microfrontends']);
  try {
    await readFile(join(root, 'kanso.microfrontends.json'), 'utf8');
    microfrontends = true;
    await readMicrofrontendsConfig(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') problem(
      typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'MF_CONFIG_INVALID',
      error instanceof Error ? error.message : String(error),
      'Use a static kanso.microfrontends.json with unique names, HTTP(S) manifest URLs and contract ranges.',
      'kanso.microfrontends.json',
    );
  }
  if (microfrontends && !declared['@kanso/microfrontends']) problem('MF_PACKAGE_REQUIRED', 'The project configures remotes without declaring @kanso/microfrontends.', 'Add @kanso/microfrontends at the same version as the other Kanso packages.');
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
    ...(microfrontends ? ['@kanso/microfrontends'] : []),
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
      'Use Vite 8 with Kanso 0.6.',
    );
  const solid = new Set<string>();
  const shared = new Map<string, Set<string>>();
  const visited = new Set<string>();
  const inspect = async (item: {
    file: string;
    manifest: Manifest;
  }): Promise<void> => {
    if (visited.has(item.file)) return;
    visited.add(item.file);
    if (item.manifest.name === 'solid-js') solid.add(item.file);
    if (microfrontends && Object.hasOwn(RUNTIME_VERSIONS, item.manifest.name)) {
      const locations = shared.get(item.manifest.name) ?? new Set<string>();
      locations.add(item.file); shared.set(item.manifest.name, locations);
      const expected = RUNTIME_VERSIONS[item.manifest.name as keyof typeof RUNTIME_VERSIONS];
      if (item.manifest.version !== expected) problem('MF_RUNTIME_VERSION', `${item.manifest.name}@${item.manifest.version} must match shared runtime ${expected}.`, 'Install the same exact runtime versions in the shell and each remote.');
    }
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
  for (const [name, files] of shared) if (files.size > 1 && name !== 'solid-js') problem('MF_RUNTIME_DUPLICATE', `${files.size} physical copies of ${name} are installed.`, 'Deduplicate shared runtime packages before building microfrontends.');
  try {
    const configFile = join(root, 'tsconfig.json');
    const config = ts.readConfigFile(configFile, ts.sys.readFile);
    if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    let compilerOptions = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configFile).options;
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
    const viteFiles = (await readdir(root)).filter(file => /^vite\.config\.[cm]?[jt]s$/.test(file));
    if (viteFiles.length > 1) throw new Error('Keep one unambiguous Vite configuration for the doctor audit.');
    if (viteFiles[0]) {
      const viteFile = join(root, viteFiles[0]);
      enabled = hasKansoPlugin(
        inspectableConfig(await readFile(viteFile, 'utf8'), viteFile),
        viteFile,
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
