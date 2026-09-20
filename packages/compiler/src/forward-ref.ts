import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { replaceReads } from './context.js';

/** Normalize inline forwardRef renderers before collecting component/HMR bindings. */
export function transformForwardRefs(program: NodePath<t.Program>): void {
  program.traverse({ CallExpression(path) {
    if (!t.isIdentifier(path.node.callee)) return;
    const binding = path.scope.getBinding(path.node.callee.name);
    if (!binding?.path.isImportSpecifier() || !t.isIdentifier(binding.path.node.imported, { name: 'forwardRef' }) ||
      !binding.path.parentPath.isImportDeclaration() || binding.path.parentPath.node.source.value !== '@kanso/core') return;
    if (path.node.arguments.length !== 1) throw path.buildCodeFrameError('KANSO_FORWARD_REF: pass exactly one render function.');
    const render = path.node.arguments[0];
    if (!t.isFunctionExpression(render) && !t.isArrowFunctionExpression(render))
      throw path.buildCodeFrameError('KANSO_FORWARD_REF: pass an inline render function to a named component.');
    if (!path.parentPath.isVariableDeclarator() || !t.isIdentifier(path.parentPath.node.id) || !/^[A-Z]/.test(path.parentPath.node.id.name))
      throw path.buildCodeFrameError('KANSO_FORWARD_REF: assign forwardRef to a named const component before exporting it.');
    if (render.async || render.generator || render.params.length > 2)
      throw path.buildCodeFrameError('KANSO_FORWARD_REF: use a synchronous (props, ref) renderer.');
    const callback = path.get('arguments')[0];
    callback.traverse({
      Function(inner) { if (!inner.isArrowFunctionExpression()) inner.skip(); },
      ThisExpression(reference) { throw reference.buildCodeFrameError('KANSO_FORWARD_REF: use explicit props instead of this.'); },
      ReferencedIdentifier(reference) {
        if (reference.node.name === 'arguments' && !reference.scope.hasOwnBinding('arguments')) throw reference.buildCodeFrameError('KANSO_FORWARD_REF: use named props and ref parameters.');
      },
    });
    if (t.isFunctionExpression(render) && render.id && callback.scope.getBinding(render.id.name)?.referencePaths.length)
      throw path.buildCodeFrameError('KANSO_FORWARD_REF: reference the named component instead of its render function.');
    const [props, ref] = render.params;
    if (ref && !t.isIdentifier(ref)) throw path.buildCodeFrameError('KANSO_FORWARD_REF: use a named ref parameter.');
    if (props && !t.isIdentifier(props) && !t.isObjectPattern(props)) throw path.buildCodeFrameError('KANSO_FORWARD_REF: use named or destructured props.');
    const raw = callback.scope.generateUidIdentifier('forwardProps');
    if (ref && t.isIdentifier(ref)) replaceReads(callback.scope.getBinding(ref.name), () => t.memberExpression(t.cloneNode(raw), t.identifier('ref')));
    const body = t.isBlockStatement(render.body) ? render.body : t.blockStatement([t.returnStatement(render.body)]);
    if (props) {
      const clean = t.isIdentifier(props) ? props : callback.scope.generateUidIdentifier('props');
      const withoutRef = t.objectPattern([t.objectProperty(t.identifier('ref'), callback.scope.generateUidIdentifier('ignoredRef')), t.restElement(clean)]);
      body.body.unshift(t.variableDeclaration('const', [t.variableDeclarator(withoutRef, t.cloneNode(raw)), ...(t.isObjectPattern(props) ? [t.variableDeclarator(props, t.cloneNode(clean))] : [])]));
    }
    path.replaceWith(t.arrowFunctionExpression([raw], body));
    path.skip();
  } });
  program.scope.crawl();
}
