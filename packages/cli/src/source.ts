import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generatorModule from '@babel/generator';
import * as t from '@babel/types';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { compile } from '@kanso/compiler';
import type { Scope } from '@babel/traverse';
import type { Diagnostic } from './types.js';

const traverse = (traverseModule as unknown as { default: typeof traverseModule }).default ?? traverseModule;
const generate = (generatorModule as unknown as { default: typeof generatorModule }).default ?? generatorModule;
const supported = new Set(['useState', 'useReducer', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useId', 'createContext', 'useContext', 'lazy', 'Suspense', 'Fragment', 'ReactNode', 'FC', 'ComponentType', 'PropsWithChildren', 'Dispatch', 'SetStateAction', 'ComponentProps', 'CSSProperties', 'RefObject']);

export function migrateSource(source: string, file: string, approvedHooks: ReadonlySet<string> = new Set()): { code: string; diagnostics: Diagnostic[]; imports: string[] } {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const diagnostics: Diagnostic[] = [];
  const imports: string[] = [];
  let changed = false;
  const hooks = new Map<t.Identifier, string>();
  const reactHooks = new Set<t.Identifier>();
  const roots = new Set<t.Identifier>();
  const hydrateNames = new Set<t.Identifier>();
  const stateNames = new Set<t.Identifier>();
  const setters = new Set<t.Identifier>();
  const customHooks = new Set<t.Identifier>();
  const binding = (scope: Scope, name: string) => scope.getBinding(name)?.identifier;
  const hookCandidates = new Set<t.Identifier>();
  const customObjects = new Set<t.Identifier>();
  const report = (node: t.Node, code: string, message: string, severity: 'error' | 'warning' = 'error') => {
    diagnostics.push({ file, line: node.loc?.start.line, column: node.loc ? node.loc.start.column + 1 : undefined, endLine: node.loc?.end.line, endColumn: node.loc ? node.loc.end.column + 1 : undefined, code, message, severity, hint: diagnosticHint(code), docsUrl: 'https://github.com/ghost-raven1/kanso/blob/main/docs/migration.md' });
  };
  traverse(ast, {
    ImportDeclaration(path) {
      const from = path.node.source.value;
      imports.push(from);
      for (const specifier of path.node.specifiers) {
        const name = t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.local.name;
        if (/^use[A-Z]/.test(name)) hookCandidates.add(specifier.local);
        if (approvedHooks.has(specifier.local.name)) customHooks.add(specifier.local);
        if (['@kanso/core', '@kanso/app'].includes(from)) hooks.set(specifier.local, name);
      }
      if (from === 'react') {
        changed = true; path.node.source.value = '@kanso/core';
        for (const specifier of path.node.specifiers) {
          if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported)) {
            const name = specifier.imported.name;
            if (!supported.has(name)) report(specifier, 'UNSUPPORTED_API', `React.${name} has no automatic migration.`);
            hooks.set(specifier.local, name);
            reactHooks.add(specifier.local);
          } else if (t.isImportDefaultSpecifier(specifier) || t.isImportNamespaceSpecifier(specifier)) {
            const binding = path.scope.getBinding(specifier.local.name);
            let qualifiedTypes = false;
            path.scope.path.traverse({ TSQualifiedName(qualified) {
              if (!t.isIdentifier(qualified.node.left) || qualified.scope.getBinding(qualified.node.left.name)?.identifier !== specifier.local) return;
              qualifiedTypes = true;
              if (!supported.has(qualified.node.right.name)) report(qualified.node, 'UNSUPPORTED_API', `React.${qualified.node.right.name} needs an explicit type port.`);
            } });
            for (const reference of binding?.referencePaths ?? []) {
              const member = reference.parentPath;
              if (member?.isJSXMemberExpression() && t.isJSXIdentifier(member.node.property)) {
                const name = member.node.property.name;
                if (!supported.has(name)) { report(member.node, 'UNSUPPORTED_API', `React.${name} needs a manual port.`); continue; }
                const local = path.scope.generateUidIdentifier(name);
                path.node.specifiers.push(t.importSpecifier(local, t.identifier(name)));
                member.replaceWith(t.jsxIdentifier(local.name));
              } else if (member?.isMemberExpression() && !member.node.computed && t.isIdentifier(member.node.property)) {
                const name = member.node.property.name;
                if (!supported.has(name)) { report(member.node, 'UNSUPPORTED_API', `React.${name} needs a manual port.`); continue; }
                const local = path.scope.generateUidIdentifier(name);
                path.node.specifiers.push(t.importSpecifier(local, t.identifier(name)));
                hooks.set(local, name); reactHooks.add(local); member.replaceWith(local);
              } else if (member?.isTSQualifiedName() && !supported.has(member.node.right.name)) report(member.node, 'UNSUPPORTED_API', `React.${member.node.right.name} needs an explicit type port.`);
              else if (!reference.findParent(parent => parent.isTSType())) report(reference.node, 'REACT_NAMESPACE', 'Dynamic React namespace access requires a manual port.');
            }
            // Keep type-qualified references such as React.FC valid.
            path.node.specifiers = path.node.specifiers.filter(item => item !== specifier);
            if (qualifiedTypes || binding?.referencePaths.some(ref => ref.findParent(parent => parent.isTSType()))) {
              path.insertAfter(t.importDeclaration([t.importNamespaceSpecifier(specifier.local)], t.stringLiteral('@kanso/core')));
            }
          }
        }
      }
      if (from === 'react-dom/client') {
        changed = true; path.node.source.value = '@kanso/core/client';
        for (const specifier of path.node.specifiers) {
          if (!t.isImportSpecifier(specifier) || !t.isIdentifier(specifier.imported)) { report(specifier, 'ROOT_IMPORT', 'Use named createRoot/hydrateRoot imports.'); continue; }
          if (specifier.imported.name === 'createRoot') roots.add(specifier.local);
          else if (specifier.imported.name === 'hydrateRoot') hydrateNames.add(specifier.local);
          else report(specifier, 'ROOT_API', 'Unsupported React DOM API.');
        }
      } else if (from.startsWith('react-dom')) report(path.node, 'REACT_DOM', `${from} requires a manual port.`);
      if (from === '@vitejs/plugin-react' || from === '@vitejs/plugin-react-swc') {
        changed = true; path.node.source.value = '@kanso/vite';
        for (const specifier of path.node.specifiers) hooks.set(specifier.local, 'vitePlugin');
      }
    },
    ClassDeclaration(path) { if (path.node.superClass) report(path.node, 'CLASS_COMPONENT', 'Class inheritance requires review; component classes must become functions.'); },
    Function(path) {
      const name = (path.isFunctionDeclaration() || path.isFunctionExpression()) && path.node.id ? path.node.id.name
        : path.parentPath.isVariableDeclarator() && t.isIdentifier(path.parentPath.node.id) ? path.parentPath.node.id.name : '';
      if (/^use[A-Z]/.test(name)) { const id = binding(path.scope, name); if (id) customHooks.add(id); }
    },
    ExportNamedDeclaration(path) { if (path.node.source) imports.push(path.node.source.value); },
    ExportAllDeclaration(path) { imports.push(path.node.source.value); },
    CallExpression(path) {
      if (t.isImport(path.node.callee)) {
        if (t.isStringLiteral(path.node.arguments[0])) imports.push(path.node.arguments[0].value);
        else report(path.node, 'DYNAMIC_IMPORT', 'Computed imports cannot be audited automatically.');
      }
    },
  });
  traverse(ast, { Program(path) { path.scope.crawl(); } });
  traverse(ast, {
    VariableDeclarator(path) {
      if (!t.isCallExpression(path.node.init) || !t.isIdentifier(path.node.init.callee)) return;
      const name = hooks.get(binding(path.scope, path.node.init.callee.name)!);
      if (customHooks.has(binding(path.scope, path.node.init.callee.name)!)) {
        const pattern = path.node.id;
        if (t.isIdentifier(pattern)) { customObjects.add(pattern); stateNames.add(pattern); setters.add(pattern); }
        const bindings = t.getBindingIdentifiers(pattern);
        for (const local of Object.keys(bindings)) { stateNames.add(bindings[local]); setters.add(bindings[local]); }
      }
      if (name === 'useState' || name === 'useReducer') {
        if (t.isArrayPattern(path.node.id)) {
          if (t.isIdentifier(path.node.id.elements[0])) stateNames.add(path.node.id.elements[0]);
          if (t.isIdentifier(path.node.id.elements[1])) setters.add(path.node.id.elements[1]);
        }
      }
      if (roots.has(binding(path.scope, path.node.init.callee.name)!) && t.isIdentifier(path.node.id)) roots.add(path.node.id);
    },
  });
  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (t.isIdentifier(callee)) {
        const name = hooks.get(binding(path.scope, callee.name)!);
        if (reactHooks.has(binding(path.scope, callee.name)!) && name === 'useEffect' && !path.node.arguments[1]) report(path.node, 'EFFECT_TRACKING', 'An effect without dependencies becomes auto-tracked. Add an explicit dependency array after review.');
        if (reactHooks.has(binding(path.scope, callee.name)!) && name === 'useCallback' && t.isArrayExpression(path.node.arguments[1]) && path.node.arguments[1].elements.length === 0) {
          const callback = path.get('arguments')[0];
          callback?.traverse({ ReferencedIdentifier(ref) {
            if (stateNames.has(binding(ref.scope, ref.node.name)!)) report(ref.node, 'CALLBACK_SNAPSHOT', 'A callback with empty dependencies reads live state after migration; review its snapshot contract.');
          } });
        }
        if (name === 'vitePlugin' && path.node.arguments.length) report(path.node, 'VITE_OPTIONS', 'React plugin options need manual removal or conversion.');
        if ((/^use[A-Z]/.test(callee.name) || hookCandidates.has(binding(path.scope, callee.name)!)) && !name && !customHooks.has(binding(path.scope, callee.name)!)) report(path.node, 'CUSTOM_HOOK', `Cannot verify the compiled local contract of ${callee.name}.`);
        if (hydrateNames.has(binding(path.scope, callee.name)!)) {
          const [container, element] = path.node.arguments;
          if (t.isExpression(container) && t.isExpression(element)) path.node.arguments = [t.arrowFunctionExpression([], element), container];
        }
      }
      if (t.isMemberExpression(callee) && t.isIdentifier(callee.property, { name: 'render' })) {
        const root = t.isIdentifier(callee.object) && roots.has(binding(path.scope, callee.object.name)!)
          || t.isCallExpression(callee.object) && t.isIdentifier(callee.object.callee) && roots.has(binding(path.scope, callee.object.callee.name)!);
        if (root && t.isExpression(path.node.arguments[0])) path.node.arguments[0] = t.arrowFunctionExpression([], path.node.arguments[0]);
      }
    },
    Function(path) {
      let writes = 0;
      let readsAfterWrite = false;
      path.traverse({
        Function(inner) { inner.skip(); },
        CallExpression: { exit(call) {
          const callee=call.node.callee;
          if (t.isIdentifier(callee) && setters.has(binding(call.scope, callee.name)!) || t.isMemberExpression(callee) && t.isIdentifier(callee.object) && customObjects.has(binding(call.scope, callee.object.name)!)) writes++;
        } },
        ReferencedIdentifier(ref) { if (writes && stateNames.has(binding(ref.scope, ref.node.name)!)) readsAfterWrite = true; },
      });
      if (writes > 1 || readsAfterWrite) report(path.node, 'STATE_SNAPSHOT', 'Multiple updates or reads after a setter require review: Kanso reads live state.');
      const delayed = path.node.async || path.parentPath.isCallExpression() && (
        t.isIdentifier(path.parentPath.node.callee) && ['setTimeout', 'setInterval', 'queueMicrotask'].includes(path.parentPath.node.callee.name)
        || t.isMemberExpression(path.parentPath.node.callee) && t.isIdentifier(path.parentPath.node.callee.property, { name: 'then' }));
      if (delayed) path.traverse({ ReferencedIdentifier(ref) {
        if (stateNames.has(binding(ref.scope, ref.node.name)!)) report(ref.node, 'ASYNC_SNAPSHOT', 'Capture an explicit local snapshot if this callback must retain React render-time state.');
      } });
    },
  });
  const generated = changed ? generate(ast, { retainLines: false, sourceMaps: true, sourceFileName: file }, source) : undefined;
  const code = generated ? generated.code + '\n' : source;
  if (!diagnostics.some(item => item.severity === 'error') && !file.includes('vite.config')) {
    try { compile(code, { filename: file }); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.match(/KANSO_[A-Z_]+/)?.[0] ?? 'COMPILER';
      const location = message.match(/>\s*(\d+)\s*\|[^\n]*\n\s*\| ( *)\^/);
      const mapped = location && generated?.map ? originalPositionFor(new TraceMap(generated.map as ConstructorParameters<typeof TraceMap>[0]), { line: Number(location[1]), column: location[2].length }) : undefined;
      const line = mapped?.line ?? (location ? Number(location[1]) : undefined);
      const column = mapped?.column != null ? mapped.column + 1 : location ? location[2].length + 1 : undefined;
      const summary = message.slice(message.indexOf(code) >= 0 ? message.indexOf(code) : 0).split('\n')[0];
      const frame = line && column ? `\n${line} | ${source.split('\n')[line - 1]}\n${' '.repeat(String(line).length)} | ${' '.repeat(column - 1)}^` : '';
      diagnostics.push({ file, code, message: summary + frame, line, column, severity: 'error', hint: diagnosticHint(code), docsUrl: 'https://github.com/ghost-raven1/kanso/blob/main/docs/migration.md' });
    }
  }
  return { code, diagnostics, imports };
}

/** Stable recovery guidance is shared by text and JSON reports. */
function diagnosticHint(code: string): string {
  if (code.includes('SNAPSHOT')) return 'Capture the intended value before updating: const previous = count; setCount(n => n + 1). Review deferred reads explicitly.';
  if (code === 'EFFECT_TRACKING') return 'Choose dependencies explicitly: useEffect(() => subscribe(value), [value]).';
  if (code.includes('PURITY')) return 'For a pure helper use const value = useMemo(() => helper(input), [input]); move side effects to useEffect.';
  if (code.includes('HOOK')) return 'Call a statically imported local hook unconditionally during setup and use one terminal return.';
  if (code.includes('PATTERN') || code === 'KANSO_PROPS') return 'Use static destructuring keys, for example const { user: { name } } = props.';
  return 'Use the supported Kanso API described in the migration guide, then repeat migrate --check before applying.';
}
