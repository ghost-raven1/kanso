import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent, createResource, ErrorBoundary, Suspense } from 'solid-js';
import { createRequestHandler } from '@kanso/app/server';
import { defineRemote } from '@kanso/microfrontends';

afterEach(() => vi.unstubAllGlobals());

function remoteHandler(showRemote = () => true) {
  const remote = defineRemote<{ components: { Card: () => string } }>({ name: 'catalog', contract: '^1.0.0', manifest: 'https://cdn.test/catalog/kanso-remote.json' });
  const Card = remote.component('Card');
  return createRequestHandler({
    buildId: 'render-test', assets: { entry: '/client.js' }, microfrontends: [remote],
    routes: [{ id: 'home', path: '/', component: () => showRemote() ? createComponent(Card, {}) : 'Healthy page', cache: { public: true, ttlMs: 60_000 } }],
    remoteSources: { catalog: { manifest: 'https://private.test/catalog/{buildId}/kanso-server.json' } },
  });
}

describe('remote SSR render failures', () => {
  it.each(['GET', 'HEAD'])('returns uncacheable 503 for an asynchronously unavailable required widget on %s', async method => {
    const fetcher = vi.fn(async () => { await Promise.resolve(); return new Response('Offline', { status: 503 }); });
    vi.stubGlobal('fetch', fetcher);
    const handler = remoteHandler();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await handler(new Request('https://host.test/', { method }));
      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      const body = await response.text();
      if (method === 'HEAD') expect(body).toBe('');
      else expect(body).toContain('Remote artifact unavailable');
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('preserves ordinary application error boundary fallbacks', async () => {
    const Component = () => createComponent(ErrorBoundary, {
      fallback: () => 'Application fallback',
      get children() {
        const [value] = createResource(async () => { await Promise.resolve(); throw new Error('Handled application error'); });
        return createComponent(Suspense, { get children() { return value(); } });
      },
    });
    const handler = createRequestHandler({ buildId: 'test', assets: { entry: '/client.js' }, routes: [{ id: 'home', path: '/', component: Component }] });
    const response = await handler(new Request('https://host.test/'));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Application fallback');
  });

  it('does not carry a previous request error into a healthy render', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Offline', { status: 503 })));
    let showRemote = true;
    const handler = remoteHandler(() => showRemote);
    expect((await handler(new Request('https://host.test/'))).status).toBe(503);
    showRemote = false;
    const healthy = await handler(new Request('https://host.test/'));
    expect(healthy.status).toBe(200);
    expect(await healthy.text()).toContain('Healthy page');
  });
});
