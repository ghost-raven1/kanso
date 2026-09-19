export type ServiceWorkerStrategy = 'cache-first' | 'network-first' | 'stale-while-revalidate';

export interface ServiceWorkerRoute {
  /** Match public static resources. HTML, JSON, mutations and Kanso endpoints always bypass these routes. */
  match: (context: { request: Request; url: URL }) => boolean;
  strategy: ServiceWorkerStrategy;
  /** Cross-origin assets require an explicit origin and a readable CORS response. */
  origins?: readonly string[];
}

export interface ExtendableWorkerEvent { waitUntil(promise: Promise<unknown>): void }
export interface ServiceWorkerFetchEvent extends ExtendableWorkerEvent {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
}
export interface ServiceWorkerMessageEvent extends ExtendableWorkerEvent {
  data: unknown;
  source?: { postMessage(message: unknown): void } | null;
}
export interface ServiceWorkerEvents {
  install: ExtendableWorkerEvent;
  activate: ExtendableWorkerEvent;
  fetch: ServiceWorkerFetchEvent;
  message: ServiceWorkerMessageEvent;
}

/** Structural worker types avoid requiring the WebWorker lib in a DOM application. */
export interface ServiceWorkerScope {
  location: { href: string; origin: string };
  caches: CacheStorage;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  skipWaiting(): Promise<void>;
  addEventListener<K extends keyof ServiceWorkerEvents>(type: K, listener: (event: ServiceWorkerEvents[K]) => void): void;
  removeEventListener<K extends keyof ServiceWorkerEvents>(type: K, listener: (event: ServiceWorkerEvents[K]) => void): void;
}

export interface ServiceWorkerContext {
  readonly cacheName: string;
  readonly scope: ServiceWorkerScope;
}

export interface ServiceWorkerDefinition {
  /** A unique immutable release/build identifier. Caches from older releases are retained. */
  version: string;
  name?: string;
  precache?: readonly string[];
  routes?: readonly ServiceWorkerRoute[];
  /** Public, self-contained HTML used only when a navigation's network request fails. */
  offlineFallback?: string;
  onInstall?: (context: ServiceWorkerContext) => void | Promise<void>;
  onActivate?: (context: ServiceWorkerContext) => void | Promise<void>;
  onMessage?: (event: ServiceWorkerMessageEvent, context: ServiceWorkerContext) => void | Promise<void>;
}

const staticExtensions = /\.(?:[cm]?js|css|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|svg|ico|mp[34]|webm|ogg|wav|vtt|wasm)$/i;
const staticDestinations = new Set(['script', 'style', 'font', 'image', 'audio', 'video', 'track']);
const protectedPaths = /(?:^|\/)(?:_kanso|api|auth|login|logout|account)(?:\/|$)/i;
const isProtected = (request: Request, url: URL) => request.method !== 'GET' || request.headers.has('authorization') ||
  request.headers.has('range') || /(?:no-store|no-cache)/i.test(request.headers.get('cache-control') ?? '') ||
  request.cache === 'no-store' || url.username !== '' || url.password !== '' || protectedPaths.test(url.pathname);
const isStatic = (request: Request, url: URL) => request.mode !== 'navigate' && request.destination !== 'document' &&
  !/\.(?:html?|json)$/i.test(url.pathname) && (staticDestinations.has(request.destination) || staticExtensions.test(url.pathname));
const cacheable = (response: Response, allowHtml = false) => response.status === 200 && !response.redirected && response.type !== 'opaque' &&
  !/(?:^|,)\s*(?:private|no-store|no-cache)(?:\s|=|,|$)/i.test(response.headers.get('cache-control') ?? '') &&
  !response.headers.has('set-cookie') && !(response.headers.get('vary') ?? '').split(',').some(value => value.trim() === '*') &&
  (allowHtml || !/(?:text\/html|application\/(?:.*\+)?json)/i.test(response.headers.get('content-type') ?? ''));

/** Describe an opt-in static cache; defining a worker does not register listeners. */
export function defineServiceWorker<const T extends ServiceWorkerDefinition>(definition: T): T {
  if (!definition.version.trim()) throw new Error('KANSO_SERVICE_WORKER_VERSION: Supply a non-empty immutable build identifier.');
  return definition;
}

/** Install native worker listeners. Updates activate only after an explicit client request. */
export function installServiceWorker(
  definition: ServiceWorkerDefinition,
  scope: ServiceWorkerScope = globalThis as unknown as ServiceWorkerScope,
): () => void {
  defineServiceWorker(definition);
  if (!scope.caches || !scope.location || !scope.addEventListener || !scope.skipWaiting) throw new Error('installServiceWorker() must run in a service worker.');
  const base = new URL(scope.location.href);
  const context: ServiceWorkerContext = {
    cacheName: `kanso:${base.origin}${base.pathname}:${definition.name ?? 'static'}:${definition.version}`,
    scope,
  };
  const cache = () => scope.caches.open(context.cacheName);
  const absolute = (url: string) => new URL(url, base).href;
  const precacheUrls = new Set((definition.precache ?? []).map(absolute));
  const fallbackUrl = definition.offlineFallback ? absolute(definition.offlineFallback) : undefined;
  if (fallbackUrl && new URL(fallbackUrl).origin !== base.origin) throw new Error('The offline fallback must have the same origin as the service worker.');

  const store = async (request: Request, response: Response) => {
    if (!cacheable(response)) return;
    try { await (await cache()).put(request, response.clone()); }
    catch { /* A quota/cache failure must not turn a successful network request into an outage. */ }
  };
  const fromNetwork = async (request: Request) => {
    const response = await scope.fetch(request);
    await store(request, response);
    return response;
  };
  const fromCache = async (request: Request) => {
    try { return await (await cache()).match(request); }
    catch { return undefined; }
  };
  const respond = async (event: ServiceWorkerFetchEvent, strategy: ServiceWorkerStrategy) => {
    const cached = await fromCache(event.request);
    if (strategy === 'cache-first' && cached) return cached;
    if (strategy === 'stale-while-revalidate' && cached) {
      event.waitUntil(fromNetwork(event.request).catch(() => undefined));
      return cached;
    }
    try {
      const response = await fromNetwork(event.request);
      return strategy === 'network-first' && response.status >= 500 && cached ? cached : response;
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  };
  const install = (event: ExtendableWorkerEvent) => {
    event.waitUntil((async () => {
      const entries = new Set(precacheUrls);
      if (fallbackUrl) entries.add(fallbackUrl);
      await Promise.all([...entries].map(async entry => {
        const url = new URL(entry);
        const request = new Request(url, { credentials: 'omit', cache: 'reload' });
        const fallback = entry === fallbackUrl;
        if (isProtected(request, url) || url.origin !== base.origin || !fallback && !isStatic(request, url)) {
          throw new Error(`KANSO_SERVICE_WORKER_PRECACHE: Only same-origin public static resources may be precached: ${url.pathname}`);
        }
        const response = await scope.fetch(request);
        if (!cacheable(response, fallback)) throw new Error(`KANSO_SERVICE_WORKER_PRECACHE: Refusing to cache ${url.pathname} (${response.status}).`);
        await (await cache()).put(request, response);
      }));
      await definition.onInstall?.(context);
    })());
  };
  const activate = (event: ExtendableWorkerEvent) => {
    // No claim(), automatic cache deletion or skipWaiting(): an open document keeps its release.
    if (definition.onActivate) event.waitUntil(Promise.resolve().then(() => definition.onActivate!(context)));
  };
  const fetch = (event: ServiceWorkerFetchEvent) => {
    const request = event.request;
    const url = new URL(request.url);
    if (isProtected(request, url) || ['reload', 'no-cache'].includes(request.cache) || !/^https?:$/.test(url.protocol)) return;
    if (request.mode === 'navigate') {
      if (!fallbackUrl || url.origin !== base.origin) return;
      event.respondWith(scope.fetch(request).catch(async error => {
        const fallback = await fromCache(new Request(fallbackUrl));
        if (fallback) return fallback;
        throw error;
      }));
      return;
    }
    if (!isStatic(request, url)) return;
    if (precacheUrls.has(url.href)) {
      event.respondWith(respond(event, 'cache-first'));
      return;
    }
    const route = definition.routes?.find(route =>
      (url.origin === base.origin || route.origins?.includes(url.origin)) && route.match({ request, url }));
    if (route) event.respondWith(respond(event, route.strategy));
  };
  const message = (event: ServiceWorkerMessageEvent) => {
    if (event.data && typeof event.data === 'object' && 'type' in event.data && event.data.type === 'kanso:activate-update') {
      event.waitUntil(scope.skipWaiting());
    } else if (definition.onMessage) {
      event.waitUntil(Promise.resolve().then(() => definition.onMessage!(event, context)));
    }
  };
  scope.addEventListener('install', install);
  scope.addEventListener('activate', activate);
  scope.addEventListener('fetch', fetch);
  scope.addEventListener('message', message);
  return () => {
    scope.removeEventListener('install', install);
    scope.removeEventListener('activate', activate);
    scope.removeEventListener('fetch', fetch);
    scope.removeEventListener('message', message);
  };
}
