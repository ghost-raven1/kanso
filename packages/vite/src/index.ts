import solid from 'vite-plugin-solid';
import type { Plugin, PluginOption, ResolvedConfig } from 'vite';
import { kansoBabelPlugin } from '@kanso/compiler';
import { createHash } from 'node:crypto';

export interface KansoOptions { buildId?: string; routes?: Record<string, string> }
export interface AssetManifest {
  version: 1; buildId: string; base: string;
  entries: string[]; styles: string[]; routes: Record<string, { files: string[]; styles: string[] }>;
}

/** Compiler + Solid HMR + route assets; server modules cannot enter client graphs. */
export default function kanso(options: KansoOptions = {}): PluginOption[] {
  let config: ResolvedConfig;
  const framework: Plugin = {
    name: 'kanso:boundaries', enforce: 'pre',
    config: () => ({ resolve: { dedupe: ['solid-js', '@kanso/core', '@solidjs/router'] } }),
    configResolved(value) { config = value; },
    resolveId(source, _importer, resolveOptions) {
      if (!resolveOptions.ssr && ['@kanso/app/server', '@kanso/app/node'].includes(source)) this.error(`KANSO_SERVER_ONLY: ${source} cannot be imported by the client.`);
      return null;
    },
    transform(_source, id, transformOptions) {
      if (!transformOptions?.ssr && /\.server\.[cm]?[jt]sx?(?:\?|$)/.test(id)) {
        this.error(`KANSO_SERVER_ONLY: ${id} is reachable from the client. Import it only in the server entry.`);
      }
    },
    generateBundle(_options, bundle) {
      if (config.build.ssr) return;
      const hash = createHash('sha256');
      for (const chunk of Object.values(bundle)) hash.update(chunk.type === 'chunk' ? chunk.code : chunk.source);
      const assets: AssetManifest = { version: 1, buildId: options.buildId ?? process.env.KANSO_BUILD_ID ?? hash.digest('hex').slice(0, 16), base: config.base, entries: [], styles: [], routes: {} };
      const url = (file: string) => `${config.base}${file}`;
      const collect = (file: string, files = new Set<string>(), css = new Set<string>()) => {
        if (files.has(file)) return { files, css };
        files.add(file);
        const chunk = bundle[file];
        if (chunk?.type === 'chunk') {
          for (const style of chunk.viteMetadata?.importedCss ?? []) css.add(style);
          for (const child of chunk.imports) collect(child, files, css);
        }
        return { files, css };
      };
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        if (chunk.isEntry) assets.entries.push(url(chunk.fileName));
        const graph = collect(chunk.fileName);
        const styles = [...graph.css].map(url);
        if (chunk.isEntry) assets.styles.push(...styles);
        for (const [route, module] of Object.entries(options.routes ?? {})) {
          if (Object.keys(chunk.modules).some(id => id.replaceAll('\\', '/').endsWith(module))) {
            assets.routes[route] = { files: [...graph.files].map(url), styles };
          }
        }
      }
      assets.styles = [...new Set(assets.styles)];
      this.emitFile({ type: 'asset', fileName: 'kanso-manifest.json', source: JSON.stringify(assets, null, 2) });
    },
  };
  return [framework, solid({ ssr: true, extensions: [['.ts', { typescript: true }]], babel: { plugins: [kansoBabelPlugin] } })];
}
export { kanso };
