import * as t from '@babel/types';
import { hasReactive, tracked, isSetup, type TransformContext } from './context.js';
import { bindPattern } from './patterns.js';

/** Component parameters and setup destructuring share one recursive binding transform. */
export function transformProps(context: TransformContext): void {
  context.program.traverse({ Function(path) {
    const name = (path.isFunctionDeclaration() || path.isFunctionExpression()) ? path.node.id?.name
      : path.parentPath.isVariableDeclarator() && t.isIdentifier(path.parentPath.node.id) ? path.parentPath.node.id.name : '';
    if (!name || !/^[A-Z]/.test(name)) return;
    const parameter = path.node.params[0];
    if (t.isIdentifier(parameter)) { context.props.add(parameter); return; }
    if (!t.isObjectPattern(parameter)) return;
    if (!t.isBlockStatement(path.node.body)) path.node.body = t.blockStatement([t.returnStatement(path.node.body)]);
    const props = path.scope.generateUidIdentifier('props');
    props.typeAnnotation = parameter.typeAnnotation;
    const declarations = bindPattern(context, path, parameter, t.cloneNode(props));
    path.node.params[0] = props; context.props.add(props);
    path.node.body.body.unshift(t.variableDeclaration('const', declarations));
  } });
}

export function transformLocalProps(context: TransformContext): void {
  context.program.traverse({ VariableDeclarator(path) {
    const { id, init } = path.node;
    if (!isSetup(path) || !(t.isObjectPattern(id) || t.isArrayPattern(id)) || !init || !t.isExpression(init)) return;
    if (t.isCallExpression(init) && t.isIdentifier(init.callee) && [...context.helpers.values()].some(value => value.name === (init.callee as t.Identifier).name)) return;
    if (!(t.isIdentifier(init) && tracked(context, path.scope, init.name, 'props')) && !hasReactive(path.get('init'), context)) return;
    if (!path.parentPath.isVariableDeclaration({ kind: 'const' })) throw path.buildCodeFrameError('KANSO_PROPS: destructure live values with const.');
    path.replaceWithMultiple(bindPattern(context, path, id, init));
    path.scope.crawl();
  } });
}
