import { createComponent, createResource, createSignal, ErrorBoundary, onCleanup, onMount, Show, Suspense, useContext, type Component, type JSX } from 'solid-js';
import { Dynamic, isServer } from 'solid-js/web';
import { MicrofrontendContext, type MicrofrontendDefinition, type MicrofrontendSession } from '@kanso/app/integration';
import type { Bootstrap, Route } from '@kanso/app';
import { createSession } from './session.js';
import { RemoteError } from './manifest.js';

export { RemoteError } from './manifest.js';
export type { RemoteManifest } from './manifest.js';
export interface RemoteContract { components: object; routes?: Route[] }
export interface RemoteOptions { name: string; manifest: string; contract: string; shared?: Record<string, { version: string; module: object }> }
export interface RemoteComponentOptions {
  ssr?: boolean;
  pending?: Component;
  error?: Component<{ error: Error; retry: () => void }>;
}
export interface Remote<C extends RemoteContract> extends MicrofrontendDefinition {
  component<K extends keyof C['components'] & string>(name: K, options?: RemoteComponentOptions): C['components'][K];
  routes<const P extends string>(options: { path: P }): Route & { path: P };
  preload(session?: MicrofrontendSession): Promise<void>;
}

/** Describe a remote once. Calling component() does not load code or allocate app state. */
export function defineRemote<C extends RemoteContract>(options: RemoteOptions): Remote<C> {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(options.name)) throw new Error('A remote needs a stable identifier.');
  const remote: Remote<C> = {
    ...options, createSession,
    component(name, settings = {}) {
      const RemoteComponent: Component<Record<string, unknown>> = props => {
        const session = useContext(MicrofrontendContext);
        if (!session) throw new Error('Remote components require App microfrontends or MicrofrontendProvider.');
        const View = () => {
          const [ready] = createResource(async () => { await session.load(options.name, name); return true; }, { initialValue: session.peek(options.name, name) ? true : undefined });
          return createComponent(Suspense, {
            get fallback() { return settings.pending ? createComponent(settings.pending, {}) : null; },
            get children() { return createComponent(Show, { keyed: true, get when() { return ready(); }, children: loaded => {
              const exported = session.peek(options.name, name) as Record<string, unknown>;
              const component = exported.default ?? exported[name];
              if (typeof component !== 'function') throw new RemoteError('MF_INVALID_COMPONENT', `${options.name}/${name} must export a component.`);
              return createComponent(component as Component<Record<string, unknown>>, props);
            } }); },
          });
        };
        // Server failures must propagate to HTTP status handling, not become a cached 200 page.
        const Boundary = () => createComponent(ErrorBoundary, { fallback: (error, reset) => {
          if (isServer) {
            if (error instanceof Error && error.name === 'RemoteError') session.renderError ??= error;
            throw error;
          }
          return settings.error ? createComponent(settings.error, { error, retry: reset }) : createComponent(Dynamic, { component: 'button', type: 'button', onClick: (error?.status === 409 || ['MF_RUNTIME_MISMATCH', 'MF_SHARED_MISMATCH'].includes(error?.code)) ? () => window.location.reload() : reset, children: (error?.status === 409 || ['MF_RUNTIME_MISMATCH', 'MF_SHARED_MISMATCH'].includes(error?.code)) ? 'This release is unavailable. Reload page' : 'Unable to load this section. Retry' });
        }, get children() { return createComponent(View, {}); } });
        if (settings.ssr !== false) return createComponent(Boundary, {});
        const [mounted, setMounted] = createSignal(false);
        onMount(() => setMounted(true));
        return createComponent(Show, { keyed: true, get when() { return mounted(); }, get fallback() { return settings.pending ? createComponent(settings.pending, {}) : null; }, get children() { return createComponent(Boundary, {}); } });
      };
      return RemoteComponent as C['components'][typeof name];
    },
    routes({ path }) {
      if (!path.startsWith('/') || /[:*?#]/.test(path)) throw new Error('A remote mount path must be an absolute static path.');
      return { id: options.name, path, remote: { name: options.name, path }, remoteMount: true, component: props => props.children };
    },
    async preload(provided) {
      const session = provided ?? useContext(MicrofrontendContext);
      if (!session) throw new Error('preload requires a microfrontend session.');
      await session.preload(options.name);
    },
  };
  return remote;
}

export interface MicrofrontendProviderProps { remotes: readonly MicrofrontendDefinition[]; session?: MicrofrontendSession; children?: JSX.Element }
export function MicrofrontendProvider(props: MicrofrontendProviderProps): JSX.Element {
  const session = props.session ?? createSession({ definitions: props.remotes });
  if (!props.session) onCleanup(() => session.dispose());
  return session.wrap(() => props.children);
}

/** Call before hydrateRoot; rejection leaves the existing server DOM untouched. */
export async function prepareMicrofrontends(remotes: readonly MicrofrontendDefinition[], bootstrap?: Bootstrap, routes?: Route[]): Promise<MicrofrontendSession> {
  const session = createSession({ definitions: remotes, pins: bootstrap?.remotes });
  try {
    await Promise.all(Object.entries(bootstrap?.remotes ?? {}).flatMap(([name, pin]) => pin.modules.map(module => session.load(name, module))));
    if (routes) await session.prepare(routes, bootstrap?.url ?? window.location.pathname);
    return session;
  } catch (error) { session.dispose(); throw error; }
}
