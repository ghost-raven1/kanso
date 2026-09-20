import type { Route, LoaderArgs, ActionResult } from './types.js';
import { useContext } from 'solid-js';
import { useParams } from '@solidjs/router';
import { RouteScopeContext } from './microfrontends.js';

type Entries<R extends Route[], Prefix extends string = ''> = R[number] extends infer Item
  ? Item extends Route
    ? { id: Item['id']; path: `${Prefix}/${Item['path']}` } |
      (Item extends { children: infer Children extends Route[] } ? Entries<Children, `${Prefix}/${Item['path']}`> : never)
    : never
  : never;
export type RouteId<R extends Route[]> = Entries<R>['id'];
type SegmentParam<S extends string> = S extends `:${infer P}` ? P : S extends `*${infer P}` ? P extends '' ? 'rest' : P : never;
type PathParams<P extends string> = P extends `${infer Head}/${infer Tail}` ? SegmentParam<Head> | PathParams<Tail> : SegmentParam<P>;
/** Params include every ancestor segment of the selected route. */
export type RouteParams<R extends Route[], Id extends RouteId<R>> = string extends Id ? Record<string, string>
  : [PathParams<Extract<Entries<R>, { id: Id }>['path']>] extends [never] ? Record<string, never>
  : { [P in PathParams<Extract<Entries<R>, { id: Id }>['path']>]: string };
export type LoaderData<F extends (...args: never[]) => unknown> = Exclude<Awaited<ReturnType<F>>, Response>;
type ResultData<T> = T extends { data?: infer D } ? D : never;
export type ActionData<F extends (...args: never[]) => unknown> = ResultData<Exclude<Awaited<ReturnType<F>>, Response>>;
export type TypedRouteHandlers<R extends Route[], C = unknown> = {
  [Id in RouteId<R>]?: {
    loader?: (args: Omit<LoaderArgs<C>, 'params'> & { params: RouteParams<R, Id> }) => unknown;
    action?: (args: Omit<LoaderArgs<C>, 'params'> & { params: RouteParams<R, Id> }) => ActionResult | Response | Promise<ActionResult | Response>;
  }
};

/** Validate a stable route identity used by both loader transport and hydration. */
export function defineRoutes<const T extends Route[]>(routes: T): T {
  const ids = new Set<string>();
  const visit = (items: Route[]) => items.forEach(route => {
    if (!/^[a-zA-Z0-9_-]+$/.test(route.id) || ids.has(route.id)) throw new Error(`Invalid or duplicate route id: ${route.id}`);
    ids.add(route.id);
    const segments = route.path.split('/').filter(Boolean);
    if (segments.some((part, index) => part.includes('?') || part.startsWith('*') && index !== segments.length - 1)) throw new Error(`Unsupported route pattern: ${route.path}`);
    if (route.cache && !(route.cache.ttlMs > 0)) throw new Error(`Route ${route.id} needs a positive cache TTL.`);
    visit(route.children ?? []);
  });
  visit(routes);
  return routes;
}

/** Build a link from a route identity without changing case, query order or values. */
export function routeUrl<R extends Route[], const Id extends RouteId<NoInfer<R>>>(routes: R, id: Id, params: RouteParams<NoInfer<R>, NoInfer<Id>>, query?: URLSearchParams): string {
  const find = (items: Route[], prefix: string[]): string[] | undefined => {
    for (const route of items) {
      const parts = [...prefix, ...route.path.split('/').filter(Boolean)];
      if (route.id === id) return parts;
      const child = find(route.children ?? [], parts);
      if (child) return child;
    }
  };
  const parts = find(routes, []);
  if (!parts) throw new Error(`Unknown route: ${id}`);
  const path = '/' + parts.map(part => {
    if (!part.startsWith(':') && !part.startsWith('*')) return part;
    const key = part.slice(1) || 'rest';
    const value = (params as Record<string, string>)[key];
    if (value === undefined) throw new Error(`Route ${id} requires parameter ${key}.`);
    return part.startsWith('*') ? value.split('/').map(encodeURIComponent).join('/') : encodeURIComponent(value);
  }).join('/');
  const search = query?.toString();
  return path + (search ? `?${search}` : '');
}

/** Route-aware links retain their types when a section is mounted under a host prefix. */
export function useRouteUrl<R extends Route[]>(routes: R) {
  const scope = useContext(RouteScopeContext);
  const inherited = scope ? useParams() : undefined;
  return <const Id extends RouteId<R>>(id: Id, params: RouteParams<R, Id>, query?: URLSearchParams): string => {
    const path = routeUrl(routes, id, params, query);
    const prefix = scope?.prefix.replace(/:([^/]+)/g, (_segment, name: string) => encodeURIComponent(inherited?.[name] ?? ''));
    return prefix ? prefix.replace(/\/$/, '') + path : path;
  };
}

export interface RouteMatch { route: Route; ancestors: Route[]; params: Record<string, string> }

/** Prepare only the active page/layout code before hydrating existing server DOM. No data loaders run. */
export async function preloadRoute(routes: Route[], url: string): Promise<void> {
  const match = matchRoute(routes, new URL(url, 'http://kanso.local').pathname);
  if (!match) return;
  await Promise.all([...match.ancestors, match.route].map(route => {
    const component = route.component as Route['component'] & { preload?: () => Promise<unknown> };
    return component.preload?.();
  }));
}

/** Resolve the same named segments, nested paths and terminal splats as the router. */
export function matchRoute(routes: Route[], pathname: string): RouteMatch | undefined {
  const candidates: { route: Route; ancestors: Route[]; segments: string[]; score: number }[] = [];
  const visit = (items: Route[], ancestors: Route[], prefix: string[]) => items.forEach(route => {
    const segments = [...prefix, ...route.path.split('/').filter(Boolean)];
    candidates.push({ route, ancestors, segments, score: segments.reduce((sum, part) => sum + (part.startsWith('*') ? 0 : part.startsWith(':') ? 2 : 3), 0) });
    visit(route.children ?? [], [...ancestors, route], segments);
  });
  visit(routes, [], []);
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  for (const candidate of candidates.sort((a, b) => b.score - a.score || b.ancestors.length - a.ancestors.length)) {
    const params: Record<string, string> = {};
    let cursor = 0;
    let valid = true;
    for (const segment of candidate.segments) {
      if (segment.startsWith('*')) { params[segment.slice(1) || 'rest'] = parts.slice(cursor).join('/'); cursor = parts.length; break; }
      if (parts[cursor] === undefined) { valid = false; break; }
      if (segment.startsWith(':')) params[segment.slice(1)] = parts[cursor];
      else if (segment.toLowerCase() !== parts[cursor].toLowerCase()) { valid = false; break; }
      cursor++;
    }
    if (valid && cursor === parts.length) return { route: candidate.route, ancestors: candidate.ancestors, params };
  }
  return undefined;
}
