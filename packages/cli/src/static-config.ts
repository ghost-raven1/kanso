import { parse } from '@babel/parser';
import * as t from '@babel/types';

/** Read only a declarative Vite config. Never execute user configuration during an audit. */
export function readConfigExport(
  source: string,
  file: string,
  exportName = 'default',
): { ast: t.File; value: t.Node | undefined } {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  const constants = new Map<string, t.Expression>();
  for (const statement of ast.program.body) {
    const item = t.isExportNamedDeclaration(statement)
      ? statement.declaration
      : statement;
    if (t.isVariableDeclaration(item, { kind: 'const' }))
      for (const declaration of item.declarations) {
        if (t.isIdentifier(declaration.id) && t.isExpression(declaration.init))
          constants.set(declaration.id.name, declaration.init);
      }
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
  let exported: t.Node | undefined;
  for (const statement of ast.program.body) {
    if (exportName === 'default' && t.isExportDefaultDeclaration(statement))
      exported = statement.declaration;
    if (!t.isExportNamedDeclaration(statement) || statement.source) continue;
    if (
      t.isVariableDeclaration(statement.declaration) &&
      statement.declaration.declarations.some(item =>
        t.isIdentifier(item.id, { name: exportName }),
      )
    )
      exported = t.identifier(exportName);
    for (const specifier of statement.specifiers)
      if (
        t.isExportSpecifier(specifier) &&
        (t.isIdentifier(specifier.exported)
          ? specifier.exported.name
          : specifier.exported.value) === exportName
      )
        exported = specifier.local;
  }
  return { ast, value: unwrap(exported) };
}

/** Validate a selected config export without evaluating JavaScript. */
export function staticViteConfig(
  source: string,
  file: string,
  exportName = 'default',
): { ast: t.File; config: t.ObjectExpression } {
  const { ast, value: config } = readConfigExport(source, file, exportName);
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
