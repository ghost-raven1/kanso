import { describe, expect, it } from 'vitest';
import { createComponent } from 'solid-js';
import { createRequestHandler, createRenderCache, serialize } from '@kanso/app/server';
import { defineRoutes, useLoaderData, matchRoute, createNavigationLoader, preloadRoute } from '@kanso/app';
import { __effect } from '@kanso/core/internal';

function Page() { const data = useLoaderData<{ name: string }>(); return data.name; }

it('prepares only the active page/layout modules and propagates a missing chunk', async () => {
  const calls: string[] = [];
  const component = (id: string) => Object.assign(() => id, { preload: async () => { calls.push(id); if (id === 'broken') throw Error('Missing chunk'); } });
  const routes = defineRoutes([{ id: 'layout', path: '/', component: component('layout'), children: [
    { id: 'home', path: '/', component: component('home') },
    { id: 'other', path: '/other', component: component('other') },
    { id: 'broken', path: '/broken', component: component('broken') },
  ] }]);
  await preloadRoute(routes, '/other?q=value');
  expect(calls).toEqual(['layout', 'other']);
  await expect(preloadRoute(routes, '/broken')).rejects.toThrow('Missing chunk');
});
const routes = defineRoutes([{ id: 'home', path: '/', component: Page }]);
const config = { routes, buildId: 'test-build', assets: { entry: '/assets/client.js', styles: ['/assets/main.css'] } };

describe('request-scoped SSR', () => {
  it('isolates parallel requests and embeds reusable loader data', async () => {
    let loads = 0;
    const handler = createRequestHandler({ ...config, context: request => request.headers.get('X-User'), handlers: { home: { loader: async ({ context }) => {
      loads++; await new Promise(resolve => setTimeout(resolve, context === 'A' ? 10 : 1)); return { name: context };
    } } } });
    const responses = await Promise.all(['A', 'B'].map(name => handler(new Request('http://localhost/', { headers: { 'X-User': name } }))));
    const html = await Promise.all(responses.map(response => response.text()));
    expect(html[0]).toMatch(/-->A<!--/); expect(html[1]).toMatch(/-->B<!--/);
    expect(html[0]).toContain('kanso-data'); expect(html[0]).toContain('test-build'); expect(loads).toBe(2);
    expect(html[0]).not.toContain('react');
  });
  it('preserves HTTP redirects, errors, HEAD, and aborts slow loaders', async () => {
    const redirect = createRequestHandler({ ...config, handlers: { home: { loader: () => new Response(null, { status: 302, headers: { Location: '/next' } }) } } });
    expect((await redirect(new Request('http://localhost/'))).status).toBe(302);
    expect((await redirect(new Request('http://localhost/missing'))).status).toBe(404);
    const slow = createRequestHandler({ ...config, timeoutMs: 10, handlers: { home: { loader: () => new Promise(() => {}) } } });
    expect((await slow(new Request('http://localhost/'))).status).toBe(504);
    const normal = createRequestHandler({ ...config, handlers: { home: { loader: () => ({ name: 'head' }) } } });
    expect(await (await normal(new Request('http://localhost/', { method: 'HEAD' }))).text()).toBe('');
  });
  it('caches only explicit public pages and invalidates after actions', async () => {
    let reads = 0;
    const handler = createRequestHandler({ ...config, routes: [{ ...routes[0], cache: { public: true, ttlMs: 1000 } }], handlers: { home: {
      loader: () => ({ name: String(++reads) }), action: () => ({ data: 'saved' }),
    } } });
    await Promise.all([handler(new Request('http://localhost/')), handler(new Request('http://localhost/'))]);
    expect(reads).toBe(1);
    await handler(new Request('http://localhost/', { headers: { Cookie: 'session=private' } })); expect(reads).toBe(2);
    await handler(new Request('http://localhost/_kanso/action/home', { method: 'POST' }));
    await handler(new Request('http://localhost/')); expect(reads).toBe(3);
  });
  it('returns form validation errors and data envelopes without server source', async () => {
    const handler = createRequestHandler({ ...config, handlers: { home: { loader: () => ({ name: 'test' }), action: () => ({ errors: { name: 'Required' } }) } } });
    const result = await handler(new Request('http://localhost/_kanso/action/home', { method: 'POST' }));
    expect(result.status).toBe(422); expect(await result.json()).toEqual({ errors: { name: 'Required' } });
    const data = await (await handler(new Request('http://localhost/_kanso/data?url=%2F'))).json();
    expect(data.data.home.name).toBe('test');
    expect((await handler(new Request('http://localhost/_kanso/data?url=https://evil.test'))).status).toBe(400);
  });
});

it('escapes script endings and isolates cache generations', async () => {
  expect(serialize({ text: '</script><script>alert(1)</script>' })).not.toContain('<');
  const cache = createRenderCache<string>(1);
  let release!: (value: string) => void;
  const old = cache.get('key', 1000, () => new Promise(resolve => { release = resolve; }));
  cache.clear(); release('old'); await old;
  expect(await cache.get('key', 1000, async () => 'new')).toBe('new');
});

it('matches nested/static routes ahead of parameters', () => {
  const definitions = defineRoutes([{ id: 'users', path: '/users', component: Page, children: [
    { id: 'user', path: ':id', component: Page }, { id: 'new', path: 'new', component: Page },
  ] }]);
  expect(matchRoute(definitions, '/users/new')?.route.id).toBe('new');
  expect(matchRoute(definitions, '/users/42')?.params).toEqual({ id: '42' });
});

it('aborts older navigation and rejects late results even if transport ignores abort', async () => {
  const calls: { signal?: AbortSignal | null; resolve: (value: Response) => void }[] = [];
  const loader = createNavigationLoader(((_url, options) => new Promise<Response>(resolve => calls.push({ signal: options?.signal, resolve }))) as typeof fetch);
  const first = loader.load('/first').catch(error => error);
  const second = loader.load('/second');
  expect(calls[0].signal?.aborted).toBe(true);
  calls[1].resolve(Response.json({ version: 1, buildId: 'test', url: '/second', data: {} })); await second;
  calls[0].resolve(Response.json({ version: 1, buildId: 'test', url: '/first', data: {} }));
  expect((await first).name).toBe('AbortError');
});

it('never executes client effects during SSR and preserves redirect cookies', async () => {
  let effects=0;
  const handler=createRequestHandler({...config,routes:[{id:'home',path:'/',component:()=>{__effect(()=>{effects++});return 'server'}}],handlers:{home:{action:()=>new Response(null,{status:303,headers:{Location:'/done','Set-Cookie':'session=test; HttpOnly'}})}}});
  expect((await handler(new Request('http://localhost/'))).status).toBe(200); expect(effects).toBe(0);
  const result=await handler(new Request('http://localhost/_kanso/action/home',{method:'POST'}));
  expect(result.headers.get('X-Kanso-Redirect')).toBe('/done'); expect(result.headers.get('Set-Cookie')).toContain('HttpOnly');
  expect(await(await handler(new Request('http://localhost/missing',{method:'HEAD'}))).text()).toBe('');
  expect((await handler(new Request('http://localhost/%ZZ'))).status).toBe(400);
});
