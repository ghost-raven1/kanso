import { bindPattern } from './patterns.js';
import { bindHookResult } from './hook-binding.js';
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { helper, replaceReads, hasReactive, importedName, isSetup, isPureExpression, type TransformContext } from './context.js';

const names: Record<string, string> = { useState: '__state', useReducer: '__reducer', useTransition: '__transition', useEffect: '__effect', useLayoutEffect: '__layoutEffect', useImperativeHandle: '__imperativeHandle', useMemo: '__memo', useCallback: '__callback', useContext: '__context', useStore: '__store' };

export function transformHooks(context: TransformContext): void {
  context.program.traverse({
    CallExpression(path) {
      if (!t.isIdentifier(path.node.callee)) return;
      const local = path.node.callee.name;
      const name = importedName(context, path.scope, local);
      if (!name || !names[name] && !['useRef', 'useId', 'useService'].includes(name)) return;
      const binding = path.scope.getBinding(local);
      if (!binding?.path.isImportSpecifier()) return;
      if (!isSetup(path, context)) throw path.buildCodeFrameError('KANSO_HOOK_SCOPE: hooks belong in a component or a compiled useX function.');
      const owner = path.getFunctionParent();
      for (let parent = path.parentPath; parent && parent !== owner; parent = parent.parentPath!) {
        if (parent.isIfStatement() || parent.isConditionalExpression() || parent.isLogicalExpression() || parent.isSwitchStatement() || parent.isLoop()) throw path.buildCodeFrameError('KANSO_HOOK_ORDER: move conditional hooks into a child component.');
      }
      if (['useRef', 'useId', 'useService'].includes(name)) {
        if (path.findParent(parent => parent.isReturnStatement() && parent.getFunctionParent() === owner)) bindHookResult(path);
        return;
      }
      const declaration = ['useEffect', 'useLayoutEffect', 'useImperativeHandle'].includes(name) && path.parentPath.isExpressionStatement() ? undefined : bindHookResult(path);
      if (declaration) path = declaration.get('init') as NodePath<t.CallExpression>;
      path.node.callee = helper(context, names[name]);
      const args = path.node.arguments;
      if (name === 'useStore') {
        if (!args[0]) throw path.buildCodeFrameError('KANSO_STORE_ARGUMENT: provide a store.');
        for (let index = 0; index < args.length; index++) {
          const argument = args[index];
          if (!t.isExpression(argument)) throw path.buildCodeFrameError('KANSO_STORE_ARGUMENT: pass explicit store, selector and equality arguments.');
          args[index] = t.arrowFunctionExpression([], argument);
        }
      }
      if (name === 'useState' && args.length === 0) args.push(t.identifier('undefined'));
      if (name === 'useImperativeHandle') {
        if (!t.isExpression(args[0]) || !t.isExpression(args[1])) throw path.buildCodeFrameError('KANSO_REF: provide a ref and a handle factory.');
        args[0] = t.arrowFunctionExpression([], args[0]);
        if (args[2]) {
          if (!t.isArrayExpression(args[2])) throw path.buildCodeFrameError('KANSO_DEPENDENCIES: use an inline dependency array.');
          args[2] = t.arrowFunctionExpression([], args[2]);
        }
        return;
      }
      if (['useEffect', 'useLayoutEffect', 'useMemo', 'useCallback'].includes(name) && args[1]) {
        if (!t.isArrayExpression(args[1])) throw path.buildCodeFrameError('KANSO_DEPENDENCIES: use an inline dependency array.');
        args[1] = t.arrowFunctionExpression([], args[1]);
      }
      if (name === 'useCallback' && t.isExpression(args[0])) args[0] = t.arrowFunctionExpression([], args[0]);
      if (['useEffect', 'useLayoutEffect'].includes(name)) return;
      if (!declaration) return;
      if (!declaration.parentPath.isVariableDeclaration({ kind: 'const' })) throw path.buildCodeFrameError('KANSO_HOOK_BINDING: assign hooks to const.');
      if (['useState', 'useReducer', 'useTransition'].includes(name) && (!t.isArrayPattern(declaration.node.id) || !t.isIdentifier(declaration.node.id.elements[0]))) {
        const read = declaration.scope.generateUidIdentifier('state');
        const write = declaration.scope.generateUidIdentifier('setter');
        const pattern = declaration.node.id;
        declaration.node.id = t.arrayPattern([read, write]);
        declaration.insertAfter(t.variableDeclarator(pattern, t.arrayExpression([t.callExpression(t.cloneNode(read), []), t.cloneNode(write)])));
        context.reactive.add(read);
        declaration.scope.crawl();
        return;
      }
      if (['useContext', 'useStore', 'useMemo', 'useCallback'].includes(name) && !t.isIdentifier(declaration.node.id)) {
        const id = declaration.scope.generateUidIdentifier('context');
        const pattern = declaration.node.id;
        declaration.node.id = id;
        declaration.insertAfter(t.variableDeclarator(pattern, t.callExpression(t.cloneNode(id), [])));
        context.reactive.add(id);
        declaration.scope.crawl();
        return;
      }
      const id = declaration.node.id;
      const value = ['useState', 'useReducer', 'useTransition'].includes(name) ? t.isArrayPattern(id) ? id.elements[0] : null : id;
      if (!t.isIdentifier(value)) throw path.buildCodeFrameError('KANSO_HOOK_BINDING: use a named value binding.');
      const oldName = value.name;
      const newId = path.scope.generateUidIdentifier(oldName);
      const valueBinding = path.scope.getBinding(oldName);
      replaceReads(valueBinding, () => t.callExpression(t.cloneNode(newId), []));
      value.name = newId.name;
      context.reactive.add(value);
    },
  });
}

export function transformDerived(context: TransformContext): void {
  context.program.traverse({
    VariableDeclarator(path) {
      const { id, init } = path.node;
      if (!isSetup(path, context) || !init || !t.isExpression(init)) return;
      if (t.isFunction(init) || t.isCallExpression(init) && t.isIdentifier(init.callee)
        && ([...context.helpers.values()].some(value => value.name === (init.callee as t.Identifier).name)
          || ['useRef', 'useId', 'useService'].includes(importedName(context, path.scope, init.callee.name) ?? ''))) return;
      if ((t.isObjectPattern(id) || t.isArrayPattern(id)) && hasReactive(path.get('init'), context)) {
        if (!path.parentPath.isVariableDeclaration({ kind: 'const' })) throw path.buildCodeFrameError('KANSO_PROPS: destructure live values with const.');
        path.replaceWithMultiple(bindPattern(context, path, id, init));
        path.scope.crawl();
        return;
      }
      if (!t.isIdentifier(id)) return;
      if (!hasReactive(path.get('init'), context)) return;
      if (path.parentPath.isVariableDeclaration() && path.parentPath.node.kind !== 'const') throw path.buildCodeFrameError('KANSO_DERIVED_CONST: derived values must use const.');
      if (!isPureExpression(path.get('init'), context)) throw path.buildCodeFrameError('KANSO_PURITY: cannot prove this derived expression pure; use useMemo for a pure calculation or useEffect for side effects.');
      const newId = path.scope.generateUidIdentifier(id.name);
      replaceReads(path.scope.getBinding(id.name), () => t.callExpression(t.cloneNode(newId), []));
      path.node.id = newId;
      path.node.init = t.callExpression(helper(context, '__derived'), [t.arrowFunctionExpression([], init)]);
      context.reactive.add(newId);
      path.scope.crawl();
    },
  });
}
