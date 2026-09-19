import { createComponent, createResource, createSignal, ErrorBoundary, onCleanup, Show, Suspense, useContext, type Component } from 'solid-js';
import { Router, useBeforeLeave, useLocation, type RouteDefinition, type RouteSectionProps } from '@solidjs/router';
import { Dynamic } from 'solid-js/web';
import { createRouteData, DataContext, RouteIdContext } from './data.js';
import type { Bootstrap, Route } from './types.js';
import { HeadContext, SeoProvider, SeoScopeContext, type HeadRegistry } from './seo/registry.js';
import { routeSeoLevels } from './seo/routes.js';
import type { SeoConfig } from './seo/types.js';
import { createMicrofrontendSession, remoteMountMatches, remoteMountPath, type MicrofrontendDefinition, type MicrofrontendSession } from './microfrontends.js';
import { isServer } from 'solid-js/web';
import { createServiceScope, ServiceProvider, type ServiceScope } from '@kanso/core';

export interface AppProps { routes: Route[]; url?: string; bootstrap?: Bootstrap; seo?: SeoConfig; services?: ServiceScope; microfrontends?: readonly MicrofrontendDefinition[]; microfrontendSession?: MicrofrontendSession; /** @internal */ head?: HeadRegistry }

const toRouterRoutes = (routes: Route[], cache: WeakMap<Route, RouteDefinition>): RouteDefinition[] => routes.map(route => {
  const cached = cache.get(route);
  if (cached) return cached;
  const definition: RouteDefinition = {
  path: route.remote ? route.path.replace(/\/$/, '') + '/*' : route.path,
  component: route.remoteMount ? undefined : (props: RouteSectionProps) => createComponent(RouteIdContext.Provider, {
    value: route.id,
    get children() {
      return createComponent(SeoScopeContext.Provider, { value: route.id, get children() { return createComponent(ErrorBoundary, {
        fallback: error => { if (isServer && error?.name === 'RemoteError') throw error; return route.error ? createComponent(route.error, { error }) : createComponent(Dynamic, { component: 'p', role: 'alert', children: 'Unable to load this route.' }); },
        get children() {
          return createComponent(Suspense, {
            get fallback() { return route.pending ? createComponent(route.pending, {}) : 'Loading…'; },
            get children() {
              const data = useContext(DataContext);
              return createComponent(Show, {
                keyed: true,
                get when() { return !data || Object.hasOwn(data.snapshot()?.data ?? {}, route.id); },
                children: (_ready: {}) => { return createComponent(route.component, { get children() { return props.children; } }); },
              });
            },
          });
        },
      }); } });
    },
  }),
  children: route.children && toRouterRoutes(route.children, cache),
  };
  cache.set(route, definition);
  return definition;
});

/** A single data context belongs to this app root (and therefore this SSR request). */
export function App(props: AppProps) {
  const services = props.services ?? createServiceScope({ snapshots: props.bootstrap?.services });
  if (!props.services) onCleanup(() => services.dispose());
  else if (!isServer && props.bootstrap?.services) services.restore(props.bootstrap.services);
  const session = props.microfrontendSession ?? createMicrofrontendSession(props.microfrontends, { pins: props.bootstrap?.remotes });
  if (session && !props.microfrontendSession) onCleanup(() => session.dispose());
  const [routes, setRoutes] = createSignal(session?.preparedRoutes ?? props.routes);
  let preparation = 0;
  const prepare = session ? async (url: string) => { const current = ++preparation; const next = await session.prepare(props.routes, url); if (current === preparation) setRoutes(previous => previous.length === next.length && previous.every((route, i) => route === next[i]) ? previous : next); } : undefined;
  onCleanup(() => { preparation++; });
  const routeCache = new WeakMap<Route, RouteDefinition>();
  const Root: Component<{ children?: import('solid-js').JSX.Element }> = root => {
    const location = useLocation();
    let intent = 0;
    onCleanup(() => { intent++; });
    if (session && !isServer) useBeforeLeave(event => {
      const current = ++intent;
      if (typeof event.to !== 'string') return;
      const target = new URL(event.to, window.location.href);
      const unresolved = (items: Route[], prefix = ''): boolean => items.some(route => {
        const mount = remoteMountPath(prefix, route.path);
        return route.remote ? remoteMountMatches(mount, target.pathname) : unresolved(route.children ?? [], mount);
      });
      if (target.origin !== window.location.origin || !unresolved(routes())) return;
      event.preventDefault();
      // Extend the route table before Solid starts its navigation transition.
      const resume = () => { if (current === intent) event.retry(true); };
      void prepare!(target.pathname + target.search).then(resume, resume);
    });
    const data = createRouteData(() => location.pathname + location.search, props.bootstrap, prepare, services);
    const Content = () => {
      const head = useContext(HeadContext);
      if (head) head.setSource(() => routeSeoLevels(routes(), data.snapshot(), location.pathname + location.search, head.config));
      return createComponent(DataContext.Provider, { value: data, get children() { return root.children; } });
    };
    return props.seo ? createComponent(SeoProvider, { config: props.seo, registry: props.head, get children() { return createComponent(Content, {}); } }) : createComponent(Content, {});
  };
  const render = () => createComponent(Router, { url: props.url, root: Root, get children() { return toRouterRoutes(routes(), routeCache); } });
  const scoped = () => createComponent(ServiceProvider, { scope: services, get children() { return render(); } });
  if (!session) return scoped();
  const initialUrl = props.url ?? props.bootstrap?.url ?? (isServer ? '/' : window.location.pathname + window.location.search);
  const prepared = !!session.preparedRoutes;
  const [ready] = createResource(async () => { if (!prepared) await prepare?.(initialUrl); return true; }, { initialValue: prepared ? true : undefined, ssrLoadFrom: prepared ? 'initial' : 'server' });
  return session.wrap(() => createComponent(Show, { keyed: true, get when() { return ready(); }, children: (_ready: {}) => scoped() }));
}
