import type { Component, JSX } from 'solid-js';
import type { SeoConfig, SeoMetadata, SeoResolver, SeoSnapshot, SitemapEntry, SitemapOptions, RobotsOptions } from './seo/types.js';

export interface Route {
  id: string;
  path: string;
  component: Component<{ children?: JSX.Element }>;
  children?: Route[];
  seo?: SeoMetadata | SeoResolver;
  sitemap?: boolean | Omit<SitemapEntry, 'url'>;
  pending?: Component;
  error?: Component<{ error: Error }>;
  cache?: { public: true; ttlMs: number; vary?: string[] };
}
export interface LoaderArgs<C = unknown> {
  request: Request; params: Record<string, string>; context: C; signal: AbortSignal;
}
export interface ActionResult<T = unknown> {
  data?: T; errors?: Record<string, string>;
}
export interface RouteHandlers<C = unknown> {
  loader?: (args: LoaderArgs<C>) => unknown | Promise<unknown>;
  action?: (args: LoaderArgs<C>) => ActionResult | Response | Promise<ActionResult | Response>;
}
export interface Bootstrap {
  version: 1; buildId: string; url: string; data: Record<string, unknown>; seo?: SeoSnapshot;
}
export interface RequestHandlerOptions<C = unknown> {
  routes: Route[];
  handlers?: Record<string, RouteHandlers<C>>;
  context?: (request: Request) => C | Promise<C>;
  buildId: string;
  assets: { entry: string; styles?: string[]; preloads?: string[] };
  seo?: SeoConfig;
  robots?: RobotsOptions;
  sitemap?: SitemapOptions;
  timeoutMs?: number;
  maxCacheEntries?: number;
}
