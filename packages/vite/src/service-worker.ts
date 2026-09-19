import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { build, type Plugin, type ResolvedConfig } from 'vite';

export interface ServiceWorkerBuildOptions {
  entry: string;
  /** Stable path relative to Vite's base. Defaults to service-worker.js. */
  fileName?: string;
  /** Service workers are disabled during development unless explicitly enabled. */
  dev?: boolean;
}

const moduleId = 'virtual:kanso/service-worker';

/** Build a separate classic worker with no app HMR/runtime and no automatic registration. */
export function serviceWorkerPlugin(options: ServiceWorkerBuildOptions, buildId?: string): Plugin {
  const fileName = options.fileName ?? 'service-worker.js';
  if (!/^[\w.-]+(?:\/[\w.-]+)*\.js$/.test(fileName) || fileName.split('/').includes('..')) {
    throw new Error('KANSO_SERVICE_WORKER_PATH: fileName must be a relative .js path inside the output directory.');
  }
  let config: ResolvedConfig;
  const enabled = () => !config.build.ssr && (config.command === 'build' || options.dev === true);
  const workerUrl = () => `${config.base}${fileName}`;
  const compile = async (version: string) => {
    const output = await build({
      configFile: false,
      root: config.root,
      mode: config.mode,
      logLevel: 'silent',
      resolve: { alias: config.resolve.alias, conditions: ['worker', 'browser'] },
      define: { ...config.define, 'import.meta.env.KANSO_SERVICE_WORKER_BUILD_ID': JSON.stringify(version) },
      build: {
        write: false, emptyOutDir: false, target: 'es2022', minify: config.command === 'build',
        lib: { entry: resolve(config.root, options.entry), formats: ['iife'], name: 'KansoServiceWorker' },
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
    });
    if ('on' in output) throw new Error('Service worker build unexpectedly started a watcher.');
    const files = (Array.isArray(output) ? output : [output]).flatMap(result => result.output);
    const chunks = files.filter(file => file.type === 'chunk');
    if (chunks.length !== 1 || files.some(file => file.type === 'asset')) {
      throw new Error('KANSO_SERVICE_WORKER_BUILD: Use a self-contained TypeScript worker entry without CSS imports.');
    }
    return chunks[0]!.code;
  };
  return {
    name: 'kanso:service-worker',
    configResolved(value) { config = value; },
    resolveId(id) { if (id === moduleId) return `\0${moduleId}`; },
    load(id) {
      if (id === `\0${moduleId}`) return `export const serviceWorkerEnabled=${enabled()};export const serviceWorkerUrl=${enabled() ? JSON.stringify(workerUrl()) : 'undefined'};`;
    },
    configureServer(server) {
      if (!options.dev) return;
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== workerUrl()) return next();
        try {
          const source = await compile(buildId ?? process.env.KANSO_BUILD_ID ?? 'development');
          response.setHeader('Content-Type', 'text/javascript');
          response.setHeader('Cache-Control', 'no-store');
          response.end(source);
        } catch (error) {
          server.config.logger.error(error instanceof Error ? error.message : String(error));
          response.statusCode = 500;
          response.end('Service worker compilation failed.');
        }
      });
    },
    async generateBundle(_output, bundle) {
      if (!enabled()) return;
      const hash = createHash('sha256');
      for (const name of Object.keys(bundle).sort()) {
        const file = bundle[name]!;
        hash.update(name).update(file.type === 'chunk' ? file.code : file.source);
      }
      const source = await compile(buildId ?? process.env.KANSO_BUILD_ID ?? hash.digest('hex').slice(0, 16));
      if (bundle[fileName]) this.error(`KANSO_SERVICE_WORKER_PATH: ${fileName} collides with an existing build output.`);
      this.emitFile({ type: 'asset', fileName, source });
    },
  };
}
