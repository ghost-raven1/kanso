import { transformSync, type PluginObj } from '@babel/core';
import * as t from '@babel/types';
import solid from 'babel-preset-solid';
import { transformForwardRefs } from './forward-ref.js';
import { transformProps, transformLocalProps } from './props.js';
import { transformHooks, transformDerived } from './state.js';
import { transformJsx } from './jsx.js';
import { transformLists } from './lists.js';
import { importedName, type TransformContext } from './context.js';
import { prepareRefresh, finishRefresh } from './hmr.js';
import { transformControlFlow } from './control-flow.js';
import { transformHookParameters, transformCustomCalls, transformHookArguments, transformHookReturns } from './custom-hooks.js';

/** Runs before Solid JSX lowering; no React runtime or compiler is involved. */
export function kansoBabelPlugin(_api?: unknown, options: { hmr?: 'preserve' | 'remount' } = {}): PluginObj {
  return { name: 'kanso', visitor: { Program(program) {
    transformForwardRefs(program);
    const refresh = options.hmr ? prepareRefresh(program, options.hmr) : undefined;
    const context: TransformContext = { program, imports: new Map(), helpers: new Map(), reactive: new Set(), props: new Set(), rows: new Set() };
    for (const statement of program.node.body) {
      if (!t.isImportDeclaration(statement) || !['@kanso/core', '@kanso/app'].includes(statement.source.value)) continue;
      for (const specifier of statement.specifiers) if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported)) context.imports.set(specifier.local, specifier.imported.name);
    }
    transformHookParameters(context);
    program.scope.crawl();
    transformProps(context);
    program.scope.crawl();
    transformLists(context);
    program.scope.crawl();
    transformHooks(context);
    program.scope.crawl();
    transformCustomCalls(context);
    program.scope.crawl();
    program.traverse({ VariableDeclarator(path) {
      const { id, init } = path.node;
      if (!t.isCallExpression(init) || !t.isIdentifier(init.callee)) return;
      const name = importedName(context, path.scope, init.callee.name);
      if (name === 'createStore' && t.isArrayPattern(id) && t.isIdentifier(id.elements[0])) context.props.add(id.elements[0]);
      if (['useLoaderData', 'useForm', 'useParams', 'useLocation', 'useRevalidator'].includes(name ?? '')) {
        if (t.isIdentifier(id)) context.props.add(id);
        else if (t.isObjectPattern(id) && path.parentPath.isVariableDeclaration()) {
          const object = path.scope.generateUidIdentifier('data');
          context.props.add(object);
          path.parentPath.insertBefore(t.variableDeclaration('const', [t.variableDeclarator(object, init)]));
          path.node.init = object;
        }
      }
    } });
    program.scope.crawl();
    transformLocalProps(context);
    program.scope.crawl();
    transformDerived(context);
    transformHookArguments(context);
    transformHookReturns(context);
    transformControlFlow(program, context);
    transformJsx(context);
    if (context.helpers.size) program.unshiftContainer('body', t.importDeclaration(
      [...context.helpers].map(([name, id]) => t.importSpecifier(id, t.identifier(name))), t.stringLiteral('@kanso/core/internal'),
    ));
    if (refresh) finishRefresh(program, refresh);
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
