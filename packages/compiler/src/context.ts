import type { Binding, NodePath, Scope } from '@babel/traverse';
import * as t from '@babel/types';

export interface TransformContext {
  program: NodePath<t.Program>;
  imports: Map<t.Identifier, string>;
  helpers: Map<string, t.Identifier>;
  reactive: Set<t.Identifier>;
  props: Set<t.Identifier>;
  rows: Set<t.Function>;
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

/** Identity survives scope recrawls; equal names in unrelated scopes do not alias. */
export function importedName(context: TransformContext, scope: Scope, name: string): string | undefined {
  const binding = scope.getBinding(name);
  return binding && context.imports.get(binding.identifier);
}
export function tracked(context: TransformContext, scope: Scope, name: string, kind: 'reactive' | 'props'): boolean {
  const binding = scope.getBinding(name);
  return !!binding && context[kind].has(binding.identifier);
}
export function hasReactive(path: NodePath<t.Node | null | undefined>, context: TransformContext): boolean {
  let found = false;
  const inspect = (child: NodePath<t.Node | null | undefined>) => {
    const node = child.node;
    if (t.isCallExpression(node) && t.isIdentifier(node.callee) && tracked(context, child.scope, node.callee.name, 'reactive')) found = true;
    if (t.isMemberExpression(node) && t.isIdentifier(node.object) && tracked(context, child.scope, node.object.name, 'props')) found = true;
  };
  inspect(path); path.traverse({ enter: inspect });
  return found;
}

/** Only computation scopes are lifted. Handler locals retain ordinary snapshot semantics. */
export function isSetup(path: NodePath, context?: TransformContext): boolean {
  const fn = path.getFunctionParent();
  if (!fn) return false;
  if (context?.rows.has(fn.node)) return true;
  const name = (fn.isFunctionDeclaration() || fn.isFunctionExpression()) ? fn.node.id?.name
    : fn.parentPath.isVariableDeclarator() && t.isIdentifier(fn.parentPath.node.id) ? fn.parentPath.node.id.name : '';
  return !!name && (/^[A-Z]/.test(name) || /^use[A-Z]/.test(name));
}

export function isPureExpression(path: NodePath<t.Node | null | undefined>, context: TransformContext): boolean {
  let pure = true;
  const methods = new Set(['map', 'filter', 'slice', 'concat', 'includes', 'indexOf', 'find', 'findIndex', 'some', 'every', 'join', 'toUpperCase', 'toLowerCase', 'trim']);
  const inspect = (child: NodePath<t.Node | null | undefined>) => {
    const node = child.node;
    if (t.isAssignmentExpression(node) || t.isUpdateExpression(node) || t.isAwaitExpression(node) || t.isNewExpression(node)) pure = false;
    if (!t.isCallExpression(node)) return;
    if (t.isIdentifier(node.callee) && ['Boolean', 'String', 'Number'].includes(node.callee.name) && !child.scope.hasBinding(node.callee.name, true)) return;
    if (t.isIdentifier(node.callee) && importedName(context, child.scope, node.callee.name) === 'routeUrl') return;
    if (t.isIdentifier(node.callee) && tracked(context, child.scope, node.callee.name, 'reactive') && node.arguments.length === 0) return;
    if (t.isMemberExpression(node.callee) && t.isIdentifier(node.callee.property) && !node.callee.computed &&
      (methods.has(node.callee.property.name) || t.isIdentifier(node.callee.object, { name: 'Math' }) && !child.scope.hasBinding('Math', true) && node.callee.property.name !== 'random')) return;
    pure = false;
  };
  // Creating a function is pure; callbacks executed by a calculation are still inspected.
  if (path.isFunction()) return true;
  inspect(path);
  path.traverse({ enter: inspect, Function(child) { if (!child.parentPath.isCallExpression()) child.skip(); } });
  return pure;
}
