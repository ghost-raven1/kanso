import * as t from '@babel/types';
import { helper, replaceReads, isPureExpression, type TransformContext } from './context.js';
import { bindPattern } from './patterns.js';

/** Key evaluation uses snapshots; mounted row calculations follow the live item and index. */
export function transformLists(context: TransformContext): void {
  context.program.traverse({ CallExpression: { exit(path) {
    const { callee, arguments: args } = path.node;
    if (!t.isMemberExpression(callee) || !t.isIdentifier(callee.property, { name: 'map' }) || !t.isExpression(callee.object)) return;
    const render = args[0];
    if (!t.isArrowFunctionExpression(render)) return;
    const callback = path.get('arguments')[0];
    let body = render.body;
    const setup = t.isBlockStatement(body) ? body.body.slice(0, -1) : [];
    if (t.isBlockStatement(body)) {
      const last = body.body.at(-1);
      if (!t.isReturnStatement(last) || !t.isJSXElement(last.argument)) {
        let jsx = false;
        t.traverseFast(body, node => { if (t.isJSXElement(node) || t.isJSXFragment(node)) jsx = true; });
        if (jsx) throw path.buildCodeFrameError('KANSO_LIST_BODY: use pure const declarations followed by one keyed JSX return.');
        return;
      }
      body = last.argument;
    }
    if (t.isJSXFragment(body)) throw path.buildCodeFrameError('KANSO_LIST_KEY: use a keyed Fragment or child component.');
    if (!t.isJSXElement(body)) return;
    for (const statement of setup) {
      if (!t.isVariableDeclaration(statement, { kind: 'const' }) || statement.declarations.some(value => !value.init))
        throw path.buildCodeFrameError('KANSO_LIST_BODY: move side effects and control flow into a child component; row setup supports pure const declarations.');
    }
    if (t.isBlockStatement(render.body)) {
      const statements = callback.get('body') as import('@babel/traverse').NodePath<t.BlockStatement>;
      for (const statement of statements.get('body').slice(0, -1))
        if (!isPureExpression(statement, context)) throw statement.buildCodeFrameError('KANSO_LIST_BODY: row calculations must be pure; move hooks and effects into a child component.');
    }
    const key = body.openingElement.attributes.find(attr => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name, { name: 'key' }));
    if (!t.isJSXAttribute(key) || !t.isJSXExpressionContainer(key.value) || !t.isExpression(key.value.expression)) throw path.buildCodeFrameError('KANSO_LIST_KEY: JSX lists require an explicit stable key.');
    if (render.params.length > 2 || render.params.some(param => !t.isIdentifier(param) && !t.isObjectPattern(param) && !t.isArrayPattern(param))) throw path.buildCodeFrameError('KANSO_LIST_PARAMS: use item and optional index bindings, without variadic parameters.');
    const keyFunction = t.arrowFunctionExpression(render.params.map(param => t.cloneNode(param, true)),
      t.blockStatement([...setup.map(statement => t.cloneNode(statement, true)), t.returnStatement(t.cloneNode(key.value.expression, true))]));
    for (const parameter of (callback as import('@babel/traverse').NodePath<t.ArrowFunctionExpression>).get('params'))
      if (!isPureExpression(parameter, context)) throw parameter.buildCodeFrameError('KANSO_LIST_PARAMS: defaults must be pure calculations.');
    const declarations: t.VariableDeclarator[] = [];
    render.params = render.params.map(param => {
      const read = callback.scope.generateUidIdentifier(t.isIdentifier(param) ? param.name : 'item');
      if (t.isIdentifier(param)) replaceReads(callback.scope.getBinding(param.name), () => t.callExpression(t.cloneNode(read), []));
      else declarations.push(...bindPattern(context, callback, param, t.callExpression(t.cloneNode(read), [])));
      context.reactive.add(read);
      return read;
    });
    body.openingElement.attributes = body.openingElement.attributes.filter(attr => attr !== key);
    render.body = t.blockStatement([
      ...(declarations.length ? [t.variableDeclaration('const', declarations)] : []),
      ...setup, t.returnStatement(body),
    ]);
    context.rows.add(render);
    const component = t.jsxIdentifier(helper(context, '__Keyed').name);
    path.replaceWith(t.jsxElement(t.jsxOpeningElement(component, [
      t.jsxAttribute(t.jsxIdentifier('each'), t.jsxExpressionContainer(callee.object)),
      t.jsxAttribute(t.jsxIdentifier('by'), t.jsxExpressionContainer(keyFunction)),
    ]), t.jsxClosingElement(t.cloneNode(component)), [t.jsxExpressionContainer(render)]));
    path.skip();
  } } });
}
