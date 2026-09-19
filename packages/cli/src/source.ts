import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generatorModule from '@babel/generator';
import * as t from '@babel/types';
import { compile } from '@kanso/compiler';
import type { Diagnostic } from './types.js';

const traverse = (traverseModule as unknown as { default: typeof traverseModule }).default ?? traverseModule;
const generate = (generatorModule as unknown as { default: typeof generatorModule }).default ?? generatorModule;
const supported = new Set(['useState', 'useReducer', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'createContext', 'useContext', 'lazy', 'Suspense', 'Fragment', 'ReactNode', 'FC', 'ComponentType', 'PropsWithChildren', 'Dispatch', 'SetStateAction']);

export function migrateSource(source: string, file: string, approvedHooks: ReadonlySet<string> = new Set()): { code: string; diagnostics: Diagnostic[]; imports: string[] } {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const diagnostics: Diagnostic[] = [];
  const imports: string[] = [];
  let changed = false;
  const hooks = new Map<string, string>();
  const reactHooks = new Set<string>();
  const roots = new Set<string>();
  const hydrateNames = new Set<string>();
  const stateNames = new Set<string>();
  const setters = new Set<string>();
  const customHooks = new Set(approvedHooks);
  const hookCandidates = new Set<string>();
  const customObjects = new Set<string>();
  const report = (node: t.Node, code: string, message: string, severity: 'error' | 'warning' = 'error') => {
    diagnostics.push({ file, line: node.loc?.start.line, code, message, severity });
  };
  traverse(ast, {
    ImportDeclaration(path) {
      const from = path.node.source.value;
      imports.push(from);
      for (const specifier of path.node.specifiers) {
        const name = t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.local.name;
        if (/^use[A-Z]/.test(name)) hookCandidates.add(specifier.local.name);
        if (['@kanso/core', '@kanso/app'].includes(from)) hooks.set(specifier.local.name, name);
      }
      if (from === 'react') {
        changed = true; path.node.source.value = '@kanso/core';
        for (const specifier of path.node.specifiers) {
          if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported)) {
            const name = specifier.imported.name;
            if (!supported.has(name)) report(specifier, 'UNSUPPORTED_API', `React.${name} has no automatic migration.`);
            hooks.set(specifier.local.name, name);
            reactHooks.add(specifier.local.name);
          } else if (t.isImportDefaultSpecifier(specifier) || t.isImportNamespaceSpecifier(specifier)) {
            const binding = path.scope.getBinding(specifier.local.name);
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
                hooks.set(local.name, name); reactHooks.add(local.name); member.replaceWith(local);
              } else if (!reference.findParent(parent => parent.isTSType())) report(reference.node, 'REACT_NAMESPACE', 'Dynamic React namespace access requires a manual port.');
            }
            // Keep type-qualified references such as React.FC valid.
            path.node.specifiers = path.node.specifiers.filter(item => item !== specifier);
            if (binding?.referencePaths.some(ref => ref.findParent(parent => parent.isTSType()))) {
              path.insertAfter(t.importDeclaration([t.importNamespaceSpecifier(specifier.local)], t.stringLiteral('@kanso/core')));
            }
          }
        }
      }
      if (from === 'react-dom/client') {
        changed = true; path.node.source.value = '@kanso/core/client';
        for (const specifier of path.node.specifiers) {
          if (!t.isImportSpecifier(specifier) || !t.isIdentifier(specifier.imported)) { report(specifier, 'ROOT_IMPORT', 'Use named createRoot/hydrateRoot imports.'); continue; }
          if (specifier.imported.name === 'createRoot') roots.add(specifier.local.name);
          else if (specifier.imported.name === 'hydrateRoot') hydrateNames.add(specifier.local.name);
          else report(specifier, 'ROOT_API', 'Unsupported React DOM API.');
        }
      } else if (from.startsWith('react-dom')) report(path.node, 'REACT_DOM', `${from} requires a manual port.`);
      if (from === '@vitejs/plugin-react' || from === '@vitejs/plugin-react-swc') {
        changed = true; path.node.source.value = '@kanso/vite';
        for (const specifier of path.node.specifiers) hooks.set(specifier.local.name, 'vitePlugin');
      }
    },
    ClassDeclaration(path) { if (path.node.superClass) report(path.node, 'CLASS_COMPONENT', 'Class inheritance requires review; component classes must become functions.'); },
    Function(path) {
      const name = (path.isFunctionDeclaration() || path.isFunctionExpression()) && path.node.id ? path.node.id.name
        : path.parentPath.isVariableDeclarator() && t.isIdentifier(path.parentPath.node.id) ? path.parentPath.node.id.name : '';
      if (/^use[A-Z]/.test(name)) customHooks.add(name);
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
  traverse(ast, {
    VariableDeclarator(path) {
      if (!t.isCallExpression(path.node.init) || !t.isIdentifier(path.node.init.callee)) return;
      const name = hooks.get(path.node.init.callee.name);
      if (customHooks.has(path.node.init.callee.name)) {
        const pattern = path.node.id;
        if (t.isIdentifier(pattern)) { customObjects.add(pattern.name); stateNames.add(pattern.name); setters.add(pattern.name); }
        const bindings = t.getBindingIdentifiers(pattern);
        for (const local of Object.keys(bindings)) { stateNames.add(local); setters.add(local); }
      }
      if (name === 'useState' || name === 'useReducer') {
        if (t.isArrayPattern(path.node.id)) {
          if (t.isIdentifier(path.node.id.elements[0])) stateNames.add(path.node.id.elements[0].name);
          if (t.isIdentifier(path.node.id.elements[1])) setters.add(path.node.id.elements[1].name);
        }
      }
      if (roots.has(path.node.init.callee.name) && t.isIdentifier(path.node.id)) roots.add(path.node.id.name);
    },
  });
  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (t.isIdentifier(callee)) {
        const name = hooks.get(callee.name);
        if (reactHooks.has(callee.name) && name === 'useEffect' && !path.node.arguments[1]) report(path.node, 'EFFECT_TRACKING', 'An effect without dependencies becomes auto-tracked. Add an explicit dependency array after review.');
        if (reactHooks.has(callee.name) && name === 'useCallback' && t.isArrayExpression(path.node.arguments[1]) && path.node.arguments[1].elements.length === 0) {
          const callback = path.get('arguments')[0];
          callback?.traverse({ ReferencedIdentifier(ref) {
            if (stateNames.has(ref.node.name)) report(ref.node, 'CALLBACK_SNAPSHOT', 'A callback with empty dependencies reads live state after migration; review its snapshot contract.');
          } });
        }
        if (name === 'vitePlugin' && path.node.arguments.length) report(path.node, 'VITE_OPTIONS', 'React plugin options need manual removal or conversion.');
        if ((/^use[A-Z]/.test(callee.name) || hookCandidates.has(callee.name)) && !name && !customHooks.has(callee.name)) report(path.node, 'CUSTOM_HOOK', `Cannot verify the compiled local contract of ${callee.name}.`);
        if (hydrateNames.has(callee.name)) {
          const [container, element] = path.node.arguments;
          if (t.isExpression(container) && t.isExpression(element)) path.node.arguments = [t.arrowFunctionExpression([], element), container];
        }
      }
      if (t.isMemberExpression(callee) && t.isIdentifier(callee.property, { name: 'render' })) {
        const root = t.isIdentifier(callee.object) && roots.has(callee.object.name)
          || t.isCallExpression(callee.object) && t.isIdentifier(callee.object.callee) && roots.has(callee.object.callee.name);
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
          if (t.isIdentifier(callee) && setters.has(callee.name) || t.isMemberExpression(callee) && t.isIdentifier(callee.object) && customObjects.has(callee.object.name)) writes++;
        } },
        ReferencedIdentifier(ref) { if (writes && stateNames.has(ref.node.name)) readsAfterWrite = true; },
      });
      if (writes > 1 || readsAfterWrite) report(path.node, 'STATE_SNAPSHOT', 'Multiple updates or reads after a setter require review: Kanso reads live state.');
      const delayed = path.node.async || path.parentPath.isCallExpression() && (
        t.isIdentifier(path.parentPath.node.callee) && ['setTimeout', 'setInterval', 'queueMicrotask'].includes(path.parentPath.node.callee.name)
        || t.isMemberExpression(path.parentPath.node.callee) && t.isIdentifier(path.parentPath.node.callee.property, { name: 'then' }));
      if (delayed) path.traverse({ ReferencedIdentifier(ref) {
        if (stateNames.has(ref.node.name)) report(ref.node, 'ASYNC_SNAPSHOT', 'Capture an explicit local snapshot if this callback must retain React render-time state.');
      } });
    },
  });
  const code = changed ? generate(ast, { retainLines: false }, source).code + '\n' : source;
  if (!diagnostics.some(item => item.severity === 'error') && !file.includes('vite.config')) {
    try { compile(code, { filename: file }); }
    catch (error) { diagnostics.push({ file, code: 'COMPILER', message: error instanceof Error ? error.message : String(error), severity: 'error' }); }
  }
  return { code, diagnostics, imports };
}
