import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import * as t from '@babel/types';
import { readConfigExport, staticViteConfig } from './static-config.js';

const nameOf = (node: t.Identifier | t.StringLiteral) =>
  t.isIdentifier(node) ? node.name : node.value;

export interface ConfigGraph {
  file: string;
  exportName: string;
  files: string[];
  ast: t.File;
  config: t.ObjectExpression;
  source: string;
}

/** Resolve only filesystem config exports; no imports or application code are executed. */
export async function readConfigGraph(
  entry: string,
  visited: string[] = [],
  inspect = (source: string, _file: string) => source,
): Promise<ConfigGraph> {
  const seen = new Set<string>();
  const localFile = async (
    from: string,
    specifier: string,
  ): Promise<string> => {
    if (!specifier.startsWith('.'))
      throw new Error(
        `VITE_CONFIG_DYNAMIC: ${from} imports its configuration from package ${specifier}; select a local config with --config.`,
      );
    const base = resolve(dirname(from), specifier);
    for (const suffix of [
      '',
      '.ts',
      '.mts',
      '.js',
      '.mjs',
      '/index.ts',
      '/index.js',
    ]) {
      try {
        if ((await stat(base + suffix)).isFile())
          return realpath(base + suffix);
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
          (error as NodeJS.ErrnoException).code !== 'ENOTDIR'
        )
          throw error;
      }
    }
    throw new Error(
      `VITE_CONFIG_MISSING: cannot resolve ${specifier} from ${from}.`,
    );
  };
  const visit = async (
    file: string,
    exportName: string,
  ): Promise<ConfigGraph> => {
    file = await realpath(file);
    const identity = `${file}:${exportName}`;
    if (seen.has(identity))
      throw new Error(
        `VITE_CONFIG_CYCLE: config export cycle at ${file} (${exportName}).`,
      );
    seen.add(identity);
    if (!visited.includes(file)) visited.push(file);
    const source = inspect(await readFile(file, 'utf8'), file);
    const { ast, value } = readConfigExport(source, file, exportName);
    for (const statement of ast.program.body) {
      if (t.isExportNamedDeclaration(statement) && statement.source) {
        for (const specifier of statement.specifiers) {
          if (
            t.isExportSpecifier(specifier) &&
            nameOf(specifier.exported) === exportName
          )
            return visit(
              await localFile(file, statement.source.value),
              nameOf(specifier.local),
            );
        }
      }
      if (t.isIdentifier(value) && t.isImportDeclaration(statement)) {
        for (const specifier of statement.specifiers) {
          if (
            specifier.local.name !== value.name ||
            t.isImportNamespaceSpecifier(specifier)
          )
            continue;
          return visit(
            await localFile(file, statement.source.value),
            t.isImportDefaultSpecifier(specifier)
              ? 'default'
              : nameOf(specifier.imported),
          );
        }
      }
    }
    const { config } = staticViteConfig(source, file, exportName);
    return { file, exportName, files: visited, ast, config, source };
  };
  return visit(entry, 'default');
}
