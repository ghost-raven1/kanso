import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import * as t from '@babel/types';

const traverse =
  (traverseModule as unknown as { default: typeof traverseModule }).default ??
  traverseModule;

/** Static runtime edges only; type declarations never prove a runtime entry safe. */
export function runtimeImports(source: string, file: string): string[] {
  const imports = new Set<string>();
  const ast = parse(source, {
    sourceType: 'unambiguous',
    plugins: ['typescript', 'jsx'],
  });
  const unknown = (node: t.Node) => {
    throw new Error(
      `${file}:${node.loc?.start.line ?? 1}: module loading is not statically inspectable. Use literal imports or an explicit vanilla entry.`,
    );
  };
  traverse(ast, {
    ImportDeclaration({ node }) {
      if (
        node.importKind === 'type' ||
        (node.specifiers.length &&
          node.specifiers.every(
            item => t.isImportSpecifier(item) && item.importKind === 'type',
          ))
      )
        return;
      imports.add(node.source.value);
    },
    ExportNamedDeclaration({ node }) {
      if (
        node.source &&
        node.exportKind !== 'type' &&
        !(
          node.specifiers.length &&
          node.specifiers.every(
            item => t.isExportSpecifier(item) && item.exportKind === 'type',
          )
        )
      )
        imports.add(node.source.value);
    },
    ExportAllDeclaration({ node }) {
      if (node.exportKind !== 'type') imports.add(node.source.value);
    },
    TSImportEqualsDeclaration({ node }) {
      if (
        node.importKind !== 'type' &&
        t.isTSExternalModuleReference(node.moduleReference) &&
        t.isStringLiteral(node.moduleReference.expression)
      )
        imports.add(node.moduleReference.expression.value);
    },
    CallExpression(path) {
      const { callee } = path.node;
      if (t.isMemberExpression(callee) && t.isMetaProperty(callee.object))
        unknown(path.node);
      if (
        t.isImport(callee) ||
        (t.isIdentifier(callee, { name: 'require' }) &&
          !path.scope.getBinding('require'))
      ) {
        const value = path.node.arguments[0];
        if (!t.isStringLiteral(value)) unknown(path.node);
        else imports.add(value.value);
      }
    },
    ReferencedIdentifier(path) {
      if (path.scope.getBinding(path.node.name)) return;
      if (
        path.node.name === 'require' &&
        !(
          path.parentPath.isCallExpression() &&
          path.parentPath.node.callee === path.node
        )
      )
        unknown(path.node);
      if (['eval', 'Function'].includes(path.node.name)) unknown(path.node);
      if (
        path.node.name === 'module' &&
        path.parentPath.isMemberExpression() &&
        (path.parentPath.node.computed ||
          t.isIdentifier(path.parentPath.node.property, { name: 'require' }))
      )
        unknown(path.node);
    },
  });
  if (
    [...imports].some(name =>
      ['module', 'node:module', 'vm', 'node:vm'].includes(name),
    )
  )
    throw new Error(
      `${file}: custom module loaders cannot establish a static dependency graph.`,
    );
  return [...imports];
}
