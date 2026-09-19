import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';

/** Follow actual React base bindings; ordinary Error and domain classes are not components. */
export function extendsReactComponent(
  path: NodePath<t.ClassDeclaration | t.ClassExpression>,
): boolean {
  const seen = new Set<t.Node>();
  const visit = (
    node: t.Node | null | undefined,
    scope: NodePath['scope'],
  ): boolean => {
    if (!node || seen.has(node)) return false;
    seen.add(node);
    if (t.isTSAsExpression(node) || t.isTSNonNullExpression(node))
      return visit(node.expression, scope);
    if (t.isMemberExpression(node) && t.isIdentifier(node.object)) {
      const property =
        !node.computed && t.isIdentifier(node.property)
          ? node.property.name
          : t.isStringLiteral(node.property)
            ? node.property.value
            : undefined;
      if (property !== 'Component' && property !== 'PureComponent')
        return false;
      const binding = scope.getBinding(node.object.name)?.path;
      return (
        !!binding &&
        (binding.isImportDefaultSpecifier() ||
          binding.isImportNamespaceSpecifier()) &&
        binding.parentPath.isImportDeclaration() &&
        binding.parentPath.node.source.value === 'react'
      );
    }
    if (!t.isIdentifier(node)) return false;
    const binding = scope.getBinding(node.name)?.path;
    if (!binding) return false;
    if (
      binding.isImportSpecifier() &&
      binding.parentPath.isImportDeclaration()
    ) {
      const imported = binding.node.imported;
      return (
        binding.parentPath.node.source.value === 'react' &&
        ['Component', 'PureComponent'].includes(
          t.isIdentifier(imported) ? imported.name : imported.value,
        )
      );
    }
    if (binding.isVariableDeclarator())
      return visit(binding.node.init, binding.scope);
    if (binding.isClassDeclaration())
      return visit(binding.node.superClass, binding.scope);
    return false;
  };
  return visit(path.node.superClass, path.scope);
}
