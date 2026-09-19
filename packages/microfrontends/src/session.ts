import { createComponent, type Component } from 'solid-js';
import { isServer } from 'solid-js/web';
import { MicrofrontendContext, RouteScopeContext, remoteMountMatches, remoteMountPath, type MicrofrontendOptions, type MicrofrontendSession, type RemotePins } from '@kanso/app/integration';
import type { Route, RouteHandlers } from '@kanso/app';
import { loadModule } from '@kanso/microfrontends/transport';
import { RemoteError, releaseManifest, validateManifest, type RemoteManifest } from './manifest.js';
import { sharedModules } from './shared.js';

type Module = { default?: unknown; routes?: Route[]; handlers?: Record<string, RouteHandlers> };

/** A registry has request/application lifetime. Loaded JavaScript has release lifetime. */
export function createSession(options: MicrofrontendOptions): MicrofrontendSession {
  const definitions = new Map(options.definitions.map(remote => [remote.name, remote]));
  if (definitions.size !== options.definitions.length) throw new RemoteError('MF_DUPLICATE_REMOTE', 'Remote names must be unique.');
  const pins: RemotePins = Object.create(null);
  const manifests = new Map<string, Promise<RemoteManifest>>();
  const modules = new Map<string, Promise<unknown>>();
  const loaded = new Map<string, unknown>();
  const styles = new Set<string>();
  const preloads = new Set<string>();
  const groups = new Map<string, Route>();
  const preparing = new Map<string, Promise<Route>>();
  const parents = new WeakMap<Route, Route>();
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const extras: Record<string, { version: string; module: object }> = Object.create(null);
  for (const definition of options.definitions) for (const [name, value] of Object.entries(definition.shared ?? {})) {
    const previous = extras[name];
    if (previous && (previous.version !== value.version || previous.module !== value.module)) throw new RemoteError('MF_SHARED_CONFLICT', `Provide one shared instance of ${name} for this application.`);
    extras[name] = value;
  }
  const shared = sharedModules(extras);
  const waitForModule = (work: Promise<unknown>): Promise<unknown> => new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new RemoteError('MF_TIMEOUT', 'Remote load timed out or was cancelled.', 504)); };
    const timer = setTimeout(abort, options.timeoutMs ?? 10000);
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    signal.addEventListener('abort', abort, { once: true });
    work.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
  const fetchJson = async (url: string, pinned = false): Promise<unknown> => {
    const timed = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? 10000)]);
    try {
      const response = await fetch(url, { signal: timed, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new RemoteError('MF_UNAVAILABLE', `Remote artifact unavailable: HTTP ${response.status}. Refresh or retry.`, pinned && response.status === 404 ? 409 : 503);
      return await response.json();
    } catch (error) { if (timed.aborted) throw new RemoteError('MF_TIMEOUT', 'Remote load timed out or was cancelled.', 504); throw error; }
  };
  const manifest = (name: string): Promise<RemoteManifest> => {
    let pending = manifests.get(name);
    if (pending) return pending;
    const definition = definitions.get(name);
    if (!definition) return Promise.reject(new RemoteError('MF_UNKNOWN_REMOTE', `Remote ${name} is not registered in this application.`));
    const url = pins[name] ? releaseManifest(definition.manifest, pins[name].buildId) : definition.manifest;
    pending = fetchJson(url, !!pins[name]).then(value => {
      const result = validateManifest(value, definition, url, pins[name]?.buildId);
      pins[name] ??= { buildId: result.buildId, manifest: releaseManifest(definition.manifest, result.buildId), modules: [] };
      result.styles.forEach(style => styles.add(style)); result.preloads.forEach(file => preloads.add(file));
      return result;
    }).catch(error => { manifests.delete(name); throw error; });
    manifests.set(name, pending); return pending;
  };
  const session: MicrofrontendSession = {
    handlers: {},
    pins: () => structuredClone(pins),
    adopt(next) {
      for (const [name, pin] of Object.entries(next ?? {})) {
        const definition = definitions.get(name);
        if (!definition || !pin || !Array.isArray(pin.modules) || !pin.modules.every(m => typeof m === 'string')) throw new RemoteError('MF_INVALID_PINS', 'Unknown or invalid remote release.', 400);
        if (pins[name] && pins[name].buildId !== pin.buildId) throw new RemoteError('MF_RELEASE_MISMATCH', `${name}: refresh the page to load a different release.`, 409);
        pins[name] = { buildId: pin.buildId, manifest: releaseManifest(definition.manifest, pin.buildId), modules: [...new Set([...(pins[name]?.modules ?? []), ...pin.modules])] };
      }
    },
    peek: (remote, name) => loaded.get(`${remote}/${name}`),
    async preload(remote) {
      const metadata = await manifest(remote);
      await Promise.all(metadata.exports.map(name => session.load(remote, name)));
    },
    async load(remote, name) {
      const key = `${remote}/${name}`;
      let pending = modules.get(key);
      if (!pending) {
        pending = (async () => {
          const publicManifest = await manifest(remote);
          if (!publicManifest.exports.includes(name) && !['routes', 'handlers'].includes(name)) throw new RemoteError('MF_UNKNOWN_EXPORT', `${remote} does not expose ${name}.`);
          let executable = publicManifest;
          let development: ((name: string) => Promise<unknown>) | undefined;
          if (isServer) {
            const source = options.sources?.[remote];
            if (!source) throw new RemoteError('MF_SERVER_SOURCE_REQUIRED', `Configure the private server source for ${remote}.`);
            if (source.development) {
              if (source.development.buildId !== publicManifest.buildId) throw new RemoteError('MF_RELEASE_MISMATCH', 'Local SSR source does not match the requested release.', 409);
              development = source.development.load;
            } else {
              if (!source.manifest) throw new RemoteError('MF_SERVER_SOURCE_REQUIRED', `Configure the private server source for ${remote}.`);
              const url = source.manifest.replaceAll('{buildId}', publicManifest.buildId);
              executable = validateManifest(await fetchJson(url, true), definitions.get(remote)!, url, publicManifest.buildId);
              if (!executable.server) throw new RemoteError('MF_SERVER_MANIFEST_REQUIRED', 'Expected a private server manifest.');
            }
          }
          signal.throwIfAborted();
          const value = await waitForModule(development ? development(name) : loadModule(executable, name, shared));
          if (signal.aborted) throw signal.reason;
          if (value == null) throw new RemoteError('MF_UNKNOWN_EXPORT', `${remote}/${name} returned no module.`);
          loaded.set(key, value);
          if (!pins[remote].modules.includes(name) && name !== 'handlers') pins[remote].modules.push(name);
          return value;
        })().catch(error => { modules.delete(key); throw error instanceof RemoteError ? error : new RemoteError('MF_LOAD_FAILED', `${remote}/${name}: ${error instanceof Error ? error.message : String(error)}`); });
        modules.set(key, pending);
      }
      return pending;
    },
    async prepare(routes, url, discovery = false) {
      const pathname = new URL(url, 'http://kanso.local').pathname;
      const visit = async (items: Route[], prefix = ''): Promise<Route[]> => Promise.all(items.map(async route => {
        const mounted = remoteMountPath(prefix, route.path);
        if (!route.remote) {
          if (!route.children) return route;
          const children = await visit(route.children, mounted);
          const previous = parents.get(route) ?? route;
          if (previous.children?.length === children.length && children.every((child, i) => child === previous.children![i])) return previous;
          const parent = { ...route, children }; parents.set(route, parent); return parent;
        }
        const { name, path } = route.remote;
        const existing = groups.get(`${name}:${mounted}`);
        if (existing) return existing;
        if (!discovery && !remoteMountMatches(mounted, pathname)) return route;
        const key = `${name}:${mounted}`;
        const pending = preparing.get(key);
        if (pending) return pending;
        const resolve = async (): Promise<Route> => {
        const exported = await session.load(name, 'routes') as Module;
        const children = exported.routes ?? exported.default;
        if (!Array.isArray(children)) throw new RemoteError('MF_INVALID_ROUTES', `${name} must export routes.`);
        const namespace = `${name}__`;
        const scoped = <P extends object>(component: Component<P>): Component<P> => props => createComponent(RouteScopeContext.Provider, { value: { prefix: mounted, namespace }, get children() { return createComponent(component, props); } });
        const bind = (items: Route[]): Route[] => items.map(child => ({ ...child, id: namespace + child.id, component: scoped(child.component), ...(child.error ? { error: scoped(child.error) } : {}), ...(child.pending ? { pending: scoped(child.pending) } : {}), ...(child.children ? { children: bind(child.children) } : {}) }));
        if (isServer) {
          const server = await session.load(name, 'handlers') as Module;
          for (const [id, handler] of Object.entries(server.handlers ?? server.default ?? {})) session.handlers[namespace + id] = handler as RouteHandlers;
        }
        const group = { ...route, path, remote: undefined, children: bind(children as Route[]) };
        groups.set(key, group);
        return group;
        };
        const resolution = resolve().finally(() => preparing.delete(key));
        preparing.set(key, resolution);
        return resolution;
      }));
      const result = await visit(routes);
      session.preparedRoutes = result;
      return result;
    },
    assets: () => ({ styles: [...styles], preloads: [...preloads] }),
    wrap: children => createComponent(MicrofrontendContext.Provider, { value: session, get children() { return children(); } }),
    dispose: () => controller.abort(),
  };
  session.adopt(options.pins);
  return session;
}
