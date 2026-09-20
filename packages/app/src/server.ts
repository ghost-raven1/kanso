import { FORM_BUILD, requiresReload } from './recovery.js';
import { matchRoute } from './routes.js';
import { createRenderCache } from './cache.js';
import { createHeadRegistry } from './seo/registry.js';
import { routeSeoLevels } from './seo/routes.js';
import { createSeoDiscovery } from './seo/sitemap.js';
import { renderPage } from './render.js';
import { FORM_ID, FORM_ROUTE } from './forms.js';
import type { Bootstrap, RequestHandlerOptions, Route, RouteHandlers } from './types.js';
import { createMicrofrontendSession, REMOTE_VERSIONS, remoteSnapshot, type MicrofrontendSession, type RemotePins } from './microfrontends.js';
import { defineRoutes } from './routes.js';
import { createServiceScope, type ServiceScope } from '@kanso/core';
import { actionOriginAllowed, readActionRequest } from './request-security.js';
import { safeRedirect } from './redirects.js';

export type { RequestHandlerOptions, LoaderArgs, RouteHandlers, ActionResult, FormValues } from './types.js';
export { defineRouteHandlers, redirect } from './handlers.js';
export { createRenderCache } from './cache.js';
export { serialize } from './serialization.js';
export type { RobotsOptions, SitemapOptions, SitemapEntry } from './seo/types.js';

function pageUrl(raw: string, origin: string): URL {
  const url = new URL(raw, origin);
  if (url.origin !== origin || !raw.startsWith('/') || raw.startsWith('//')) throw new Response('Invalid route URL', { status: 400 });
  return url;
}

function transportResponse(response: Response, enhanced: boolean, head: boolean): Response {
  const headers = new Headers(response.headers);
  try {
    for (const name of ['Location', 'X-Kanso-Redirect']) if (headers.has(name)) safeRedirect(headers.get(name)!);
  } catch {
    return new Response(head ? null : 'Invalid redirect URL', { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
  if (enhanced && response.status >= 300 && response.status < 400 && headers.has('Location')) {
    headers.set('X-Kanso-Redirect', headers.get('Location')!);
    headers.delete('Location');
    headers.set('Cache-Control', 'no-store');
    return new Response(null, { status: 200, headers });
  }
  return head ? new Response(null, { status: response.status, headers }) : response;
}

/** Portable buffered SSR. Loaders, native forms and enhanced forms share request state. */
export function createRequestHandler<C = unknown, const R extends Route[] = Route[]>(options: RequestHandlerOptions<C, R>): (request: Request) => Promise<Response> {
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 0) throw new Error('maxBodyBytes must be a non-negative safe integer.');
  // Matching the route at runtime supplies exactly the params declared by R.
  const handlers = options.handlers as Record<string, RouteHandlers<C>> | undefined;
  const cache = createRenderCache<Response>(options.maxCacheEntries);
  const discovery = createSeoDiscovery(options);
  const remoteDiscoveries = new Map<string, { handle: ReturnType<typeof createSeoDiscovery>; touched: number }>();
  const discoveryRetention = (options.sitemap?.ttlMs ?? 300000) * 2;
  const expireDiscoveries = () => {
    const now = Date.now();
    for (const [key, entry] of remoteDiscoveries) if (now - entry.touched > discoveryRetention) remoteDiscoveries.delete(key);
  };
  const dispatch = async (request: Request): Promise<Response> => {
    const incoming = new URL(request.url);
    const dataRequest = incoming.pathname === '/_kanso/data';
    const actionId = incoming.pathname.startsWith('/_kanso/action/') ? incoming.pathname.slice('/_kanso/action/'.length) : undefined;
    const post = request.method === 'POST';
    const enhanced = dataRequest || actionId !== undefined;
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal]);
    const timer = setTimeout(() => controller.abort(new Error('Request timed out')), options.timeoutMs ?? 10000);
    let removeAbort = () => {};
    let session: MicrofrontendSession | undefined;
    let services: ServiceScope | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      const fail = () => reject(signal.reason);
      if (signal.aborted) fail(); else signal.addEventListener('abort', fail, { once: true });
      removeAbort = () => signal.removeEventListener('abort', fail);
    });
    try {
      const run = async (): Promise<Response> => {
        if (post) {
          if (!actionOriginAllowed(request)) return new Response('Cross-origin action rejected', { status: 403 });
          request = await readActionRequest(request, maxBodyBytes, signal);
        }
        let clientBuild = request.headers.get('X-Kanso-Build');
        if (post && !clientBuild) {
          try { const value = (await request.clone().formData()).get(FORM_BUILD); if (typeof value === 'string') clientBuild = value; } catch { /* Existing form validation supplies the response. */ }
        }
        if ((enhanced || post) && clientBuild && clientBuild !== options.buildId)
          return new Response(request.method === 'HEAD' ? null : 'This page uses an unavailable release. Reload the page before submitting again.', {
            status: 409, headers: { 'Cache-Control': 'no-store', 'X-Kanso-Error': 'APP_BUILD_MISMATCH', 'X-Kanso-Recovery': 'reload' },
          });
        const url = dataRequest ? pageUrl(incoming.searchParams.get('url') ?? '/', incoming.origin)
          : actionId !== undefined ? pageUrl(request.headers.get('X-Kanso-Location') ?? '/', incoming.origin) : incoming;
        let requestOptions = options as RequestHandlerOptions<C>;
        // An indexed part belongs to its original generation, even after a remote release changes.
        if (options.microfrontends?.length && incoming.pathname.startsWith('/_kanso/sitemap/')) {
          expireDiscoveries();
          for (const entry of remoteDiscoveries.values()) {
            const result = await entry.handle(request, signal);
            if (result && result.status !== 404) return result;
          }
          return await discovery(request, signal) ?? new Response(null, { status: 404 });
        }
        if (options.microfrontends?.length) {
          let pins: RemotePins | undefined;
          let raw = request.headers.get('X-Kanso-Remotes');
          if (post && !raw) {
            try { const value = (await request.clone().formData()).get(REMOTE_VERSIONS); if (typeof value === 'string') raw = value; }
            catch { return new Response('Expected form data', { status: 400 }); }
          }
          if (raw) { try { pins = JSON.parse(raw); } catch { return new Response('Invalid remote versions', { status: 400 }); } }
          session = createMicrofrontendSession(options.microfrontends, { pins, sources: options.remoteSources, signal, timeoutMs: options.timeoutMs });
          const discoveryRequest = ['/robots.txt', '/sitemap.xml'].includes(url.pathname);
          const routes = defineRoutes(await session!.prepare(options.routes, url.pathname, discoveryRequest));
          requestOptions = { ...options, routes, microfrontendSession: session };
        }
        if (options.seo && (['/robots.txt', '/sitemap.xml'].includes(incoming.pathname) || incoming.pathname.startsWith('/_kanso/sitemap/'))) {
          let handle = discovery;
          let remembered: ReturnType<typeof remoteDiscoveries.get>;
          if (session) {
            expireDiscoveries();
            const key = JSON.stringify(Object.entries(session.pins()).map(([name, pin]) => [name, pin.buildId]).sort(([left], [right]) => left.localeCompare(right)));
            let entry = remoteDiscoveries.get(key);
            if (!entry) {
              entry = { handle: createSeoDiscovery({ routes: requestOptions.routes, seo: options.seo, sitemap: options.sitemap, robots: options.robots }), touched: Date.now() };
              remoteDiscoveries.set(key, entry);
            }
            entry.touched = Date.now();
            handle = entry.handle;
            remembered = entry;
          }
          const result = await handle(request, signal);
          if (remembered) remembered.touched = Date.now();
          if (result) return result;
        }
        if (incoming.pathname === '/healthz') return Response.json({ ok: true, buildId: options.buildId }, { headers: { 'Cache-Control': 'no-store' } });
        const allowed = actionId !== undefined ? ['POST'] : dataRequest ? ['GET', 'HEAD'] : ['GET', 'HEAD', 'POST'];
        if (!allowed.includes(request.method)) return new Response(null, { status: 405, headers: { Allow: allowed.join(', ') } });
        const match = matchRoute(requestOptions.routes, url.pathname);
        if (!match) return new Response('Not found', { status: 404 });
        const active = [...match.ancestors, match.route];
        const renderRequest = async (): Promise<Response> => {
          const context = await options.context?.(request) as C;
          if (signal.aborted) throw signal.reason;
          services = createServiceScope({ signal });
          let actionState: Bootstrap['action'];
          let status = 200;
          if (post) {
            let id = actionId;
            let formId: string | undefined;
            if (id === undefined) {
              let fields: FormData;
              try { fields = await request.clone().formData(); }
              catch { return new Response('Expected form data', { status: 400 }); }
              const ids = fields.getAll(FORM_ROUTE);
              const forms = fields.getAll(FORM_ID);
              if (ids.length !== 1 || forms.length !== 1 || typeof ids[0] !== 'string' || typeof forms[0] !== 'string' || !forms[0]) {
                return new Response('Missing or ambiguous form identity', { status: 400 });
              }
              id = ids[0]; formId = forms[0];
            }
            if (!active.some(route => route.id === id)) return new Response('Action is outside this route', { status: 400 });
            const action = (handlers?.[id] ?? session?.handlers[id])?.action;
            if (!action) return new Response('Action not found', { status: 404 });
            // Both transports expose the page URL, including its params and query.
            const actionRequest = new Request(url, { method: 'POST', headers: request.headers, body: request.body, signal, ...{ duplex: 'half' } });
            let result;
            try { result = await action({ request: actionRequest, params: match.params, context, signal, services }); }
            catch (error) { if (error instanceof Response && error.status < 400) cache.clear(); throw error; }
            if (signal.aborted) throw signal.reason;
            if (result instanceof Response) { if (result.status < 400) cache.clear(); return result; }
            status = result.errors || result.formError ? 422 : 200;
            if (status === 200) cache.clear();
            if (enhanced) return Response.json(result, { status, headers: { 'Cache-Control': 'no-store' } });
            actionState = { routeId: id, formId: formId!, result };
          }
          const routeRequest = new Request(url, { headers: request.headers, signal });
          const data = Object.fromEntries(await Promise.all(active.map(async route => {
            const result = await ((handlers?.[route.id] ?? session?.handlers[route.id]) as RouteHandlers<C> | undefined)?.loader?.({ request: routeRequest, params: match.params, context, signal, services: services! }) ?? {};
            if (result instanceof Response) throw result;
            return [route.id, result];
          })));
          if (signal.aborted) throw signal.reason;
          const bootstrap: Bootstrap = remoteSnapshot({ version: 1, buildId: options.buildId, url: url.pathname + url.search, data, ...(actionState ? { action: actionState } : {}) }, session);
          if (dataRequest) {
            const snapshots = services.snapshot();
            if (Object.keys(snapshots).length) bootstrap.services = snapshots;
            if (options.seo) {
              const head = createHeadRegistry(options.seo, () => bootstrap.url);
              head.setSource(() => routeSeoLevels(requestOptions.routes, bootstrap, bootstrap.url, head.config));
              bootstrap.seo = head.resolve();
            }
            return Response.json(bootstrap, { headers: { 'Cache-Control': 'no-store' } });
          }
          return renderPage(requestOptions, bootstrap, status, services);
        };
        // Dispose before a successful response can enter the shared HTML cache.
        const execute = async () => {
          try { return await renderRequest(); } finally { services?.dispose(); }
        };
        const policy = match.route.cache;
        // A widget can discover another release during rendering. Cache only after all registered identities are pinned.
        const allPinned = !session || options.microfrontends!.every(remote => session!.pins()[remote.name]);
        const canCache = allPinned && policy?.public && !post && !dataRequest && !request.headers.has('Cookie') && !request.headers.has('Authorization');
        const key = JSON.stringify([options.buildId, session?.pins(), url.origin, url.pathname + url.search, ...(policy?.vary ?? []).map(header => request.headers.get(header))]);
        return canCache ? (await cache.get(key, policy.ttlMs, execute)).clone() : execute();
      };
      return transportResponse(await Promise.race([run(), aborted]), enhanced, request.method === 'HEAD');
    } catch (error) {
      if (error instanceof Response) return transportResponse(error, enhanced, request.method === 'HEAD');
      if (error instanceof Error && error.name === 'RemoteError') return new Response(request.method === 'HEAD' ? null : error.message, { status: (error as Error & { status: number }).status, headers: { 'Cache-Control': 'no-store', 'X-Kanso-Error': (error as Error & { code: string }).code, ...(requiresReload(error) ? { 'X-Kanso-Recovery': 'reload' } : {}) } });
      return new Response(request.method === 'HEAD' ? null : signal.aborted ? 'Request timed out or cancelled' : error instanceof URIError ? 'Invalid URL' : 'Server rendering failed', {
        status: signal.aborted ? 504 : error instanceof URIError ? 400 : 500, headers: { 'Cache-Control': 'no-store' },
      });
    } finally { clearTimeout(timer); removeAbort(); try { session?.dispose(); } finally { services?.dispose(); } }
  };
  return async request => {
    const response = await dispatch(request).catch(() => new Response(request.method === 'HEAD' ? null : 'Request cleanup failed', {
      status: 500, headers: { 'Cache-Control': 'no-store' },
    }));
    if (options.seo?.indexable !== false && request.method !== 'POST') return response;
    const headers = new Headers(response.headers);
    if (request.method === 'POST') headers.set('Cache-Control', 'no-store');
    if (options.seo?.indexable === false) headers.set('X-Robots-Tag', 'noindex');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}
