import type { Binding, Scope } from '@babel/traverse';
import traverseModule from '@babel/traverse';
import * as t from '@babel/types';
const traverse = (traverseModule as unknown as { default: typeof traverseModule }).default ?? traverseModule;
const eventTypes = new Set(['ChangeEvent','FormEvent','MouseEvent','KeyboardEvent','FocusEvent','PointerEvent','TouchEvent','ClipboardEvent','DragEvent','WheelEvent']);
const handlerTypes = new Set([...eventTypes].map(name => `${name}Handler`));
export const nativeEventTypes = [...eventTypes, ...handlerTypes];
const synthetic = new Set(['persist','isPersistent','isDefaultPrevented','isPropagationStopped','nativeEvent']);

/** Do not silently port synthetic-event members to native DOM events. */
export function auditNativeEvents(ast: t.File, report: (node: t.Node, code: string, message: string) => void): void {
  const types = new Set<t.Identifier>();
  const handlers = new Set<t.Identifier>();
  const namespaces = new Set<t.Identifier>();
  for (const item of ast.program.body) if (t.isImportDeclaration(item) && item.source.value === 'react')
    for (const specifier of item.specifiers) {
      if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported) && eventTypes.has(specifier.imported.name)) types.add(specifier.local);
      if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported) && handlerTypes.has(specifier.imported.name)) handlers.add(specifier.local);
      if (t.isImportDefaultSpecifier(specifier) || t.isImportNamespaceSpecifier(specifier)) namespaces.add(specifier.local);
    }
  const events = new Set<Binding>();
  const isEventType = (node: t.Node | null | undefined, scope: Scope, handler = false): boolean => {
    const annotation = t.isTSTypeAnnotation(node) ? node.typeAnnotation : node;
    const type = t.isTSTypeReference(annotation) ? annotation.typeName : undefined;
    return t.isIdentifier(type) && (handler ? handlers : types).has(scope.getBinding(type.name)?.identifier!)
      || t.isTSQualifiedName(type) && t.isIdentifier(type.left) && namespaces.has(scope.getBinding(type.left.name)?.identifier!)
        && (handler ? handlerTypes : eventTypes).has(type.right.name);
  };
  traverse(ast, { Function(path) {
    const parent = path.parentPath;
    const attribute = parent.isJSXExpressionContainer() ? parent.parentPath : undefined;
    const handler = attribute?.isJSXAttribute() && t.isJSXIdentifier(attribute.node.name) && /^on[A-Z]/.test(attribute.node.name.name);
    const typedHandler = parent.isVariableDeclarator() && t.isIdentifier(parent.node.id) && isEventType(parent.node.id.typeAnnotation, path.scope, true);
    path.node.params.forEach((param, index) => {
      if (!t.isIdentifier(param)) return;
      const explicit = isEventType(param.typeAnnotation, path.scope);
      const binding = path.scope.getBinding(param.name);
      if (binding && (explicit || (handler || typedHandler) && index === 0)) events.add(binding);
    });
  } });
  traverse(ast, { 'MemberExpression|OptionalMemberExpression'(path) {
    if (!path.isMemberExpression() && !path.isOptionalMemberExpression()) return;
    if (!t.isIdentifier(path.node.object) || !events.has(path.scope.getBinding(path.node.object.name)!)) return;
    const name = path.node.computed ? t.isStringLiteral(path.node.property) ? path.node.property.value : undefined : t.isIdentifier(path.node.property) ? path.node.property.name : undefined;
    if (name && synthetic.has(name)) report(path.node, 'SYNTHETIC_EVENT', `Kanso uses native DOM events: replace event.${name} with the native event contract before migration.`);
  } });
}
