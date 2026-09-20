import traverseModule from '@babel/traverse';
import * as t from '@babel/types';
const traverse =
  (traverseModule as unknown as { default: typeof traverseModule }).default ??
  traverseModule;

/** Track state provenance in setup only; handler locals remain intentional snapshots. */
export function derivedStateSources(
  ast: t.File,
  states: Set<t.Identifier>,
  hooks: Map<t.Identifier, string>,
): Map<t.Identifier, Set<t.Identifier>> {
  const sources = new Map([...states].map(id => [id, new Set([id])]));
  let changed = true;
  while (changed) {
    changed = false;
    traverse(ast, {
      VariableDeclarator(path) {
        const owner = path.getFunctionParent();
        const name =
          owner?.isFunctionDeclaration() || owner?.isFunctionExpression()
            ? owner.node.id?.name
            : owner?.parentPath.isVariableDeclarator() &&
                t.isIdentifier(owner.parentPath.node.id)
              ? owner.parentPath.node.id.name
              : '';
        if (
          !name ||
          !/^(?:[A-Z]|use[A-Z])/.test(name) ||
          !path.parentPath.isVariableDeclaration({ kind: 'const' })
        )
          return;
        const init = path.get('init');
        if (!init.node || init.isFunction()) return;
        let input = init;
        if (init.isCallExpression() && t.isIdentifier(init.node.callee)) {
          const hook = hooks.get(
            init.scope.getBinding(init.node.callee.name)?.identifier!,
          );
          if (hook && hook !== 'useMemo') return;
          if (hook === 'useMemo')
            input = (init.get('arguments')[1] ??
              init.get('arguments')[0]) as typeof init;
        }
        if (!input?.node) return;
        const dependencies = new Set<t.Identifier>();
        const read = (id: { name: string }, scope: typeof path.scope) => {
          for (const source of sources.get(
            scope.getBinding(id.name)?.identifier!,
          ) ?? [])
            dependencies.add(source);
        };
        if (input.isReferencedIdentifier() && input.isIdentifier())
          read(input.node, input.scope);
        input.traverse({
          ReferencedIdentifier(ref) {
            read(ref.node, ref.scope);
          },
        });
        if (!dependencies.size) return;
        for (const id of Object.values(t.getBindingIdentifiers(path.node.id))) {
          const previous = sources.get(id) ?? new Set<t.Identifier>();
          for (const dependency of dependencies)
            if (!previous.has(dependency)) {
              previous.add(dependency);
              changed = true;
            }
          sources.set(id, previous);
          states.add(id);
        }
      },
    });
  }
  return sources;
}
