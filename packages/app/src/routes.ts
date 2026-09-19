import type { Route } from './types.js';

/** Validate a stable route identity used by both loader transport and hydration. */
export function defineRoutes<T extends Route[]>(routes: T): T {
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

export interface RouteMatch { route: Route; ancestors: Route[]; params: Record<string, string> }

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
