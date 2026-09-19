import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { helper, replaceReads, type TransformContext } from './context.js';

/** Lower a destructuring tree to independently tracked reads, preserving binding identity. */
export function bindPattern(
  context: TransformContext,
  owner: NodePath,
  pattern: t.Node,
  input: t.Expression,
  once = false,
): t.VariableDeclarator[] {
  const declarations: t.VariableDeclarator[] = [];
  const visit = (node: t.Node, expression: t.Expression) => {
    if (t.isAssignmentPattern(node)) {
      const read = owner.scope.generateUidIdentifier('default');
      declarations.push(
        t.variableDeclarator(
          read,
          t.callExpression(helper(context, '__default'), [
            t.arrowFunctionExpression([], expression),
            t.arrowFunctionExpression([], node.right),
            t.booleanLiteral(once),
          ]),
        ),
      );
      context.reactive.add(read);
      visit(node.left, t.callExpression(t.cloneNode(read), []));
    } else if (t.isIdentifier(node)) {
      const read = owner.scope.generateUidIdentifier(node.name);
      replaceReads(owner.scope.getBinding(node.name), () =>
        t.callExpression(t.cloneNode(read), []),
      );
      declarations.push(
        t.variableDeclarator(
          read,
          t.callExpression(helper(context, '__derived'), [
            t.arrowFunctionExpression([], expression),
          ]),
        ),
      );
      context.reactive.add(read);
    } else if (t.isObjectPattern(node)) {
      const keys: t.StringLiteral[] = [];
      for (const property of node.properties) {
        if (t.isRestElement(property)) {
          visit(
            property.argument,
            t.callExpression(helper(context, '__objectRest'), [
              t.cloneNode(expression, true),
              t.arrayExpression(keys),
            ]),
          );
        } else {
          if (
            property.computed ||
            !(t.isIdentifier(property.key) || t.isStringLiteral(property.key))
          )
            throw owner.buildCodeFrameError(
              'KANSO_PATTERN_KEY: use static property names.',
            );
          const key = t.isIdentifier(property.key)
            ? property.key.name
            : property.key.value;
          keys.push(t.stringLiteral(key));
          visit(
            property.value,
            t.memberExpression(
              t.cloneNode(expression, true),
              t.stringLiteral(key),
              true,
            ),
          );
        }
      }
    } else if (t.isArrayPattern(node)) {
      node.elements.forEach((element, index) => {
        if (!element) return;
        visit(
          t.isRestElement(element) ? element.argument : element,
          t.isRestElement(element)
            ? t.callExpression(
                t.memberExpression(
                  t.cloneNode(expression, true),
                  t.identifier('slice'),
                ),
                [t.numericLiteral(index)],
              )
            : t.memberExpression(
                t.cloneNode(expression, true),
                t.numericLiteral(index),
                true,
              ),
        );
      });
    } else
      throw owner.buildCodeFrameError(
        'KANSO_PATTERN: unsupported binding pattern.',
      );
  };
  visit(pattern, input);
  return declarations;
}
