import type { Binding, NodePath } from '@babel/traverse';
import * as t from '@babel/types';

export interface TransformContext {
  program: NodePath<t.Program>;
  imports: Map<string, string>;
  helpers: Map<string, t.Identifier>;
  reactive: Set<string>;
  props: Set<string>;
}

export function helper(context: TransformContext, name: string): t.Identifier {
  let id = context.helpers.get(name);
  if (!id) { id = context.program.scope.generateUidIdentifier(name); context.helpers.set(name, id); }
  return t.cloneNode(id);
}

/** Replace only references belonging to this binding, leaving shadowed names alone. */
export function replaceReads(binding: Binding | undefined, expression: () => t.Expression): void {
  if (!binding) return;
  if (binding.constantViolations.length) throw binding.path.buildCodeFrameError('KANSO_STATE_WRITE: use its setter instead of assignment.');
  for (const reference of [...binding.referencePaths]) {
    if (reference.findParent(path => path.isTSType())) continue;
    if (reference.isJSXIdentifier()) throw reference.buildCodeFrameError('KANSO_DYNAMIC_TAG: use an explicit dynamic component.');
    if (reference.parentPath?.isExportSpecifier()) throw reference.buildCodeFrameError('KANSO_REACTIVE_EXPORT: export a component or store instead of a live local value.');
    if (reference.parentPath?.isObjectProperty()) reference.parentPath.node.shorthand = false;
    reference.replaceWith(expression());
  }
}

export function hasReactive(node: t.Node, context: TransformContext): boolean {
  let found = false;
  t.traverseFast(node, child => {
    if (t.isCallExpression(child) && t.isIdentifier(child.callee) && context.reactive.has(child.callee.name)) found = true;
    if (t.isMemberExpression(child) && t.isIdentifier(child.object) && context.props.has(child.object.name)) found = true;
  });
  return found;
}

/** Only computation scopes are lifted. Handler locals retain ordinary snapshot semantics. */
export function isSetup(path: NodePath): boolean {
  const fn = path.getFunctionParent();
  if (!fn) return false;
  const name = (fn.isFunctionDeclaration() || fn.isFunctionExpression()) ? fn.node.id?.name
    : fn.parentPath.isVariableDeclarator() && t.isIdentifier(fn.parentPath.node.id) ? fn.parentPath.node.id.name : '';
  return !!name && (/^[A-Z]/.test(name) || /^use[A-Z]/.test(name));
}

export function isPureExpression(node: t.Node, context: TransformContext): boolean {
  let pure = true;
  const methods = new Set(['map', 'filter', 'slice', 'concat', 'includes', 'indexOf', 'find', 'findIndex', 'some', 'every', 'join', 'toUpperCase', 'toLowerCase', 'trim']);
  t.traverseFast(node, child => {
    if (t.isAssignmentExpression(child) || t.isUpdateExpression(child) || t.isAwaitExpression(child) || t.isNewExpression(child)) pure = false;
    if (t.isCallExpression(child)) {
      if (t.isIdentifier(child.callee) && context.reactive.has(child.callee.name) && child.arguments.length === 0) return;
      if (t.isMemberExpression(child.callee) && t.isIdentifier(child.callee.property)
        && !child.callee.computed && (methods.has(child.callee.property.name)
          || t.isIdentifier(child.callee.object, { name: 'Math' }) && child.callee.property.name !== 'random')) return;
      pure = false;
    }
  });
  return pure;
}
