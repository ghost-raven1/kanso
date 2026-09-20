import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';

/** Bind a hook once without moving it across earlier expressions or conditional work. */
export function bindHookResult(
  path: NodePath<t.CallExpression>,
): NodePath<t.VariableDeclarator> {
  if (
    path.parentPath.isVariableDeclarator() &&
    path.parentPath.node.init === path.node
  )
    return path.parentPath;
  let value: NodePath = path;
  while (value.parentPath) {
    const parent = value.parentPath;
    if (
      ((parent.isMemberExpression() || parent.isOptionalMemberExpression()) &&
        parent.node.object === value.node) ||
      ((parent.isTSAsExpression() ||
        parent.isTSTypeAssertion() ||
        parent.isTSNonNullExpression() ||
        parent.isTSSatisfiesExpression() ||
        parent.isParenthesizedExpression()) &&
        parent.node.expression === value.node)
    )
      value = parent;
    else break;
  }
  const anchor = value.parentPath;
  const owner = path.getFunctionParent();
  const initializer =
    anchor?.isVariableDeclarator() &&
    anchor.node.init === value.node &&
    anchor.parentPath.isVariableDeclaration({ kind: 'const' });
  const terminal =
    anchor?.isReturnStatement() &&
    anchor.node.argument === value.node &&
    owner &&
    t.isBlockStatement(owner.node.body) &&
    anchor.parentPath.node === owner.node.body &&
    owner.node.body.body.at(-1) === anchor.node;
  if (!initializer && !terminal)
    throw path.buildCodeFrameError(
      'KANSO_HOOK_BINDING: use a const initializer or a direct terminal hook return; bind hooks before combining them with other expressions.',
    );
  const call = path.node;
  const id = path.scope.generateUidIdentifier('hookValue');
  path.replaceWith(t.cloneNode(id));
  const declaration = t.variableDeclarator(id, call);
  const inserted = initializer
    ? anchor!.insertBefore(declaration)[0]
    : anchor!
        .insertBefore(t.variableDeclaration('const', [declaration]))[0]
        .get('declarations.0');
  owner!.scope.crawl();
  return inserted as NodePath<t.VariableDeclarator>;
}
