import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { property } from './static-config.js';
export { staticViteConfig, property } from './static-config.js';
import { readConfigGraph } from './config-graph.js';
import { createPackageSourceResolver } from './package-sources.js';
import * as t from '@babel/types';
import ts from 'typescript';

const extensions = [
  '',
  '.mjs',
  '.js',
  '.mts',
  '.ts',
  '.jsx',
  '.tsx',
  '.json',
  '/index.mjs',
  '/index.js',
  '/index.mts',
  '/index.ts',
  '/index.jsx',
  '/index.tsx',
];
const exists = async (path: string) => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};
export interface ProjectResolver {
  resolve(from: string, specifier: string): Promise<string | undefined>;
  configFile?: string;
  configExport?: string;
  configFiles: string[];
  configError?: Error;
  entries?: string[];
  entryRoot?: string;
  paths: boolean;
  compilerOptions: ts.CompilerOptions;
}

/** Resolve source graphs and hook exports with the same paths, aliases and realpath rules. */
export async function createProjectResolver(
  root: string,
  options: { config?: string; inventory?: boolean; inspectConfig?: (source: string, file: string) => string } = {},
): Promise<ProjectResolver> {
  const files = await readdir(root);
  const configs = files.filter(file => /^vite\.config\.[cm]?[jt]s$/.test(file));
  const ambiguous = !options.config && configs.length > 1;
  const ambiguity = ambiguous ? new Error('VITE_CONFIG_AMBIGUOUS: select configurations explicitly with repeated --config options.') : undefined;
  if (ambiguity && !options.inventory) throw ambiguity;
  const aliases: { find: string; replacement: string }[] = [];
  let configFile = options.config ? resolve(root, options.config) : !ambiguous && configs[0] ? resolve(root, configs[0]) : undefined;
  const configFiles: string[] = [];
  let configExport: string | undefined;
  let configError: Error | undefined = ambiguity;
  let entries: string[] | undefined;
  let entryRoot = root;
  if (configFile) try {
    const graph = await readConfigGraph(configFile, configFiles, options.inspectConfig);
    configFile = graph.file;
    configExport = graph.exportName;
    const { ast, config } = graph;
    const resolveValue = property(config, 'resolve')?.value;
    if (resolveValue && !t.isObjectExpression(resolveValue))
      throw new Error('VITE_CONFIG_DYNAMIC: resolve must be a static object.');
    if (
      t.isObjectExpression(resolveValue) &&
      resolveValue.properties.some(
        item => t.isSpreadElement(item) || item.computed,
      )
    )
      throw new Error(
        'VITE_CONFIG_DYNAMIC: resolve cannot contain spreads or computed keys.',
      );
    const alias = t.isObjectExpression(resolveValue)
      ? property(resolveValue, 'alias')?.value
      : undefined;
    const shadowedURL = ast.program.body.some(
      statement => 'URL' in t.getBindingIdentifiers(statement),
    );
    const readString = (node: t.Node | null | undefined): string => {
      if (t.isStringLiteral(node)) return node.value;
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.arguments.length === 1
      ) {
        const imported = ast.program.body.some(
          item =>
            t.isImportDeclaration(item) &&
            ['node:url', 'url'].includes(item.source.value) &&
            item.specifiers.some(
              specifier =>
                t.isImportSpecifier(specifier) &&
                t.isIdentifier(specifier.imported, { name: 'fileURLToPath' }) &&
                specifier.local.name === (node.callee as t.Identifier).name,
            ),
        );
        const value = node.arguments[0];
        if (
          imported &&
          !shadowedURL &&
          t.isNewExpression(value) &&
          value.arguments.length === 2 &&
          t.isIdentifier(value.callee, { name: 'URL' }) &&
          t.isStringLiteral(value.arguments[0]) &&
          t.isMemberExpression(value.arguments[1]) &&
          t.isMetaProperty(value.arguments[1].object) &&
          t.isIdentifier(value.arguments[1].property, { name: 'url' })
        )
          return fileURLToPath(
            new URL(value.arguments[0].value, pathToFileURL(graph.file)),
          );
      }
      throw new Error(
        'PATH_ALIAS_DYNAMIC: aliases need string values or fileURLToPath(new URL("./src", import.meta.url)).',
      );
    };
    const add = (find: string, value: t.Node) => {
      const replacement = readString(value);
      if (!isAbsolute(replacement))
        throw new Error(
          `PATH_ALIAS_RELATIVE: ${find} needs an absolute filesystem replacement, preferably fileURLToPath(new URL(...)).`,
        );
      aliases.push({ find, replacement });
    };
    const rootValue = property(config, 'root')?.value;
    entryRoot = rootValue ? resolve(root, readString(rootValue)) : root;
    const build = property(config, 'build')?.value;
    if (build && !t.isObjectExpression(build)) throw new Error('VITE_CONFIG_DYNAMIC: build must be a static object; select source entries explicitly.');
    if (t.isObjectExpression(build) && build.properties.some(item => t.isSpreadElement(item) || item.computed))
      throw new Error('VITE_CONFIG_DYNAMIC: build cannot contain spreads or computed keys.');
    const rollup = t.isObjectExpression(build) ? property(build, 'rollupOptions')?.value : undefined;
    if (rollup && !t.isObjectExpression(rollup)) throw new Error('VITE_CONFIG_DYNAMIC: rollupOptions must be a static object.');
    if (t.isObjectExpression(rollup) && rollup.properties.some(item => t.isSpreadElement(item) || item.computed))
      throw new Error('VITE_CONFIG_DYNAMIC: rollupOptions cannot contain spreads or computed keys.');
    const input = t.isObjectExpression(rollup) ? property(rollup, 'input')?.value : undefined;
    if (input) {
      const values = t.isArrayExpression(input) ? input.elements : t.isObjectExpression(input)
        ? input.properties.map(item => {
          if (!t.isObjectProperty(item) || item.computed) throw new Error('ENTRY_DYNAMIC: use static build input names and files.');
          return item.value;
        }) : [input];
      entries = values.map(value => resolve(entryRoot, readString(value)));
    } else if (t.isObjectExpression(build) && property(build, 'ssr')?.value && !t.isBooleanLiteral(property(build, 'ssr')!.value)) {
      entries = [resolve(entryRoot, readString(property(build, 'ssr')!.value))];
    } else if (rootValue) entries = [resolve(entryRoot, 'index.html')];
    if (t.isObjectExpression(alias))
      for (const item of alias.properties) {
        if (
          !t.isObjectProperty(item) ||
          item.computed ||
          !(t.isIdentifier(item.key) || t.isStringLiteral(item.key))
        )
          throw new Error('PATH_ALIAS_DYNAMIC: use static alias keys.');
        add(
          t.isIdentifier(item.key) ? item.key.name : item.key.value,
          item.value,
        );
      }
    else if (t.isArrayExpression(alias))
      for (const item of alias.elements) {
        if (!t.isObjectExpression(item) || item.properties.length !== 2)
          throw new Error(
            'PATH_ALIAS_DYNAMIC: custom alias resolvers are unsupported.',
          );
        const find = property(item, 'find');
        const replacement = property(item, 'replacement');
        if (!find || !replacement)
          throw new Error(
            'PATH_ALIAS_DYNAMIC: aliases need find and replacement.',
          );
        add(readString(find.value), replacement.value);
      }
    else if (alias)
      throw new Error(
        'PATH_ALIAS_DYNAMIC: alias must be a static object or array.',
      );
  } catch (error) {
    if (!options.inventory) throw error;
    configError = error instanceof Error ? error : new Error(String(error));
    aliases.length = 0;
  }
  const tsconfig = ts.findConfigFile(root, ts.sys.fileExists);
  const parsed = tsconfig
    ? ts.getParsedCommandLineOfConfigFile(
        tsconfig,
        {},
        {
          ...ts.sys,
          onUnRecoverableConfigFileDiagnostic: error => {
            throw new Error(
              ts.flattenDiagnosticMessageText(error.messageText, '\n'),
            );
          },
        },
      )
    : undefined;
  const errors = parsed?.errors.filter(error => error.code !== 18003) ?? [];
  if (errors.length)
    throw new Error(
      `TSCONFIG: ${ts.flattenDiagnosticMessageText(errors[0].messageText, '\n')}`,
    );
  let compilerOptions = parsed?.options ?? {};
  // Conventional Vite projects put application options in a referenced tsconfig.app.json.
  if (!compilerOptions.paths && parsed?.projectReferences?.length) {
    const candidates = parsed.projectReferences
      .map(reference =>
        ts.getParsedCommandLineOfConfigFile(
          ts.resolveProjectReferencePath(reference),
          {},
          { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
        ),
      )
      .filter(config => config?.options.paths);
    if (candidates.length > 1)
      throw new Error(
        'PATH_ALIAS_AMBIGUOUS: several referenced configs define paths; select one application config.',
      );
    compilerOptions = candidates[0]?.options ?? compilerOptions;
  }
  const localFile = async (base: string): Promise<string | undefined> => {
    for (const suffix of extensions)
      if (await exists(base + suffix)) return realpath(base + suffix);
    if (/\.js$/.test(base))
      for (const suffix of ['.ts', '.tsx'])
        if (await exists(base.slice(0, -3) + suffix))
          return realpath(base.slice(0, -3) + suffix);
    return undefined;
  };
  const packageSource = createPackageSourceResolver(root, localFile);
  return {
    configFile,
    configExport,
    configFiles,
    configError,
    entries,
    entryRoot,
    paths: !!compilerOptions.paths,
    compilerOptions,
    async resolve(from, specifier) {
      if (specifier.startsWith('.'))
        return localFile(resolve(dirname(from), specifier));
      const alias = aliases.find(
        item =>
          specifier === item.find || specifier.startsWith(item.find + '/'),
      );
      if (alias) {
        const file = await localFile(
          alias.replacement + specifier.slice(alias.find.length),
        );
        if (!file)
          throw new Error(
            `UNRESOLVED_IMPORT: cannot resolve alias ${specifier}.`,
          );
        return file;
      }
      const result = ts.resolveModuleName(
        specifier,
        from,
        { ...compilerOptions, allowJs: true },
        ts.sys,
      ).resolvedModule;
      if (
        result &&
        !result.isExternalLibraryImport &&
        !result.resolvedFileName.includes('/node_modules/')
      )
        return realpath(result.resolvedFileName);
      const matchesPath = Object.keys(compilerOptions.paths ?? {}).some(key => {
        const [prefix, suffix] = key.split('*');
        return key.includes('*')
          ? specifier.startsWith(prefix) && specifier.endsWith(suffix)
          : key === specifier;
      });
      if (matchesPath)
        throw new Error(
          `UNRESOLVED_IMPORT: tsconfig path ${specifier} has no source target.`,
        );
      return packageSource(from, specifier);
    },
  };
}
