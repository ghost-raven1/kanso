import * as t from '@babel/types';
import { helper, type TransformContext } from './context.js';

const hasChildren = (element: t.Node | undefined) => t.isJSXElement(element) && (
  element.openingElement.attributes.some(attr => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name, { name: 'children' })) ||
  element.children.some(child => t.isJSXText(child) ? child.value.trim().length > 0
    : !t.isJSXExpressionContainer(child) || !t.isJSXEmptyExpression(child.expression))
);

export function transformJsx(context: TransformContext): void {
  context.program.traverse({
    JSXElement: { exit(path) {
      const opening = path.node.openingElement;
      const keys = opening.attributes.filter(attr => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name, { name: 'key' }));
      if (!keys.length) return;
      if (keys.length !== 1) throw path.buildCodeFrameError('KANSO_ELEMENT_KEY: specify one key per element.');
      const key = keys[0] as t.JSXAttribute;
      opening.attributes = opening.attributes.filter(attr => attr !== key);
      if (t.isStringLiteral(key.value)) return;
      if (!t.isJSXExpressionContainer(key.value) || !t.isExpression(key.value.expression))
        throw path.buildCodeFrameError('KANSO_ELEMENT_KEY: use a string or number key.');
      const id = path.scope.generateUidIdentifier('key');
      const component = t.jsxIdentifier(helper(context, '__Keyed').name);
      path.replaceWith(t.jsxElement(t.jsxOpeningElement(component, [
        t.jsxAttribute(t.jsxIdentifier('each'), t.jsxExpressionContainer(t.arrayExpression([key.value.expression]))),
        t.jsxAttribute(t.jsxIdentifier('by'), t.jsxExpressionContainer(t.arrowFunctionExpression([id], t.cloneNode(id)))),
      ]), t.jsxClosingElement(t.cloneNode(component)), [t.jsxExpressionContainer(t.arrowFunctionExpression([], path.node))]));
      path.skip();
    } },
    JSXSpreadAttribute(path) {
      const tag = path.parentPath.node;
      if (t.isObjectExpression(path.node.argument) && path.node.argument.properties.some(prop =>
        t.isObjectProperty(prop) && !prop.computed && (t.isIdentifier(prop.key, { name: 'key' }) || t.isStringLiteral(prop.key, { value: 'key' }))))
        throw path.buildCodeFrameError('KANSO_SPREAD_KEY: move key to an explicit JSX attribute.');
      if (t.isJSXOpeningElement(tag) && t.isJSXIdentifier(tag.name) && /^[a-z]/.test(tag.name.name)) {
        path.node.argument = t.callExpression(helper(context, '__props'), [path.node.argument, t.stringLiteral(tag.name.name),
          t.booleanLiteral(hasChildren(path.parentPath.parentPath?.node))]);
      } else path.node.argument = t.callExpression(helper(context, '__componentProps'), [path.node.argument]);
    },
    JSXAttribute(path) {
      if (!t.isJSXIdentifier(path.node.name)) return;
      const attr = path.node.name.name;
      const tag = path.parentPath.node;
      const intrinsic = t.isJSXOpeningElement(tag) && t.isJSXIdentifier(tag.name) && /^[a-z]/.test(tag.name.name);
      if (!intrinsic) {
        // Solid treats a component ref as a DOM assignment; Kanso passes it as a prop.
        if (attr === 'ref' && t.isJSXExpressionContainer(path.node.value) && t.isExpression(path.node.value.expression)) {
          path.replaceWith(t.jsxSpreadAttribute(t.objectExpression([t.objectProperty(t.identifier('ref'), path.node.value.expression)])));
          path.skip();
        }
        return;
      }
      if (attr === 'className') path.node.name.name = 'class';
      if (attr === 'htmlFor') path.node.name.name = 'for';
      if (attr === 'dangerouslySetInnerHTML') {
        const element = path.parentPath.parentPath?.node;
        if (hasChildren(element))
          throw path.buildCodeFrameError('KANSO_RAW_HTML_CHILDREN: choose raw HTML or children, not both.');
        if (!t.isJSXExpressionContainer(path.node.value) || !t.isExpression(path.node.value.expression))
          throw path.buildCodeFrameError('KANSO_RAW_HTML: use dangerouslySetInnerHTML={{ __html: trustedMarkup }}.');
        path.node.name.name = 'innerHTML';
        path.node.value.expression = t.callExpression(helper(context, '__html'), [path.node.value.expression]);
        return;
      }
      if (!t.isJSXExpressionContainer(path.node.value) || !t.isExpression(path.node.value.expression)) return;
      let method: string | undefined;
      if (/^on[A-Z]/.test(attr)) {
        method = '__event';
        if (attr === 'onChange' && t.isJSXOpeningElement(tag) && t.isJSXIdentifier(tag.name) && ['input', 'textarea'].includes(tag.name.name)) path.node.name.name = 'onInput';
      }
      if (attr === 'style') method = '__style';
      if (attr === 'ref') method = '__ref';
      if (method) path.node.value.expression = t.callExpression(helper(context, method), [method === '__event'
        ? t.arrowFunctionExpression([], path.node.value.expression) : path.node.value.expression]);
    },
  });
}
