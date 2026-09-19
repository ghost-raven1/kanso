import { createContext, createResource, createSignal, onCleanup, useContext, type Accessor } from 'solid-js';
import { isServer } from 'solid-js/web';
import type { Bootstrap } from './types.js';

export interface RouteData {
  snapshot: Accessor<Bootstrap | undefined>;
  reload: () => void;
}
export const DataContext = createContext<RouteData>();
export const RouteIdContext = createContext<string>();

/** Abort previous work and never publish a response from an obsolete navigation. */
export function createNavigationLoader(fetcher: typeof fetch = fetch) {
  let controller: AbortController | undefined;
  let sequence = 0;
  return {
    cancel() { sequence++; controller?.abort(); },
    async load(url: string): Promise<Bootstrap> {
      controller?.abort();
      controller = new AbortController();
      const current = ++sequence;
      const response = await fetcher(`/_kanso/data?url=${encodeURIComponent(url)}`, {
        signal: controller.signal, headers: { Accept: 'application/json' },
      });
      if (current !== sequence) throw new DOMException('Stale navigation', 'AbortError');
      const redirect = response.headers.get('X-Kanso-Redirect');
      if (redirect && !isServer) { window.location.assign(redirect); throw new Error('Redirecting'); }
      if (!response.ok) throw new Error(`Route data failed: HTTP ${response.status}`);
      const result = await response.json() as Bootstrap;
      if (current !== sequence) throw new DOMException('Stale navigation', 'AbortError');
      if (result.version !== 1 || result.url !== url || !result.data) throw new Error('Invalid route data snapshot.');
      return result;
    },
  };
}

export function createRouteData(url: Accessor<string>, initial?: Bootstrap): RouteData {
  const navigation = createNavigationLoader();
  const [revision, setRevision] = createSignal(0);
  onCleanup(() => navigation.cancel());
  const [snapshot] = createResource(
    () => ({ url: url(), revision: revision() }),
    async input => {
      if (initial && input.revision === 0 && input.url === initial.url) return initial;
      if (isServer) throw new Error('SSR loader data must be prepared before rendering.');
      return navigation.load(input.url);
    },
    { initialValue: initial, ssrLoadFrom: 'initial' },
  );
  return { snapshot, reload: () => { initial = undefined; setRevision(value => value + 1); } };
}

/** Reactive object view; keep the object or let the Kanso compiler lift property reads. */
export function useLoaderData<T extends object>(): T {
  const context = useContext(DataContext);
  const id = useContext(RouteIdContext);
  if (!context || !id) throw new Error('useLoaderData requires a Kanso route.');
  const read = () => (context.snapshot()?.data[id] ?? {}) as T;
  return new Proxy({} as T, {
    get: (_target, key) => Reflect.get(read(), key),
    has: (_target, key) => key in read(),
    ownKeys: () => Reflect.ownKeys(read()),
    getOwnPropertyDescriptor: (_target, key) => ({ configurable: true, enumerable: true, value: Reflect.get(read(), key) }),
    set: () => { throw new Error('Loader data is readonly.'); },
  });
}
