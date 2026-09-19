import * as t from '@babel/types';
import { helper, replaceReads, isSetup, type TransformContext } from './context.js';

export function transformProps(context: TransformContext): void {
  context.program.traverse({
    Function(path) {
      const name = t.isFunctionDeclaration(path.node) || t.isFunctionExpression(path.node) ? path.node.id?.name
        : path.parentPath.isVariableDeclarator() && t.isIdentifier(path.parentPath.node.id) ? path.parentPath.node.id.name : '';
      if (!name || !/^[A-Z]/.test(name)) return;
      const param = path.node.params[0];
      if (t.isIdentifier(param)) { context.props.add(param.name); return; }
      if (!t.isObjectPattern(param)) return;
      const props = path.scope.generateUidIdentifier('props');
      props.typeAnnotation = param.typeAnnotation;
      context.props.add(props.name);
      const keys: t.StringLiteral[] = [];
      for (const property of param.properties) {
        if (t.isRestElement(property)) continue;
        if (property.computed || !t.isIdentifier(property.key)) throw path.buildCodeFrameError('KANSO_PROPS: use named, non-computed props.');
        keys.push(t.stringLiteral(property.key.name));
        const value = property.value;
        const local = t.isAssignmentPattern(value) ? value.left : value;
        if (!t.isIdentifier(local)) throw path.buildCodeFrameError('KANSO_PROPS: nested destructuring must be an explicit derived value.');
        const access = () => t.memberExpression(t.cloneNode(props), t.cloneNode(property.key as t.Identifier));
        replaceReads(path.scope.getBinding(local.name), () => t.isAssignmentPattern(value)
          ? t.conditionalExpression(t.binaryExpression('===', access(), t.identifier('undefined')), t.cloneNode(value.right), access()) : access());
      }
      const rest = param.properties.find(t.isRestElement);
      path.node.params[0] = props;
      if (rest) {
        if (!t.isIdentifier(rest.argument) || !t.isBlockStatement(path.node.body)) throw path.buildCodeFrameError('KANSO_PROPS: rest props require a block body.');
        path.node.body.body.unshift(t.variableDeclaration('const', [t.variableDeclarator(
          t.arrayPattern([null, rest.argument]), t.callExpression(helper(context, '__splitProps'), [t.cloneNode(props), t.arrayExpression(keys)]),
        )]));
      }
    },
  });
}

/** Destructuring a live props/data object retains property reads. */
export function transformLocalProps(context: TransformContext): void {
  context.program.traverse({ VariableDeclarator(path) {
    const { id, init } = path.node;
    const liveValue = t.isCallExpression(init) && t.isIdentifier(init.callee) && context.reactive.has(init.callee.name);
    if (!isSetup(path) || !t.isObjectPattern(id) || !init || !t.isExpression(init)
      || !(t.isIdentifier(init) && context.props.has(init.name) || liveValue)) return;
    if (!path.parentPath.isVariableDeclaration({ kind: 'const' })) throw path.buildCodeFrameError('KANSO_PROPS: destructure live props with const.');
    const keys: t.StringLiteral[] = [];
    let rest: t.RestElement | undefined;
    for (const property of id.properties) {
      if (t.isRestElement(property)) { rest = property; continue; }
      if (property.computed || !t.isIdentifier(property.key)) throw path.buildCodeFrameError('KANSO_PROPS: use named props.');
      const local = t.isAssignmentPattern(property.value) ? property.value.left : property.value;
      if (!t.isIdentifier(local)) throw path.buildCodeFrameError('KANSO_PROPS: nested destructuring requires an explicit derived value.');
      keys.push(t.stringLiteral(property.key.name));
      const read = () => t.memberExpression(t.cloneNode(init), t.cloneNode(property.key as t.Identifier));
      replaceReads(path.scope.getBinding(local.name), () => t.isAssignmentPattern(property.value)
        ? t.conditionalExpression(t.binaryExpression('===', read(), t.identifier('undefined')), t.cloneNode(property.value.right), read()) : read());
    }
    if (rest && t.isIdentifier(rest.argument)) {
      if (liveValue) throw path.buildCodeFrameError('KANSO_PROPS: destructure named live fields; rest requires a stable props object.');
      path.node.id = t.arrayPattern([null, rest.argument]);
      path.node.init = t.callExpression(helper(context, '__splitProps'), [init, t.arrayExpression(keys)]);
      context.props.add(rest.argument.name);
    } else path.remove();
  } });
}
