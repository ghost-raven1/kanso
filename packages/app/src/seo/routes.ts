import { matchRoute } from '../routes.js';
import type { Bootstrap, Route } from '../types.js';
import type { SeoLevel } from './registry.js';
import type { SeoConfig } from './types.js';

/** Resolve metadata from the accepted loader snapshot, never from an older navigation. */
export function routeSeoLevels(routes: Route[], snapshot: Bootstrap | undefined, url: string, config: SeoConfig): { url: string; levels: SeoLevel[] } | undefined {
  if (!snapshot || snapshot.url !== url) return undefined;
  const location = new URL(url, config.siteUrl);
  const match = matchRoute(routes, location.pathname);
  if (!match) return { url, levels: [] };
  return { url, levels: [...match.ancestors, match.route].map(route => {
    const metadata = typeof route.seo === 'function' ? route.seo({ data: snapshot.data[route.id], params: match.params, url: location }) : route.seo ?? {};
    if (metadata && typeof (metadata as unknown as { then?: unknown }).then === 'function') throw new Error(`KANSO_SEO_ASYNC: route ${route.id} must use its loader for asynchronous data.`);
    return { id: route.id, metadata };
  }) };
}
