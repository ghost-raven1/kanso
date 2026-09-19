import { createComponent } from 'solid-js';
import { generateHydrationScript, renderToStringAsync, useAssets } from 'solid-js/web';
import { App } from './router.js';
import { matchRoute } from './routes.js';
import { serialize } from './serialization.js';
import { createRenderCache } from './cache.js';
import { createHeadRegistry } from './seo/registry.js';
import { routeSeoLevels } from './seo/routes.js';
import { renderHead } from './seo/resolve.js';
import type { SeoSnapshot } from './seo/types.js';
import { createSeoDiscovery } from './seo/sitemap.js';
import type { Bootstrap, RequestHandlerOptions, RouteHandlers } from './types.js';

export type { RequestHandlerOptions, LoaderArgs, RouteHandlers } from './types.js';
export { createRenderCache } from './cache.js';
export { serialize } from './serialization.js';
export type { RobotsOptions, SitemapOptions, SitemapEntry } from './seo/types.js';

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

function routeUrl(raw: string, origin: string): URL {
  const url = new URL(raw, origin);
  if (url.origin !== origin || !raw.startsWith('/') || raw.startsWith('//')) throw new Response('Invalid route URL', { status: 400 });
  return url;
}

/** Portable buffered SSR. All loader state is allocated inside one request. */
export function createRequestHandler<C = unknown>(options: RequestHandlerOptions<C>): (request: Request) => Promise<Response> {
  const cache = createRenderCache<Response>(options.maxCacheEntries);
  const timeoutMs = options.timeoutMs ?? 10000;
  const discovery = createSeoDiscovery(options);
  const dispatch = async (request: Request): Promise<Response> => {
    const incoming = new URL(request.url);
    const dataRequest = incoming.pathname === '/_kanso/data';
    const actionId = incoming.pathname.startsWith('/_kanso/action/') ? incoming.pathname.slice('/_kanso/action/'.length) : undefined;
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal]);
    const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
    let removeAbort = () => {};
    try {
      if (options.seo && (['/robots.txt', '/sitemap.xml'].includes(incoming.pathname) || incoming.pathname.startsWith('/_kanso/sitemap/'))) {
        const result = await Promise.race([discovery(request, signal), new Promise<never>((_resolve, reject) => {
          const fail = () => reject(signal.reason);
          if (signal.aborted) fail(); else signal.addEventListener('abort', fail, { once: true });
          removeAbort = () => signal.removeEventListener('abort', fail);
        })]);
        if (result) return result;
      }
      if (incoming.pathname === '/healthz') return Response.json({ ok: true, buildId: options.buildId }, { headers: { 'Cache-Control': 'no-store' } });
      if (actionId ? request.method !== 'POST' : !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: actionId ? 'POST' : 'GET, HEAD' } });
      const url = dataRequest ? routeUrl(incoming.searchParams.get('url') ?? '/', incoming.origin)
        : actionId ? routeUrl(request.headers.get('X-Kanso-Location') ?? '/', incoming.origin) : incoming;
      const match = matchRoute(options.routes, url.pathname);
      if (!match) return new Response(request.method === 'HEAD' ? null : 'Not found', { status: 404 });
      const run = async (): Promise<Response> => {
        const context = await options.context?.(request) as C;
        if (signal.aborted) throw signal.reason;
        if (actionId) {
          const origin = request.headers.get('Origin');
          if (origin && origin !== incoming.origin) return new Response('Cross-origin action rejected', { status: 403 });
          if (![...match.ancestors, match.route].some(route => route.id === actionId)) return new Response('Action is outside this route', { status: 400 });
          const action = options.handlers?.[actionId]?.action;
          if (!action) return new Response('Action not found', { status: 404 });
          const result = await action({ request, params: match.params, context, signal });
          if (result instanceof Response) { if (result.status < 400) cache.clear(); return result; }
          if (!result.errors) cache.clear();
          return Response.json(result, { status: result.errors ? 422 : 200, headers: { 'Cache-Control': 'no-store' } });
        }
        const routeRequest = new Request(url, { headers: request.headers, signal });
        const data = Object.fromEntries(await Promise.all([...match.ancestors, match.route].map(async route => {
          const handler: RouteHandlers<C> | undefined = options.handlers?.[route.id];
          const result = await handler?.loader?.({ request: routeRequest, params: match.params, context, signal }) ?? {};
          if (result instanceof Response) throw result;
          return [route.id, result];
        })));
        if (signal.aborted) throw signal.reason;
        const bootstrap: Bootstrap = { version: 1, buildId: options.buildId, url: url.pathname + url.search, data };
        const head = options.seo ? createHeadRegistry(options.seo, () => bootstrap.url) : undefined;
        if (head) { head.setSource(() => routeSeoLevels(options.routes, bootstrap, bootstrap.url, head.config)); bootstrap.seo = head.resolve(); }
        if (dataRequest) return Response.json(bootstrap, { headers: { 'Cache-Control': 'no-store' } });
        let snapshot: SeoSnapshot | undefined;
        const render = () => {
          // Solid runs asset collectors after buffered fragments settle, before owner disposal.
          if (head) useAssets(() => { snapshot = head.resolve(); return ''; });
          return createComponent(App, { routes: options.routes, url: bootstrap.url, bootstrap, seo: options.seo, head });
        };
        const html = await renderToStringAsync(render, { timeoutMs });
        if (snapshot) bootstrap.seo = snapshot;
        const headHtml = snapshot ? renderHead(snapshot) : '';
        const htmlAttrs = snapshot ? `${snapshot.lang ? ` lang="${escape(snapshot.lang)}"` : ''}${snapshot.dir ? ` dir="${escape(snapshot.dir)}"` : ''}` : ' lang="en"';
        const styles = (options.assets.styles ?? []).map(href => `<link rel="stylesheet" href="${escape(href)}">`).join('');
        const preloads = (options.assets.preloads ?? []).map(href => `<link rel="modulepreload" href="${escape(href)}">`).join('');
        const document = `<!doctype html><html${htmlAttrs}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${headHtml}${styles}${preloads}${generateHydrationScript()}<script id="kanso-data" type="application/json">${serialize(bootstrap)}</script></head><body><div id="root">${html}</div><script type="module" src="${escape(options.assets.entry)}"></script></body></html>`;
        return new Response(document, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Kanso-Build': options.buildId, ...(snapshot?.noindex ? { 'X-Robots-Tag': 'noindex' } : {}) } });
      };
      const policy = match.route.cache;
      const canCache = policy?.public && !dataRequest && !actionId && !request.headers.has('Cookie') && !request.headers.has('Authorization');
      const key = JSON.stringify([options.buildId, url.pathname + url.search, ...(policy?.vary ?? []).map(header => request.headers.get(header))]);
      const abort = new Promise<never>((_resolve, reject) => {
        const fail = () => reject(signal.reason);
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
        removeAbort = () => signal.removeEventListener('abort', fail);
      });
      const response = await Promise.race([canCache ? cache.get(key, policy.ttlMs, run).then(value => value.clone()) : run(), abort]);
      if (actionId && response.status >= 300 && response.status < 400 && response.headers.has('Location')) {
        const headers = new Headers(response.headers);
        headers.set('X-Kanso-Redirect', headers.get('Location')!); headers.delete('Location'); headers.set('Cache-Control', 'no-store');
        return new Response(null, { status: 200, headers });
      }
      return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
    } catch (error) {
      if (error instanceof Response) {
        if ((dataRequest || actionId) && error.headers.has('Location')) {
          if (actionId) cache.clear();
          const headers = new Headers(error.headers);
          headers.set('X-Kanso-Redirect', headers.get('Location')!); headers.delete('Location'); headers.set('Cache-Control', 'no-store');
          return new Response(null, { headers });
        }
        return request.method === 'HEAD' ? new Response(null, { status: error.status, headers: error.headers }) : error;
      }
      return new Response(request.method === 'HEAD' ? null : signal.aborted ? 'Request timed out or cancelled' : error instanceof URIError ? 'Invalid URL' : 'Server rendering failed', {
        status: signal.aborted ? 504 : error instanceof URIError ? 400 : 500, headers: { 'Cache-Control': 'no-store' },
      });
    } finally { clearTimeout(timer); removeAbort(); }
  };
  return async request => {
    const response = await dispatch(request);
    if (options.seo?.indexable !== false) return response;
    const headers = new Headers(response.headers); headers.set('X-Robots-Tag', 'noindex');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}
