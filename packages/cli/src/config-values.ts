import * as t from '@babel/types';
import traverseModule from '@babel/traverse';
const traverse = (traverseModule as unknown as { default: typeof traverseModule }).default ?? traverseModule;
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Interpret only strings and the standard URL-to-filesystem idiom, never user JavaScript. */
export function configStrings(ast: t.File, file: string): (node: t.Node | null | undefined) => string {
  const shadowed = new Set<t.Node>();
  traverse(ast, { ReferencedIdentifier(path) {
    const binding = path.scope.getBinding(path.node.name);
    if (binding && !binding.scope.path.isProgram()) shadowed.add(path.node);
  } });
  const imports = new Map<string, string>();
  const constants = new Map<string, t.Expression>();
  const bindings = new Set<string>();
  for (const statement of ast.program.body) {
    const item = t.isExportNamedDeclaration(statement) ? statement.declaration : statement;
    if (!item) continue;
    Object.keys(t.getBindingIdentifiers(item)).forEach(name => bindings.add(name));
    if (t.isImportDeclaration(item) && ['url', 'node:url'].includes(item.source.value))
      for (const specifier of item.specifiers) if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported)) imports.set(specifier.local.name, specifier.imported.name);
    if (t.isVariableDeclaration(item, { kind: 'const' }))
      for (const declaration of item.declarations) if (t.isIdentifier(declaration.id) && t.isExpression(declaration.init)) constants.set(declaration.id.name, declaration.init);
  }
  const read = (node: t.Node | null | undefined, argumentsMap = new Map<string, string>(), trail = new Set<string>()): string => {
    if (t.isStringLiteral(node)) return node.value;
    if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node)) return read(node.expression, argumentsMap, trail);
    if (t.isIdentifier(node)) {
      if (argumentsMap.has(node.name)) return argumentsMap.get(node.name)!;
      if (!shadowed.has(node) && constants.has(node.name) && !trail.has(node.name)) return read(constants.get(node.name), argumentsMap, new Set(trail).add(node.name));
    }
    if (t.isCallExpression(node) && t.isIdentifier(node.callee) && node.arguments.length === 1 && !argumentsMap.has(node.callee.name) && !shadowed.has(node.callee)) {
      const name = node.callee.name;
      const value = node.arguments[0];
      if (imports.get(name) === 'fileURLToPath' && t.isNewExpression(value) && t.isIdentifier(value.callee) &&
        (imports.get(value.callee.name) === 'URL' || value.callee.name === 'URL' && !bindings.has('URL')) && !argumentsMap.has(value.callee.name) && !shadowed.has(value.callee) &&
        value.arguments.length === 2 && t.isMemberExpression(value.arguments[1]) && !value.arguments[1].computed &&
        t.isMetaProperty(value.arguments[1].object) && t.isIdentifier(value.arguments[1].object.meta, { name: 'import' }) &&
        t.isIdentifier(value.arguments[1].object.property, { name: 'meta' }) && t.isIdentifier(value.arguments[1].property, { name: 'url' }))
        return fileURLToPath(new URL(read(value.arguments[0], argumentsMap, trail), pathToFileURL(file)));
      const fn = constants.get(name);
      if (!trail.has(name) && (t.isArrowFunctionExpression(fn) || t.isFunctionExpression(fn)) && !fn.async && !fn.generator && fn.params.length === 1 && t.isIdentifier(fn.params[0])) {
        const body = t.isBlockStatement(fn.body) ? fn.body.body.length === 1 && t.isReturnStatement(fn.body.body[0]) ? fn.body.body[0].argument : undefined : fn.body;
        const argument = read(value, argumentsMap, trail);
        return read(body, new Map([[fn.params[0].name, argument]]), new Set(trail).add(name));
      }
    }
    throw new Error('PATH_ALIAS_DYNAMIC: use a static path or a pure fileURLToPath(new URL(path, import.meta.url)) helper.');
  };
  return node => read(node);
}
