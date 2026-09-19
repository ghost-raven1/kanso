import generateModule from '@babel/generator';
import * as t from '@babel/types';
import { property, staticViteConfig } from './resolver.js';
const generate =
  (generateModule as unknown as { default: typeof generateModule }).default ??
  generateModule;

/** Verify the plugin is reachable from plugins, rather than merely called somewhere. */
export function hasKansoPlugin(source: string, file: string, exportName = 'default'): boolean {
  const { ast, config } = staticViteConfig(source, file, exportName);
  const imports = new Set<string>();
  const constants = new Map<string, t.Expression>();
  for (const statement of ast.program.body) {
    if (
      t.isImportDeclaration(statement) &&
      statement.source.value === '@kanso/vite'
    ) {
      for (const specifier of statement.specifiers) {
        if (
          t.isImportDefaultSpecifier(specifier) ||
          (t.isImportSpecifier(specifier) &&
            t.isIdentifier(specifier.imported, { name: 'kanso' }))
        )
          imports.add(specifier.local.name);
      }
    }
    if (t.isVariableDeclaration(statement, { kind: 'const' })) {
      for (const declaration of statement.declarations) {
        if (
          t.isIdentifier(declaration.id) &&
          t.isExpression(declaration.init)
        ) {
          constants.set(declaration.id.name, declaration.init);
        }
      }
    }
  }
  const contains = (
    node: t.Node | null | undefined,
    seen = new Set<string>(),
  ): boolean => {
    if (t.isIdentifier(node) && !seen.has(node.name)) {
      return contains(constants.get(node.name), new Set(seen).add(node.name));
    }
    if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node))
      return contains(node.expression, seen);
    if (t.isArrayExpression(node))
      return node.elements.some(item => contains(item, seen));
    if (t.isSpreadElement(node)) return contains(node.argument, seen);
    return (
      t.isCallExpression(node) &&
      t.isIdentifier(node.callee) &&
      imports.has(node.callee.name)
    );
  };
  return contains(property(config, 'plugins')?.value);
}

/** Enable Vite's built-in paths support without evaluating configuration. */
export function enableTsconfigPaths(source: string, file: string, exportName = 'default'): string {
  const { ast, config } = staticViteConfig(source, file, exportName);
  let entry = property(config, 'resolve');
  if (!entry) {
    entry = t.objectProperty(t.identifier('resolve'), t.objectExpression([]));
    config.properties.push(entry);
  }
  if (!t.isObjectExpression(entry.value))
    throw new Error('VITE_CONFIG_DYNAMIC: resolve must be a static object.');
  const current = property(entry.value, 'tsconfigPaths');
  if (current && t.isBooleanLiteral(current.value, { value: true }))
    return source;
  if (current) current.value = t.booleanLiteral(true);
  else
    entry.value.properties.push(
      t.objectProperty(t.identifier('tsconfigPaths'), t.booleanLiteral(true)),
    );
  return generate(ast).code + '\n';
}
