import { transformSync, type PluginObj } from '@babel/core';
import * as t from '@babel/types';
import solid from 'babel-preset-solid';
import { transformProps, transformLocalProps } from './props.js';
import { transformHooks, transformDerived } from './state.js';
import { transformLists, transformJsx } from './jsx.js';
import type { TransformContext } from './context.js';
import { transformControlFlow } from './control-flow.js';

/** Runs before Solid JSX lowering; no React runtime or compiler is involved. */
export function kansoBabelPlugin(): PluginObj {
  return { name: 'kanso', visitor: { Program(program) {
    const context: TransformContext = { program, imports: new Map(), helpers: new Map(), reactive: new Set(), props: new Set() };
    for (const statement of program.node.body) {
      if (!t.isImportDeclaration(statement) || !['@kanso/core', '@kanso/app'].includes(statement.source.value)) continue;
      for (const specifier of statement.specifiers) if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported)) context.imports.set(specifier.local.name, specifier.imported.name);
    }
    transformProps(context);
    program.scope.crawl();
    transformLists(context);
    program.scope.crawl();
    transformHooks(context);
    program.scope.crawl();
    program.traverse({ VariableDeclarator(path) {
      const { id, init } = path.node;
      if (!t.isCallExpression(init) || !t.isIdentifier(init.callee)) return;
      const name = context.imports.get(init.callee.name);
      if (name === 'createStore' && t.isArrayPattern(id) && t.isIdentifier(id.elements[0])) context.props.add(id.elements[0].name);
      if (['useLoaderData', 'useForm', 'useContext'].includes(name ?? '')) {
        if (t.isIdentifier(id)) context.props.add(id.name);
        else if (t.isObjectPattern(id) && path.parentPath.isVariableDeclaration()) {
          const object = path.scope.generateUidIdentifier('data');
          context.props.add(object.name);
          path.parentPath.insertBefore(t.variableDeclaration('const', [t.variableDeclarator(object, init)]));
          path.node.init = object;
        }
      }
    } });
    transformLocalProps(context);
    program.scope.crawl();
    transformDerived(context);
    transformControlFlow(program);
    transformJsx(context);
    if (context.helpers.size) program.unshiftContainer('body', t.importDeclaration(
      [...context.helpers].map(([name, id]) => t.importSpecifier(id, t.identifier(name))), t.stringLiteral('@kanso/core/internal'),
    ));
  } } };
}

export interface CompileOptions { filename?: string; generate?: 'dom' | 'ssr'; sourceMaps?: boolean }

/** Compile TSX to standalone ESM with mapped diagnostics and hydration markers. */
export function compile(source: string, options: CompileOptions = {}): { code: string; map: unknown } {
  const filename = options.filename ?? 'component.tsx';
  const first = transformSync(source, {
    filename, configFile: false, babelrc: false, sourceMaps: options.sourceMaps ?? true,
    plugins: [kansoBabelPlugin], presets: [['@babel/preset-typescript', { allExtensions: true, isTSX: true }]],
  });
  if (!first?.code) throw new Error('Kanso compiler produced no output.');
  const result = transformSync(first.code, {
    filename, configFile: false, babelrc: false, sourceMaps: options.sourceMaps ?? true,
    inputSourceMap: first.map ?? undefined,
    presets: [[solid, { generate: options.generate ?? 'dom', hydratable: true }]],
  });
  return { code: result?.code ?? '', map: result?.map };
}
