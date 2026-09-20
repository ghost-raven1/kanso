import type { Component, JSX } from 'solid-js';
import type { ServiceScope, ServiceSnapshots } from '@kanso/core';
import type { TypedRouteHandlers } from './routes.js';
import type { MicrofrontendDefinition, MicrofrontendSession, RemotePins, RemoteSource } from './microfrontends.js';
import type { SeoConfig, SeoMetadata, SeoResolver, SeoSnapshot, SitemapEntry, SitemapOptions, RobotsOptions } from './seo/types.js';

export interface Route {
  id: string;
  path: string;
  component: Component<{ children?: JSX.Element }>;
  children?: Route[];
  /** @internal A lazily resolved route group supplied by @kanso/microfrontends. */
  remote?: { name: string; path: string };
  /** @internal Transparent mount point; its children own route lifecycles. */
  remoteMount?: boolean;
  seo?: SeoMetadata | SeoResolver;
  sitemap?: boolean | Omit<SitemapEntry, 'url'>;
  pending?: Component;
  error?: Component<{ error: Error }>;
  cache?: { public: true; ttlMs: number; vary?: string[] };
}
export interface LoaderArgs<C = unknown> {
  request: Request; params: Record<string, string>; context: C; signal: AbortSignal; services: ServiceScope;
}
export type FormValues = Record<string, string | string[]>;
export interface ActionResult<T = unknown, V extends FormValues = FormValues> {
  data?: T;
  errors?: Record<string, string>;
  /** Only explicitly returned fields are reflected into HTML and hydration data. */
  values?: V;
  formError?: string;
}
export interface RouteHandlers<C = unknown> {
  loader?: (args: LoaderArgs<C>) => unknown | Promise<unknown>;
  action?: (args: LoaderArgs<C>) => ActionResult | Response | Promise<ActionResult | Response>;
}
export interface Bootstrap {
  version: 1; buildId: string; url: string; data: Record<string, unknown>; seo?: SeoSnapshot;
  action?: { routeId: string; formId: string; result: ActionResult };
  remotes?: RemotePins;
  services?: ServiceSnapshots;
}
export interface RequestHandlerOptions<C = unknown, R extends Route[] = Route[]> {
  routes: R;
  microfrontends?: readonly MicrofrontendDefinition[];
  remoteSources?: Record<string, RemoteSource>;
  /** @internal Prepared for this request, never shared between users. */
  microfrontendSession?: MicrofrontendSession;
  handlers?: TypedRouteHandlers<R, C> | Record<string, RouteHandlers<C>>;
  context?: (request: Request) => C | Promise<C>;
  buildId: string;
  assets: { entry: string; styles?: string[]; preloads?: string[] };
  seo?: SeoConfig;
  robots?: RobotsOptions;
  sitemap?: SitemapOptions;
  timeoutMs?: number;
  /** Maximum buffered POST body, in bytes. Defaults to 1 MiB; increase explicitly for uploads. */
  maxBodyBytes?: number;
  maxCacheEntries?: number;
}
