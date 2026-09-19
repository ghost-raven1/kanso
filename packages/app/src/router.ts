import { createComponent, ErrorBoundary, Show, Suspense, useContext, type Component } from 'solid-js';
import { Router, useLocation, type RouteDefinition, type RouteSectionProps } from '@solidjs/router';
import { Dynamic } from 'solid-js/web';
import { createRouteData, DataContext, RouteIdContext } from './data.js';
import type { Bootstrap, Route } from './types.js';
import { HeadContext, SeoProvider, SeoScopeContext, type HeadRegistry } from './seo/registry.js';
import { routeSeoLevels } from './seo/routes.js';
import type { SeoConfig } from './seo/types.js';

export interface AppProps { routes: Route[]; url?: string; bootstrap?: Bootstrap; seo?: SeoConfig; /** @internal */ head?: HeadRegistry }

const toRouterRoutes = (routes: Route[]): RouteDefinition[] => routes.map(route => ({
  path: route.path,
  component: (props: RouteSectionProps) => createComponent(RouteIdContext.Provider, {
    value: route.id,
    get children() {
      return createComponent(SeoScopeContext.Provider, { value: route.id, get children() { return createComponent(ErrorBoundary, {
        fallback: error => route.error ? createComponent(route.error, { error }) : createComponent(Dynamic, { component: 'p', role: 'alert', children: 'Unable to load this route.' }),
        get children() {
          return createComponent(Suspense, {
            get fallback() { return route.pending ? createComponent(route.pending, {}) : 'Loading…'; },
            get children() {
              const data = useContext(DataContext);
              return createComponent(Show, {
                keyed: true,
                get when() { return !data || Object.hasOwn(data.snapshot()?.data ?? {}, route.id); },
                get children() { return createComponent(route.component, { get children() { return props.children; } }); },
              });
            },
          });
        },
      }); } });
    },
  }),
  children: route.children && toRouterRoutes(route.children),
}));

/** A single data context belongs to this app root (and therefore this SSR request). */
export function App(props: AppProps) {
  const Root: Component<{ children?: import('solid-js').JSX.Element }> = root => {
    const location = useLocation();
    const data = createRouteData(() => location.pathname + location.search, props.bootstrap);
    const Content = () => {
      const head = useContext(HeadContext);
      if (head) head.setSource(() => routeSeoLevels(props.routes, data.snapshot(), location.pathname + location.search, head.config));
      return createComponent(DataContext.Provider, { value: data, get children() { return root.children; } });
    };
    return props.seo ? createComponent(SeoProvider, { config: props.seo, registry: props.head, get children() { return createComponent(Content, {}); } }) : createComponent(Content, {});
  };
  return createComponent(Router, { url: props.url, root: Root, children: toRouterRoutes(props.routes) });
}
