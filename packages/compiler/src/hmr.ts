import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import generateModule from '@babel/generator';
const generate =
  (generateModule as unknown as { default: typeof generateModule }).default ??
  generateModule;
interface Definition {
  node: t.Function;
  name: string;
  component: boolean;
  shape: string;
  code: string;
  hooks: string[];
  dependencies: string[];
}
export interface RefreshMetadata {
  definitions: Definition[];
  contexts: { node: t.CallExpression; name: string; code: string }[];
  accepts: boolean;
  mode: 'preserve' | 'remount';
}

/** Collect signatures before lowering: source names and hook kinds, never offsets or initial values. */
export function prepareRefresh(
  program: NodePath<t.Program>,
  mode: RefreshMetadata['mode'],
): RefreshMetadata {
  const definitions: Definition[] = [];
  const contexts: RefreshMetadata['contexts'] = [];
  let unsafeHoisting = false;
  program.traverse({
    CallExpression(path) {
      if (
        path.getFunctionParent() ||
        !path.parentPath.isVariableDeclarator() ||
        !t.isIdentifier(path.parentPath.node.id) ||
        !t.isIdentifier(path.node.callee)
      )
        return;
      const binding = path.scope.getBinding(path.node.callee.name);
      if (
        binding?.path.isImportSpecifier() &&
        t.isIdentifier(binding.path.node.imported, { name: 'createContext' }) &&
        binding.path.parentPath?.isImportDeclaration() &&
        binding.path.parentPath.node.source.value === '@kanso/core'
      )
        contexts.push({
          node: path.node,
          name: path.parentPath.node.id.name,
          code: generate(path.node).code,
        });
    },
  });
  program.traverse({
    Function(path) {
      const name =
        path.isFunctionDeclaration() || path.isFunctionExpression()
          ? path.node.id?.name
          : path.parentPath.isVariableDeclarator() &&
              t.isIdentifier(path.parentPath.node.id)
            ? path.parentPath.node.id.name
            : undefined;
      if (
        !name ||
        !/^(?:[A-Z]|use[A-Z])/.test(name) ||
        path.getFunctionParent()
      )
        return;
      const binding = program.scope.getBinding(name);
      if (
        binding?.referencePaths.some(
          reference =>
            (reference.isIdentifier() || reference.isJSXIdentifier()) &&
            !reference.parentPath.isExportSpecifier() &&
            !reference.getFunctionParent() &&
            (reference.node.start ?? Infinity) < (path.node.start ?? 0),
        )
      )
        unsafeHoisting = true;
      const shape: string[] = [];
      const hooks = new Set<string>();
      const dependencies = new Set<string>();
      path.traverse({
        CallExpression(call) {
          if (
            call.getFunctionParent() !== path ||
            !t.isIdentifier(call.node.callee)
          )
            return;
          const binding = call.scope.getBinding(call.node.callee.name);
          const imported =
            binding?.path.isImportSpecifier() &&
            t.isIdentifier(binding.path.node.imported)
              ? binding.path.node.imported.name
              : call.node.callee.name;
          if (!/^use[A-Z]/.test(imported)) return;
          const declaration = call.parentPath.isVariableDeclarator()
            ? Object.keys(
                t.getBindingIdentifiers(call.parentPath.node.id),
              ).join(',')
            : '';
          const source = binding?.path.parentPath?.isImportDeclaration()
            ? binding.path.parentPath.node.source.value
            : '';
          shape.push(`${source}:${imported}:${declaration}`);
          if (
            ![
              '@kanso/core',
              '@kanso/app',
              'solid-js',
              '@solidjs/router',
            ].includes(source)
          )
            hooks.add(call.node.callee.name);
        },
        ReferencedIdentifier(reference) {
          if (reference.findParent(parent => parent.isTSType())) return;
          const binding = reference.scope.getBinding(reference.node.name);
          if (
            !binding ||
            binding.scope !== program.scope ||
            reference.node.name === name
          )
            return;
          const source = binding.path.parentPath?.isImportDeclaration()
            ? binding.path.parentPath.node.source.value
            : '';
          if (source.startsWith('@kanso/') || source.startsWith('solid-js'))
            return;
          dependencies.add(reference.node.name);
        },
      });
      definitions.push({
        node: path.node,
        name,
        component: /^[A-Z]/.test(name),
        shape: JSON.stringify(shape),
        code: generate(path.node).code,
        hooks: [...hooks],
        dependencies: [...dependencies],
      });
    },
  });
  const components = new Set(
    definitions.filter(item => item.component).map(item => item.name),
  );
  const accepts = program.node.body.every(item => {
    if (t.isExportAllDeclaration(item)) return item.exportKind === 'type';
    if (t.isExportDefaultDeclaration(item))
      return t.isIdentifier(item.declaration)
        ? components.has(item.declaration.name)
        : t.isFunctionDeclaration(item.declaration) &&
            !!item.declaration.id &&
            components.has(item.declaration.id.name);
    if (!t.isExportNamedDeclaration(item) || item.exportKind === 'type')
      return true;
    if (item.source) return false;
    return item.declaration
      ? Object.keys(t.getBindingIdentifiers(item.declaration)).every(name =>
          components.has(name),
        )
      : item.specifiers.every(
          specifier =>
            t.isExportSpecifier(specifier) &&
            t.isIdentifier(specifier.local) &&
            components.has(specifier.local.name),
        );
  });
  return {
    definitions: unsafeHoisting ? [] : definitions,
    contexts: unsafeHoisting ? [] : contexts,
    accepts,
    mode,
  };
}

/** Own the Vite acceptance boundary; Solid still owns JSX compilation and reactive DOM work. */
export function finishRefresh(
  program: NodePath<t.Program>,
  metadata: RefreshMetadata,
): void {
  if (!metadata.definitions.length && !metadata.contexts.length) return;
  const ids = Object.fromEntries(
    ['registry', 'component', 'hook', 'initialize', 'update', 'context'].map(
      name => [name, program.scope.generateUidIdentifier(`hmr_${name}`)],
    ),
  );
  const registry = program.scope.generateUidIdentifier('hotRegistry');
  const object = (definition: Definition) =>
    t.objectExpression([
      t.objectProperty(
        t.identifier('shape'),
        t.stringLiteral(definition.shape),
      ),
      t.objectProperty(t.identifier('code'), t.stringLiteral(definition.code)),
      t.objectProperty(
        t.identifier('hooks'),
        t.arrowFunctionExpression(
          [],
          t.arrayExpression(definition.hooks.map(name => t.identifier(name))),
        ),
      ),
      t.objectProperty(
        t.identifier('dependencies'),
        t.arrowFunctionExpression(
          [],
          t.arrayExpression(
            definition.dependencies.map(name => t.identifier(name)),
          ),
        ),
      ),
    ]);
  program.traverse({
    Function(path) {
      const definition = metadata.definitions.find(
        item => item.node === path.node,
      );
      if (!definition) return;
      const original = path.node;
      const value = t.isFunctionDeclaration(original)
        ? t.functionExpression(
            original.id,
            original.params,
            original.body,
            original.generator,
            original.async,
          )
        : original;
      if (!t.isExpression(value)) return;
      const args = definition.component
        ? [
            t.cloneNode(registry),
            t.stringLiteral(definition.name),
            value,
            object(definition),
          ]
        : [value, object(definition)];
      const call = t.callExpression(
        t.cloneNode(ids[definition.component ? 'component' : 'hook']),
        args,
      );
      if (path.isFunctionDeclaration()) {
        const declaration = t.variableDeclaration('const', [
          t.variableDeclarator(t.identifier(definition.name), call),
        ]);
        if (path.parentPath.isExportDefaultDeclaration())
          path.parentPath.replaceWithMultiple([
            declaration,
            t.exportDefaultDeclaration(t.identifier(definition.name)),
          ]);
        else path.replaceWith(declaration);
      } else path.replaceWith(call);
      path.skip();
    },
  });
  program.traverse({
    CallExpression(path) {
      const item = metadata.contexts.find(item => item.node === path.node);
      if (!item) return;
      path.replaceWith(
        t.callExpression(t.cloneNode(ids.context), [
          t.cloneNode(registry),
          t.stringLiteral(item.name),
          t.arrowFunctionExpression([], item.node),
          t.stringLiteral(item.code),
        ]),
      );
      path.skip();
    },
  });
  const imports: t.ImportSpecifier[] = Object.entries(ids).map(([name, id]) =>
    t.importSpecifier(id, t.identifier(name)),
  );
  for (const statement of program.node.body) {
    if (!t.isImportDeclaration(statement)) continue;
    const source = statement.source.value;
    for (const specifier of [...statement.specifiers])
      if (
        t.isImportSpecifier(specifier) &&
        t.isIdentifier(specifier.imported) &&
        ((source === '@kanso/core/internal' &&
          ['__state', '__reducer'].includes(specifier.imported.name)) ||
          (source === '@kanso/core' &&
            ['useRef', 'useId'].includes(specifier.imported.name)))
      ) {
        imports.push(specifier);
        statement.specifiers = statement.specifiers.filter(
          item => item !== specifier,
        );
      }
  }
  program.unshiftContainer(
    'body',
    t.importDeclaration(imports, t.stringLiteral('@kanso/core/hmr')),
  );
  const hot = t.memberExpression(
    t.metaProperty(t.identifier('import'), t.identifier('meta')),
    t.identifier('hot'),
  );
  if (
    metadata.definitions.some(item => item.component) ||
    metadata.contexts.length
  )
    program.unshiftContainer(
      'body',
      t.variableDeclaration('const', [
        t.variableDeclarator(
          registry,
          t.callExpression(t.cloneNode(ids.registry), [
            t.stringLiteral(metadata.mode),
            t.logicalExpression(
              '&&',
              t.cloneNode(hot),
              t.memberExpression(t.cloneNode(hot), t.identifier('data')),
            ),
          ]),
        ),
      ]),
    );
  if (!metadata.definitions.some(item => item.component)) return;
  program.pushContainer(
    'body',
    t.expressionStatement(
      t.callExpression(t.cloneNode(ids.initialize), [t.cloneNode(registry)]),
    ),
  );
  program.pushContainer(
    'body',
    t.exportNamedDeclaration(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier('__kanso_hmr'),
          t.cloneNode(registry),
        ),
      ]),
    ),
  );
  if (!metadata.accepts) return;
  const next = t.identifier('next');
  const nextRegistry = t.memberExpression(next, t.identifier('__kanso_hmr'));
  const valid = t.logicalExpression(
    '&&',
    next,
    t.logicalExpression(
      '&&',
      nextRegistry,
      t.callExpression(t.cloneNode(ids.update), [
        t.cloneNode(registry),
        nextRegistry,
      ]),
    ),
  );
  program.pushContainer(
    'body',
    t.ifStatement(
      hot,
      t.expressionStatement(
        t.callExpression(
          t.memberExpression(t.cloneNode(hot), t.identifier('accept')),
          [
            t.arrowFunctionExpression(
              [next],
              t.blockStatement([
                // A failed module import leaves the previous implementation active.
                t.ifStatement(t.unaryExpression('!', next), t.returnStatement()),
                t.ifStatement(
                  t.unaryExpression('!', valid),
                  t.expressionStatement(
                    t.callExpression(
                      t.memberExpression(
                        t.cloneNode(hot),
                        t.identifier('invalidate'),
                      ),
                      [t.stringLiteral('Kanso component boundary changed')],
                    ),
                  ),
                ),
              ]),
            ),
          ],
        ),
      ),
    ),
  );
}
