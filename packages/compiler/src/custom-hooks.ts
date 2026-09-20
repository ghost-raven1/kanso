import type { Binding, NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { helper, replaceReads, hasReactive, isPureExpression, isSetup, type TransformContext } from './context.js';
import { bindPattern } from './patterns.js';

const hookName = (path: NodePath<t.Function>): string | undefined =>
  (path.isFunctionDeclaration() || path.isFunctionExpression()) && path.node.id ? path.node.id.name
    : path.parentPath.isVariableDeclarator() && t.isIdentifier(path.parentPath.node.id) ? path.parentPath.node.id.name : undefined;
const isHook = (path: NodePath<t.Function>) => /^use[A-Z]/.test(hookName(path) ?? '');

function customBinding(binding: Binding | undefined): boolean {
  if (!binding) return false;
  const path = binding.path;
  if (path.isImportSpecifier() || path.isImportDefaultSpecifier()) {
    const declaration = path.parentPath;
    if (!declaration.isImportDeclaration() || ['@kanso/core', '@kanso/app', 'solid-js', '@solidjs/router'].includes(declaration.node.source.value)) return false;
    const name = path.isImportSpecifier() && t.isIdentifier(path.node.imported) ? path.node.imported.name : binding.identifier.name;
    return /^use[A-Z]/.test(name);
  }
  return path.isFunctionDeclaration() && isHook(path)
    || path.isVariableDeclarator() && /^use[A-Z]/.test(binding.identifier.name) && t.isFunction(path.node.init);
}

/** Bind hook parameters to live reads, retaining ordinary function-valued arguments. */
export function transformHookParameters(context: TransformContext): void {
  context.program.traverse({ Function(path) {
    if (!isHook(path)) return;
    if (path.node.async || path.node.generator) throw path.buildCodeFrameError('KANSO_HOOK_ASYNC: custom hook setup must be synchronous.');
    path.traverse({
      Function(inner) { if (!inner.isArrowFunctionExpression()) inner.skip(); },
      ThisExpression(reference) { throw reference.buildCodeFrameError('KANSO_HOOK_PARAMETER: pass explicit named parameters instead of this.'); },
      ReferencedIdentifier(reference) {
        if (reference.node.name === 'arguments' && !reference.scope.hasOwnBinding('arguments')) throw reference.buildCodeFrameError('KANSO_HOOK_PARAMETER: use named parameters instead of arguments.');
      },
    });
    if (!t.isBlockStatement(path.node.body)) path.node.body = t.blockStatement([t.returnStatement(path.node.body)]);
    const declarations: t.Statement[] = [];
    for (const [index, parameter] of path.node.params.entries()) {
      if (t.isRestElement(parameter) || t.isTSParameterProperty(parameter)) throw path.buildCodeFrameError('KANSO_HOOK_PARAMETER: variadic hook parameters are unsupported.');
      const pattern = t.isAssignmentPattern(parameter) ? parameter.left : parameter;
      const raw = path.scope.generateUidIdentifier('argument');
      if (t.isIdentifier(pattern) || t.isArrayPattern(pattern) || t.isObjectPattern(pattern)) raw.typeAnnotation = pattern.typeAnnotation;
      const read = path.scope.generateUidIdentifier('argumentRead');
      const args: t.Expression[] = [t.cloneNode(raw)];
      if (t.isAssignmentPattern(parameter)) args.push(t.arrowFunctionExpression([], parameter.right));
      const bindings = bindPattern(context, path, pattern, t.callExpression(t.cloneNode(read), []), true);
      path.node.params[index] = raw;
      declarations.push(t.variableDeclaration('const', [t.variableDeclarator(read, t.callExpression(helper(context, '__hookArgument'), args)), ...bindings]));
      context.reactive.add(read);
    }
    path.node.body.body.unshift(...declarations);
  } });
}

/** A call crosses the module boundary once; each returned binding is independently memoized. */
export function transformCustomCalls(context: TransformContext): void {
  context.program.traverse({ ReferencedIdentifier(path) {
    if (!customBinding(path.scope.getBinding(path.node.name)) || path.findParent(parent => parent.isTSType())) return;
    const parent = path.parentPath;
    if (parent.isCallExpression() && parent.node.callee === path.node || parent.isExportSpecifier() || parent.isExportDefaultDeclaration()) return;
    throw path.buildCodeFrameError('KANSO_HOOK_REFERENCE: call hooks directly; use named import aliases instead of assigning or passing hook functions.');
  } });
  context.program.traverse({ CallExpression(path) {
    const callee = path.node.callee;
    if (t.isMemberExpression(callee) && t.isIdentifier(callee.property) && /^use[A-Z]/.test(callee.property.name) && t.isIdentifier(callee.object)) {
      const binding = path.scope.getBinding(callee.object.name);
      if (binding?.path.isImportNamespaceSpecifier() || binding?.path.isImportDefaultSpecifier()) throw path.buildCodeFrameError('KANSO_HOOK_NAMESPACE: use a named hook import.');
    }
    if (!t.isIdentifier(path.node.callee) || !customBinding(path.scope.getBinding(path.node.callee.name))) return;
    if (!isSetup(path, context)) throw path.buildCodeFrameError('KANSO_HOOK_SCOPE: call custom hooks during component or hook setup.');
    const owner = path.getFunctionParent();
    for (let parent = path.parentPath; parent && parent !== owner; parent = parent.parentPath!) {
      if (parent.isIfStatement() || parent.isConditionalExpression() || parent.isLogicalExpression() || parent.isSwitchStatement() || parent.isLoop()) throw path.buildCodeFrameError('KANSO_HOOK_ORDER: custom hooks cannot be conditional.');
    }
    const args = path.node.arguments.map(argument => {
      if (!t.isExpression(argument)) throw path.buildCodeFrameError('KANSO_HOOK_ARGUMENT: spread arguments require an explicit hook signature.');
      return t.callExpression(helper(context, '__pendingHookArgument'), [argument]);
    });
    const call = t.callExpression(helper(context, '__callHook'), [path.node.callee, t.arrayExpression(args)]);
    const declaration = path.parentPath;
    if (declaration.isExpressionStatement()) { path.replaceWith(call); path.skip(); return; }
    if (!declaration.isVariableDeclarator() || !declaration.parentPath.isVariableDeclaration({ kind: 'const' })) throw path.buildCodeFrameError('KANSO_HOOK_BINDING: assign the hook result to const before using it.');
    const result = path.scope.generateUidIdentifier('hookResult');
    if (t.isIdentifier(declaration.node.id)) {
      replaceReads(path.scope.getBinding(declaration.node.id.name), () => t.callExpression(t.cloneNode(result), []));
      declaration.node.id = result;
      declaration.node.init = call;
    } else {
      const bindings = bindPattern(context, declaration, declaration.node.id, t.callExpression(t.cloneNode(result), []));
      declaration.replaceWithMultiple([t.variableDeclarator(result, call), ...bindings]);
    }
    context.reactive.add(result);
    declaration.scope.crawl();
    path.skip();
  } });
}

/** Resolve argument liveness after derived bindings and nested hook results are lowered. */
export function transformHookArguments(context: TransformContext): void {
  const pending = context.helpers.get('__pendingHookArgument');
  if (!pending) return;
  context.program.traverse({ CallExpression: { exit(path) {
    if (!t.isIdentifier(path.node.callee, { name: pending.name })) return;
    const argument = path.node.arguments[0];
    if (!t.isExpression(argument)) return;
    if (t.isFunction(argument) || !hasReactive(path.get('arguments')[0], context)) { path.replaceWith(argument); return; }
    if (!isPureExpression(path.get('arguments')[0], context)) throw path.buildCodeFrameError('KANSO_PURITY: a live hook argument must be a pure expression.');
    path.replaceWith(t.callExpression(helper(context, '__liveArgument'), [t.arrowFunctionExpression([], argument)]));
  } } });
  context.helpers.delete('__pendingHookArgument');
}

/** Result expressions are reactive; setup and effect creation execute only once. */
export function transformHookReturns(context: TransformContext): void {
  context.program.traverse({ Function(path) {
    if (!isHook(path) || !t.isBlockStatement(path.node.body)) return;
    const body = path.node.body;
    const returns: NodePath<t.ReturnStatement>[] = [];
    path.traverse({ Function(inner) { inner.skip(); }, ReturnStatement(statement) { returns.push(statement); } });
    if (returns.length > 1 || returns.some(statement => statement.parentPath !== path.get('body') || statement.node !== body.body.at(-1))) {
      throw path.buildCodeFrameError('KANSO_HOOK_RETURN: use one terminal return; express result conditions with a ternary.');
    }
    if (!returns.length) { path.node.body.body.push(t.returnStatement(t.callExpression(helper(context, '__hookResult'), [t.arrowFunctionExpression([], t.identifier('undefined'))]))); return; }
    const statement = returns[0];
    const value = statement.node.argument ?? t.identifier('undefined');
    if (!isPureExpression(statement.get('argument'), context)) throw statement.buildCodeFrameError('KANSO_HOOK_RESULT_PURITY: move work into setup, useMemo or useEffect; return a pure value.');
    statement.node.argument = t.callExpression(helper(context, '__hookResult'), [t.arrowFunctionExpression([], value)]);
  } });
}
