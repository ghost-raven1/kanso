import * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';

const returned = (statement: t.Statement | null | undefined): t.Expression | undefined => {
  if (t.isReturnStatement(statement) && t.isExpression(statement.argument)) return statement.argument;
  if (t.isBlockStatement(statement) && statement.body.length === 1) return returned(statement.body[0]);
  return undefined;
};

/** Lower terminal early-return branches into reactive JSX expressions. */
export function transformControlFlow(program: NodePath<t.Program>): void {
  program.traverse({ Function(path) {
    if (!t.isBlockStatement(path.node.body)) return;
    const name = t.isFunctionDeclaration(path.node) || t.isFunctionExpression(path.node) ? path.node.id?.name
      : path.parentPath.isVariableDeclarator() && t.isIdentifier(path.parentPath.node.id) ? path.parentPath.node.id.name : '';
    if (!name || !/^[A-Z]/.test(name)) return;
    const body = path.node.body.body;
    for (let index = body.length - 1; index >= 0; index--) {
      const statement = body[index];
      if (!t.isIfStatement(statement)) continue;
      const yes = returned(statement.consequent);
      if (!yes) continue;
      const no = returned(statement.alternate) ?? returned(body[index + 1]);
      if (!no || index + (statement.alternate ? 1 : 2) !== body.length) {
        throw path.buildCodeFrameError('KANSO_CONTROL_FLOW: keep setup before terminal return branches; move branch-specific setup into a child component.');
      }
      body.splice(index, statement.alternate ? 1 : 2, t.returnStatement(t.conditionalExpression(statement.test, yes, no)));
    }
    for (const statement of body) {
      if (t.isReturnStatement(statement) && (t.isConditionalExpression(statement.argument) || t.isLogicalExpression(statement.argument))) {
        statement.argument = t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), [t.jsxExpressionContainer(statement.argument)]);
      }
    }
  } });
}
