import { federation } from '@module-federation/vite';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Plugin, PluginOption, ResolvedConfig } from 'vite';
import ts from 'typescript';
import { remoteResources } from './remote-resources.js';

const runtime = { '@kanso/core': '0.9.0', '@kanso/app': '0.9.0', '@kanso/microfrontends': '0.9.0', 'solid-js': '1.9.15', '@solidjs/router': '0.16.3' };
const shares = ['solid-js', 'solid-js/web', 'solid-js/store', '@kanso/core', '@kanso/core/internal', '@kanso/core/client', '@kanso/core/hmr', '@kanso/app', '@kanso/app/integration', '@kanso/app/seo', '@kanso/app/solid-router', '@solidjs/router'];
export interface MicrofrontendBuildOptions {
  name: string;
  contract?: string;
  exposes?: Record<string, string>;
  routes?: string;
  server?: string;
  /** Explicit shared contract packages, with exact versions. */
  shared?: Record<string, string>;
}

function declarations(config: ResolvedConfig, options: MicrofrontendBuildOptions): Record<string, string> {
  const entries = { ...options.exposes, ...(options.routes ? { routes: options.routes } : {}) };
  const configFile = ts.findConfigFile(config.root, ts.sys.fileExists);
  const parsed = configFile ? ts.parseJsonConfigFileContent(ts.readConfigFile(configFile, ts.sys.readFile).config, ts.sys, path.dirname(configFile)) : undefined;
  const compilerOptions: ts.CompilerOptions = { ...parsed?.options, declaration: true, emitDeclarationOnly: true, noEmit: false, noEmitOnError: true, rootDir: config.root, outDir: path.join(config.root, '.kanso-types'), jsx: ts.JsxEmit.Preserve, jsxImportSource: '@kanso/core', module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, skipLibCheck: true };
  delete compilerOptions.declarationDir; delete compilerOptions.tsBuildInfoFile; compilerOptions.incremental = false;
  compilerOptions.paths = Object.fromEntries(Object.entries(compilerOptions.paths ?? {}).filter(([name]) => !name.startsWith('@kanso/')));
  const program = ts.createProgram(Object.values(entries).map(file => path.resolve(config.root, file)), compilerOptions);
  const files: Record<string, string> = {};
  const result = program.emit(undefined, (file, text) => {
    const relative = path.relative(compilerOptions.outDir!, file).replaceAll('\\', '/');
    if (relative.startsWith('../')) return;
    files[relative] = text;
  });
  if (result.emitSkipped) throw new Error(ts.formatDiagnosticsWithColorAndContext(ts.getPreEmitDiagnostics(program), { getCanonicalFileName: f => f, getCurrentDirectory: () => config.root, getNewLine: () => '\n' }));
  const specifier = (file: string) => './' + path.relative(config.root, path.resolve(config.root, file)).replaceAll('\\', '/').replace(/\.[^.]+$/, '');
  files['index.d.ts'] = `export interface Contract {\n  components: {\n${Object.entries(options.exposes ?? {}).map(([name, file]) => `    ${JSON.stringify(name)}: typeof import(${JSON.stringify(specifier(file))}).default;`).join('\n')}\n  };\n${options.routes ? `  routes: typeof import(${JSON.stringify(specifier(options.routes))}).routes;\n` : ''}}\n`;
  return files;
}

/** Official federation handles module loading; Kanso owns manifests and server/client boundaries. */
export function microfrontendPlugins(options: MicrofrontendBuildOptions, buildId?: string): PluginOption[] {
  if (!options.exposes && !options.routes) return [];
  if (!/^[a-zA-Z][\w-]*$/.test(options.name)) throw new Error('Invalid microfrontend name.');
  const id = buildId ?? process.env.KANSO_BUILD_ID ?? 'development';
  let config: ResolvedConfig;
  const publicExposes = { ...Object.fromEntries(Object.entries(options.exposes ?? {}).map(([name, file]) => ['./' + name, file])), ...(options.routes ? { './routes': options.routes } : {}) };
  const handlersId = 'virtual:kanso/remote-handlers';
  const shared = Object.fromEntries([...shares, ...Object.keys(options.shared ?? {})].map(name => [name, { singleton: true, import: false as const, requiredVersion: options.shared?.[name] ?? Object.entries(runtime).find(([prefix]) => name === prefix || name.startsWith(prefix + '/'))?.[1] }]));
  const plugins = federation({ name: `${options.name}_${id}`, filename: 'remoteEntry.js', exposes: { ...publicExposes, './handlers': handlersId }, shared, dts: false, manifest: false, ssrExternals: shares });
  const configure: Plugin = {
    name: 'kanso:microfrontends', enforce: 'pre',
    api: { ssrEntries: { ...options.exposes, ...(options.routes ? { routes: options.routes } : {}), ...(options.server ? { handlers: options.server } : {}) } },
    config(_user, env) {
      return { css: { modules: { generateScopedName: (name: string, filename: string, css: string) => `${options.name}_${name}_${createHash('sha256').update(path.relative(config.root, filename).replaceAll('\\', '/') + css).digest('hex').slice(0, 7)}` } }, build: { ...(env.isSsrBuild ? { emitAssets: true } : { rollupOptions: { input: options.routes ?? Object.values(options.exposes ?? {})[0] } }) } };
    },
    resolveId(id) { if (id === handlersId) return handlersId; },
    load(id, loadOptions) {
      if (id !== handlersId) return;
      return (loadOptions?.ssr || config.build.ssr) && options.server
        ? `export * from ${JSON.stringify(path.resolve(config.root, options.server))};`
        : 'export const handlers = {};';
    },
    configResolved(value) { config = value; },
    configureServer(server) {
      // Current and pinned local manifests refer to the same Vite module graph.
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (!pathname.endsWith('/kanso-remote.json') && !pathname.endsWith('/types.json')) return next();
        const origin = config.server.origin ?? `http://localhost:${config.server.port ?? 5173}`;
        const base = new URL(config.base, origin).href;
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Access-Control-Allow-Origin', '*');
        try {
          response.end(JSON.stringify(pathname.endsWith('/types.json')
            ? { schema: 1, files: declarations(config, options) }
            : { schema: 1, name: options.name, buildId: id, contract: options.contract ?? '1.0.0', runtime: { ...runtime, ...options.shared }, entry: new URL('remoteEntry.js', base).href, exports: [...Object.keys(options.exposes ?? {}), ...(options.routes ? ['routes'] : [])], routes: !!options.routes, styles: [], preloads: [], types: new URL('types.json', base).href }));
        } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: String(error) })); }
      });
    },
    generateBundle(_out, bundle) {
      const server = !!config.build.ssr;
      if (!server && id === 'development' && config.command === 'build') this.error('Set KANSO_BUILD_ID (or kanso buildId) for an immutable remote release.');
      const assetUrl = (file: string) => config.base + file;
      const manifest = { schema: 1, name: options.name, buildId: id, contract: options.contract ?? '1.0.0', runtime: { ...runtime, ...options.shared }, entry: assetUrl(server ? 'remoteEntry.ssr.js' : 'remoteEntry.js'), exports: [...Object.keys(options.exposes ?? {}), ...(options.routes ? ['routes'] : [])], routes: !!options.routes, styles: Object.values(bundle).filter(x => x.fileName.endsWith('.css')).map(x => assetUrl(x.fileName)), preloads: [], ...(server ? { server: true } : { types: assetUrl('types.json'), resources: remoteResources(bundle, config.root, { ...options.exposes, ...(options.routes ? { routes: options.routes } : {}) }, assetUrl) }) };
      this.emitFile({ type: 'asset', fileName: server ? 'kanso-server.json' : 'kanso-remote.json', source: JSON.stringify(manifest, null, 2) });
      if (!server) this.emitFile({ type: 'asset', fileName: 'types.json', source: JSON.stringify({ schema: 1, files: declarations(config, options) }) });
    },
  };
  return [configure, ...plugins];
}
