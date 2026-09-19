import { createContext, createResource, createSignal, onCleanup, useContext, type Accessor } from 'solid-js';
import { isServer } from 'solid-js/web';
import type { Bootstrap } from './types.js';

export interface Revalidator {
  readonly pending: boolean;
  readonly error: Error | undefined;
  /** Failure is exposed through error; retry never repeats an action. */
  revalidate: () => Promise<void>;
}
export interface RouteData {
  snapshot: Accessor<Bootstrap | undefined>;
  url: Accessor<string>;
  revalidator: Revalidator;
  reload: () => Promise<void>;
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

/** Navigation owns suspense; revalidation keeps the last successful page available. */
export function createRouteData(url: Accessor<string>, initial?: Bootstrap): RouteData {
  const navigation = createNavigationLoader();
  const refresh = createNavigationLoader();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<Error>();
  let generation = 0;
  let disposed = false;
  let first = true;
  let activeNavigation: Promise<Bootstrap> | undefined;
  const [snapshot, { mutate }] = createResource(
    () => {
      const value = url();
      generation++;
      refresh.cancel();
      setPending(false);
      setError(undefined);
      return value;
    },
    async value => {
      if (first) {
        first = false;
        if (initial?.url === value) return initial;
      }
      if (isServer) throw new Error('SSR loader data must be prepared before rendering.');
      activeNavigation = navigation.load(value);
      return activeNavigation;
    },
    { initialValue: initial, ssrLoadFrom: 'initial' },
  );
  onCleanup(() => { disposed = true; generation++; navigation.cancel(); refresh.cancel(); });
  const revalidator: Revalidator = {
    get pending() { return pending(); },
    get error() { return error(); },
    async revalidate() {
      if (isServer || disposed) return;
      const current = ++generation;
      const target = url();
      setPending(true);
      setError(undefined);
      try {
        await activeNavigation;
        if (disposed || current !== generation || target !== url()) return;
        const next = await refresh.load(target);
        if (!disposed && current === generation && target === url()) mutate(next);
      } catch (caught) {
        if (!disposed && current === generation) setError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        if (!disposed && current === generation) setPending(false);
      }
    },
  };
  return { snapshot, url, revalidator, reload: revalidator.revalidate };
}

export function useRevalidator(): Revalidator {
  const context = useContext(DataContext);
  if (!context) throw new Error('useRevalidator requires a Kanso route.');
  return context.revalidator;
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
