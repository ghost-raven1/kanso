import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { createServiceWorker } from '../packages/workers/src/service.js';
import {
  defineServiceWorker, installServiceWorker, type ServiceWorkerDefinition,
  type ServiceWorkerEvents, type ServiceWorkerScope, type ServiceWorkerFetchEvent,
} from '../packages/workers/src/service-runtime.js';
import { serviceWorkerPlugin } from '../packages/vite/src/service-worker.js';

afterEach(() => { vi.unstubAllGlobals(); });

function browserRegistration() {
  const worker = Object.assign(new EventTarget(), { state: 'activated', postMessage: vi.fn() });
  const registration = Object.assign(new EventTarget(), {
    active: worker as unknown as ServiceWorker,
    waiting: null as ServiceWorker | null,
    installing: null as ServiceWorker | null,
    update: vi.fn(async () => undefined), unregister: vi.fn(async () => true),
  });
  const container = Object.assign(new EventTarget(), { controller: worker, register: vi.fn(async () => registration) });
  vi.stubGlobal('navigator', { serviceWorker: container });
  return { worker, registration, container };
}

describe('service worker registration', () => {
  it('is inert on the server and when disabled', async () => {
    vi.stubGlobal('navigator', undefined);
    const server = createServiceWorker('/service-worker.js');
    expect(server.state.status).toBe('unsupported');
    expect(await server.register()).toBeUndefined();
    const { container } = browserRegistration();
    const disabled = createServiceWorker(undefined);
    expect(disabled.state.status).toBe('disabled');
    expect(await disabled.register()).toBeUndefined();
    expect(container.register).not.toHaveBeenCalled();
  });

  it('shares registration, reports updates and only requests activation explicitly', async () => {
    const { worker, registration, container } = browserRegistration();
    const controller = createServiceWorker('/service-worker.js', { scope: '/' });
    const states: string[] = [];
    controller.subscribe(state => states.push(state.status));
    const first = controller.register();
    expect(controller.register()).toBe(first);
    await first;
    expect(container.register).toHaveBeenCalledExactlyOnceWith('/service-worker.js', { type: 'classic', updateViaCache: 'none', scope: '/' });
    expect(controller.state.status).toBe('ready');
    registration.waiting = worker as unknown as ServiceWorker;
    registration.dispatchEvent(new Event('updatefound'));
    expect(controller.state.status).toBe('update-available');
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(controller.activateUpdate()).toBe(true);
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'kanso:activate-update' });
    expect(controller.state.status).toBe('activating');
    registration.waiting = null;
    container.dispatchEvent(new Event('controllerchange'));
    expect(controller.state.status).toBe('ready');
    await controller.update();
    expect(registration.update).toHaveBeenCalledOnce();
    controller.dispose();
    const length = states.length;
    registration.dispatchEvent(new Event('updatefound'));
    expect(states).toHaveLength(length);
    expect(registration.unregister).not.toHaveBeenCalled();
    expect(controller.activateUpdate()).toBe(false);
  });

  it('allows explicit unregistration and retries failed registrations', async () => {
    const { container, registration } = browserRegistration();
    container.register.mockRejectedValueOnce(new Error('offline'));
    const controller = createServiceWorker('/service-worker.js');
    await expect(controller.register()).rejects.toThrow('offline');
    expect(controller.state.status).toBe('error');
    await controller.register();
    expect(await controller.unregister()).toBe(true);
    expect(registration.unregister).toHaveBeenCalledOnce();
    expect(controller.state.status).toBe('idle');
    controller.dispose();
    await expect(controller.register()).rejects.toThrow('disposed');
  });

  it('does not attach listeners if disposed while registration is pending', async () => {
    const { container, registration } = browserRegistration();
    let complete!: (registration: unknown) => void;
    container.register.mockImplementationOnce(() => new Promise(resolve => { complete = value => resolve(value as typeof registration); }));
    const controller = createServiceWorker('/service-worker.js');
    const result = controller.register();
    controller.dispose();
    complete(registration);
    await result;
    registration.dispatchEvent(new Event('updatefound'));
    expect(controller.state.status).toBe('disposed');
  });
});

function workerScope() {
  const stores = new Map<string, Map<string, Response>>();
  const listeners = new Map<string, (event: unknown) => void>();
  const network = vi.fn(async (_request: RequestInfo | URL): Promise<Response> => new Response('asset-v1', {
    headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=31536000, immutable' },
  }));
  const scope: ServiceWorkerScope = {
    location: { href: 'https://example.com/service-worker.js', origin: 'https://example.com' },
    fetch: network,
    skipWaiting: vi.fn(async () => undefined),
    caches: {
      async open(name: string) {
        let contents = stores.get(name);
        if (!contents) { contents = new Map(); stores.set(name, contents); }
        const key = (request: RequestInfo | URL) => request instanceof Request ? request.url : String(request);
        return {
          async match(request: RequestInfo | URL) { return contents.get(key(request))?.clone(); },
          async put(request: RequestInfo | URL, response: Response) { contents.set(key(request), response.clone()); },
        } as Cache;
      },
    } as CacheStorage,
    addEventListener(type, listener) { listeners.set(type, listener as (event: unknown) => void); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
  };
  return {
    scope, network, stores,
    dispatch<K extends keyof ServiceWorkerEvents>(name: K, event: ServiceWorkerEvents[K]) { listeners.get(name)?.(event); },
    async lifecycle(name: 'install' | 'activate', data?: unknown) {
      const promises: Promise<unknown>[] = [];
      listeners.get(name)?.({ data, waitUntil: (promise: Promise<unknown>) => promises.push(promise) });
      await Promise.all(promises);
    },
    async message(data: unknown) {
      const promises: Promise<unknown>[] = [];
      listeners.get('message')?.({ data, waitUntil: (promise: Promise<unknown>) => promises.push(promise) });
      await Promise.all(promises);
    },
    async request(request: Request) {
      let response: Promise<Response> | Response | undefined;
      const promises: Promise<unknown>[] = [];
      const event: ServiceWorkerFetchEvent = { request, respondWith(value) { response = value; }, waitUntil(value) { promises.push(value); } };
      listeners.get('fetch')?.(event);
      const result = await response;
      await Promise.all(promises);
      return result;
    },
  };
}

const asset = (path = '/assets/a.1234.js', init?: RequestInit) => new Request(`https://example.com${path}`, init);
const config = (extra: Partial<ServiceWorkerDefinition> = {}): ServiceWorkerDefinition => ({
  version: 'release-a', routes: [{ match: ({ url }) => url.pathname.startsWith('/assets/'), strategy: 'cache-first' }], ...extra,
});

describe('service worker runtime', () => {
  it('keeps release caches separate, keys query strings exactly and retains old caches', async () => {
    const env = workerScope();
    let stop = installServiceWorker(config(), env.scope);
    expect(await (await env.request(asset()))!.text()).toBe('asset-v1');
    env.network.mockImplementation(async () => new Response('asset-v2'));
    expect(await (await env.request(asset()))!.text()).toBe('asset-v1');
    expect(await (await env.request(asset('/assets/a.1234.js?v=2')))!.text()).toBe('asset-v2');
    stop();
    stop = installServiceWorker(config({ version: 'release-b' }), env.scope);
    await env.lifecycle('activate');
    expect(await (await env.request(asset()))!.text()).toBe('asset-v2');
    expect(env.stores.size).toBe(2);
    expect(env.scope.skipWaiting).not.toHaveBeenCalled();
    stop();
    expect(await env.request(asset())).toBeUndefined();
  });

  it('bypasses HTML, JSON, Kanso data/actions, auth, POST, range and private request headers', async () => {
    const env = workerScope();
    installServiceWorker(config({ routes: [{ match: () => true, strategy: 'cache-first' }] }), env.scope);
    for (const request of [
      asset('/index.html'), asset('/kanso-remote.json'), asset('/_kanso/data?url=/'), asset('/_kanso/action/save'),
      asset('/api/session.js'), asset('/auth/config.js'), asset('/assets/a.js', { method: 'POST', body: 'private' }),
      asset('/assets/a.js', { headers: { authorization: 'Bearer secret' } }),
      asset('/assets/a.js', { headers: { range: 'bytes=0-1' } }),
      asset('/assets/a.js', { cache: 'no-store' }), asset('/assets/a.js', { headers: { 'cache-control': 'no-cache' } }),
      asset('/assets/a.js', { cache: 'no-cache' }), asset('/assets/a.js', { cache: 'reload' }),
      new Request('https://cdn.example.com/assets/public.js'),
    ]) expect(await env.request(request), request.url).toBeUndefined();
    expect(env.network).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([
    { 'cache-control': 'private, max-age=60' }, { 'cache-control': 'no-store' }, { 'cache-control': 'no-cache' },
    { 'set-cookie': 'session=x' }, { vary: '*' }, { 'content-type': 'text/html' }, { 'content-type': 'application/json' },
  ])('refuses response cache directives and non-static content: %j', async headers => {
    const env = workerScope();
    installServiceWorker(config(), env.scope);
    env.network.mockImplementation(async () => new Response('private', { headers }));
    await env.request(asset());
    await env.request(asset());
    expect(env.network).toHaveBeenCalledTimes(2);
    expect([...env.stores.values()].every(store => store.size === 0)).toBe(true);
  });

  it('supports network-first and stale-while-revalidate without failing a cached response', async () => {
    for (const strategy of ['network-first', 'stale-while-revalidate'] as const) {
      const env = workerScope();
      installServiceWorker(config({ routes: [{ match: () => true, strategy }] }), env.scope);
      await env.request(asset());
      env.network.mockRejectedValueOnce(new Error('offline'));
      expect(await (await env.request(asset()))!.text()).toBe('asset-v1');
      env.network.mockResolvedValueOnce(new Response('updated'));
      const updated = await env.request(asset());
      expect(await updated!.text()).toBe(strategy === 'network-first' ? 'updated' : 'asset-v1');
      env.network.mockRejectedValueOnce(new Error('offline'));
      expect(await (await env.request(asset()))!.text()).toBe('updated');
    }
  });

  it('allows explicitly listed CORS asset origins and survives unavailable cache storage', async () => {
    const env = workerScope();
    installServiceWorker(config({ routes: [{ match: () => true, strategy: 'cache-first', origins: ['https://cdn.example.com'] }] }), env.scope);
    const request = new Request('https://cdn.example.com/releases/a/widget.js');
    expect(await (await env.request(request))!.text()).toBe('asset-v1');
    expect(await (await env.request(request))!.text()).toBe('asset-v1');
    expect(env.network).toHaveBeenCalledOnce();
    const unavailable = workerScope();
    unavailable.scope.caches.open = async () => { throw new Error('quota'); };
    installServiceWorker(config(), unavailable.scope);
    expect(await (await unavailable.request(asset()))!.text()).toBe('asset-v1');
  });

  it('keeps redirects and no-store offline fallbacks out of the cache', async () => {
    const env = workerScope();
    installServiceWorker(config(), env.scope);
    env.network.mockImplementation(async () => Response.redirect('https://example.com/login'));
    expect((await env.request(asset()))!.status).toBe(302);
    await env.request(asset());
    expect(env.network).toHaveBeenCalledTimes(2);
    installServiceWorker(config({ offlineFallback: '/offline.html' }), env.scope);
    env.network.mockImplementation(async () => new Response('personal', { headers: { 'Cache-Control': 'no-store' } }));
    await expect(env.lifecycle('install')).rejects.toThrow('KANSO_SERVICE_WORKER_PRECACHE');
  });

  it('precaches public assets and an explicit offline document without caching navigations', async () => {
    const env = workerScope();
    env.network.mockImplementation(async request => new Response(String(request instanceof Request ? new URL(request.url).pathname : request), {
      headers: { 'content-type': request instanceof Request && request.url.endsWith('.html') ? 'text/html' : 'text/javascript' },
    }));
    installServiceWorker(config({ routes: [], precache: ['/assets/offline.js'], offlineFallback: '/offline.html' }), env.scope);
    await env.lifecycle('install');
    env.network.mockRejectedValue(new Error('offline'));
    expect(await (await env.request(asset('/assets/offline.js')))!.text()).toBe('/assets/offline.js');
    const navigation = asset('/products/one');
    Object.defineProperty(navigation, 'mode', { value: 'navigate' });
    expect(await (await env.request(navigation))!.text()).toBe('/offline.html');
    expect([...env.stores.values()][0]!.size).toBe(2);
    expect(env.scope.skipWaiting).not.toHaveBeenCalled();
    await env.message({ type: 'kanso:activate-update' });
    expect(env.scope.skipWaiting).toHaveBeenCalledOnce();
  });

  it('rejects unsafe precache and supports custom lifecycle handlers', async () => {
    const env = workerScope();
    installServiceWorker(config({ precache: ['/_kanso/data'] }), env.scope);
    await expect(env.lifecycle('install')).rejects.toThrow('KANSO_SERVICE_WORKER_PRECACHE');
    const hooks = { onInstall: vi.fn(), onActivate: vi.fn(), onMessage: vi.fn() };
    installServiceWorker(config(hooks), env.scope);
    await env.lifecycle('install'); await env.lifecycle('activate'); await env.message({ type: 'custom' });
    expect(hooks.onInstall).toHaveBeenCalledOnce();
    expect(hooks.onActivate).toHaveBeenCalledOnce();
    expect(hooks.onMessage).toHaveBeenCalledOnce();
    expect(() => defineServiceWorker({ version: ' ' })).toThrow('KANSO_SERVICE_WORKER_VERSION');
  });
});

it('builds an optional standalone service worker with base-aware URL and build identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kanso-service-worker-'));
  try {
    await writeFile(join(root, 'index.html'), '<script type="module" src="/main.ts"></script>');
    await writeFile(join(root, 'main.ts'), 'import {serviceWorkerUrl} from "virtual:kanso/service-worker";console.log(serviceWorkerUrl);');
    await writeFile(join(root, 'worker.ts'), `import {defineServiceWorker,installServiceWorker} from ${JSON.stringify(resolve('packages/workers/src/service-runtime.ts'))};installServiceWorker(defineServiceWorker({version:import.meta.env.KANSO_SERVICE_WORKER_BUILD_ID}));`);
    await build({ configFile: false, root, base: '/demo/', logLevel: 'silent', plugins: [serviceWorkerPlugin({ entry: 'worker.ts' }, 'test-release')] });
    const worker = await readFile(join(root, 'dist/service-worker.js'), 'utf8');
    expect(worker).toContain('test-release');
    expect(worker).not.toContain('import.meta.hot');
    expect(worker).not.toContain('react-dom');
    const html = await readFile(join(root, 'dist/index.html'), 'utf8');
    const entry = /src="\/demo\/([^\"]+)"/.exec(html)![1]!;
    expect(await readFile(join(root, 'dist', entry), 'utf8')).toContain('/demo/service-worker.js');
  } finally { await rm(root, { recursive: true, force: true }); }
});
