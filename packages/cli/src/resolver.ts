import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from '@babel/parser';
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
  paths: boolean;
  compilerOptions: ts.CompilerOptions;
}

/** Read only a declarative Vite config. Never execute user configuration during an audit. */
export function staticViteConfig(
  source: string,
  file: string,
): { ast: t.File; config: t.ObjectExpression } {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  const constants = new Map<string, t.Expression>();
  for (const item of ast.program.body)
    if (t.isVariableDeclaration(item, { kind: 'const' }))
      for (const declaration of item.declarations) {
        if (t.isIdentifier(declaration.id) && t.isExpression(declaration.init))
          constants.set(declaration.id.name, declaration.init);
      }
  const seen = new Set<string>();
  const unwrap = (node: t.Node | null | undefined): t.Node | undefined => {
    if (
      t.isIdentifier(node) &&
      constants.has(node.name) &&
      !seen.has(node.name)
    ) {
      seen.add(node.name);
      return unwrap(constants.get(node.name));
    }
    if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node))
      return unwrap(node.expression);
    if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
      const imported = ast.program.body.some(
        item =>
          t.isImportDeclaration(item) &&
          item.source.value === 'vite' &&
          item.specifiers.some(
            specifier =>
              t.isImportSpecifier(specifier) &&
              t.isIdentifier(specifier.imported, { name: 'defineConfig' }) &&
              specifier.local.name === (node.callee as t.Identifier).name,
          ),
      );
      if (imported) return unwrap(node.arguments[0]);
    }
    return node ?? undefined;
  };
  const config = unwrap(
    ast.program.body.find(t.isExportDefaultDeclaration)?.declaration,
  );
  if (
    !t.isObjectExpression(config) ||
    config.properties.some(item => t.isSpreadElement(item) || item.computed)
  )
    throw new Error(
      `VITE_CONFIG_DYNAMIC: ${file} must export a static defineConfig({...}) object for automatic migration.`,
    );
  return { ast, config };
}
export const property = (object: t.ObjectExpression, name: string) =>
  object.properties.find(
    item =>
      t.isObjectProperty(item) &&
      !item.computed &&
      (t.isIdentifier(item.key, { name }) ||
        t.isStringLiteral(item.key, { value: name })),
  ) as t.ObjectProperty | undefined;

/** Resolve source graphs and hook exports with the same paths, aliases and realpath rules. */
export async function createProjectResolver(
  root: string,
): Promise<ProjectResolver> {
  const files = await readdir(root);
  const configs = files.filter(file => /^vite\.config\.[cm]?[jt]s$/.test(file));
  if (configs.length > 1)
    throw new Error(
      'VITE_CONFIG_AMBIGUOUS: keep one Vite configuration for migration.',
    );
  const aliases: { find: string; replacement: string }[] = [];
  const configFile = configs[0] && resolve(root, configs[0]);
  if (configFile) {
    const { ast, config } = staticViteConfig(
      await readFile(configFile, 'utf8'),
      configFile,
    );
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
            new URL(value.arguments[0].value, pathToFileURL(configFile)),
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
  return {
    configFile,
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
      return undefined;
    },
  };
}
