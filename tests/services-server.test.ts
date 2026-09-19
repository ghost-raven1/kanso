import { describe, expect, it } from 'vitest';
import { createComponent, lazy } from 'solid-js';
import { defineService, useService, type ServiceScope } from '@kanso/core';
import { __store } from '@kanso/core/internal';
import { createRequestHandler } from '@kanso/app/server';
import type { Bootstrap } from '@kanso/app';

function state(initial = '') {
  let name = initial;
  return {
    getState: () => ({ name }),
    set(next: string) {
      name = next;
    },
    subscribe() {
      throw new Error('SSR must never subscribe');
    },
  };
}
const settings = defineService<ReturnType<typeof state>, { name: string }>({
  id: 'settings',
  create: ({ snapshot }) => state(snapshot?.name),
  snapshot: value => value.getState(),
  restore: (value, next) => value.set(next.name),
});
function ReadPage() {
  const store = useService(settings);
  return __store(
    () => store,
    () => value => value.name,
  )();
}
const routes = [{ id: 'home', path: '/', component: ReadPage }];
const options = {
  routes,
  buildId: 'services',
  assets: { entry: '/client.js' },
};
const bootstrap = (html: string): Bootstrap =>
  JSON.parse(
    html.match(/<script id="kanso-data"[^>]*>([\s\S]*?)<\/script>/)![1],
  );

describe('server service lifecycle', () => {
  it('shares a scope between loaders and rendering, but isolates concurrent requests', async () => {
    let created = 0;
    let disposed = 0;
    const privateService = defineService({
      id: 'private',
      create: ({ onCleanup }) => {
        created++;
        onCleanup(() => {
          disposed++;
        });
        return { secret: 'keep-on-server' };
      },
    });
    const scopes: ServiceScope[] = [];
    const handler = createRequestHandler({
      ...options,
      context: request => request.headers.get('X-User')!,
      handlers: {
        home: {
          loader: async ({ context, services }) => {
            scopes.push(services);
            services.get(privateService);
            services.get(settings).set(context);
            await new Promise(resolve =>
              setTimeout(resolve, context === 'A' ? 15 : 1),
            );
            return { label: context };
          },
        },
      },
    });
    const responses = await Promise.all(
      ['A', 'B'].map(name =>
        handler(
          new Request('http://localhost/', { headers: { 'X-User': name } }),
        ),
      ),
    );
    const html = await Promise.all(responses.map(response => response.text()));
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(bootstrap(html[0]).services).toEqual({ settings: { name: 'A' } });
    expect(bootstrap(html[1]).services).toEqual({ settings: { name: 'B' } });
    expect(html[0]).toContain('-->A<!--');
    expect(html[1]).toContain('-->B<!--');
    expect(html.join('')).not.toContain('keep-on-server');
    expect(created).toBe(2);
    expect(disposed).toBe(2);
    expect(scopes[0]).not.toBe(scopes[1]);
    expect(scopes.every(scope => scope.disposed)).toBe(true);
  });

  it('collects a public snapshot from a lazily rendered service and escapes script endings', async () => {
    const title = defineService<{ text: string }, { text: string }>({
      id: 'lazy',
      create: () => ({ text: '</script><b>lazy</b>' }),
      snapshot: value => value,
      restore: (value, next) => Object.assign(value, next),
    });
    const Lazy = lazy(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      return { default: () => useService(title).text };
    });
    const handler = createRequestHandler({
      ...options,
      routes: [
        { id: 'home', path: '/', component: () => createComponent(Lazy, {}) },
      ],
    });
    const response = await handler(new Request('http://localhost/'));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(bootstrap(html).services).toEqual({
      lazy: { text: '</script><b>lazy</b>' },
    });
    expect(html).not.toContain('</script><b>lazy</b>');
  });

  it('cleans redirects, HEAD, errors and timed out work, including late service access', async () => {
    for (const mode of ['redirect', 'head', 'error', 'timeout'] as const) {
      let cleaned = 0;
      let scope: ServiceScope | undefined;
      const service = defineService({
        id: 'resource',
        create: ({ onCleanup }) => {
          onCleanup(() => {
            cleaned++;
          });
          return {};
        },
      });
      const handler = createRequestHandler({
        ...options,
        timeoutMs: 20,
        handlers: {
          home: {
            loader: async ({ services }) => {
              scope = services;
              services.get(service);
              if (mode === 'redirect')
                throw new Response(null, {
                  status: 302,
                  headers: { Location: '/next' },
                });
              if (mode === 'error') throw new Error('loader failed');
              if (mode === 'timeout') await new Promise(() => {});
              return {};
            },
          },
        },
      });
      const response = await handler(
        new Request('http://localhost/', {
          method: mode === 'head' ? 'HEAD' : 'GET',
        }),
      );
      expect(response.status).toBe(
        { redirect: 302, head: 200, error: 500, timeout: 504 }[mode],
      );
      expect(cleaned).toBe(1);
      expect(scope!.signal.aborted).toBe(true);
      expect(() => scope!.get(service)).toThrow('KANSO_SERVICE_DISPOSED');
      if (mode === 'head') expect(await response.text()).toBe('');
    }
  });

  it('gives actions and native post-render loaders one scope and returns snapshots in data requests', async () => {
    let actionScope: ServiceScope | undefined;
    const handler = createRequestHandler({
      ...options,
      handlers: {
        home: {
          action: ({ services }) => {
            actionScope = services;
            services.get(settings).set('from-action');
            return { errors: { name: 'Review' } };
          },
          loader: ({ services, request }) => {
            if (request.method === 'GET' && services !== actionScope)
              services.get(settings).set('from-loader');
            return {};
          },
        },
      },
    });
    const fields = new URLSearchParams({
      __kanso_route: 'home',
      __kanso_form: 'sample',
    });
    const response = await handler(
      new Request('http://localhost/', { method: 'POST', body: fields }),
    );
    expect(response.status).toBe(422);
    expect(bootstrap(await response.text()).services).toEqual({
      settings: { name: 'from-action' },
    });
    expect(actionScope!.disposed).toBe(true);
    const data = await (
      await handler(new Request('http://localhost/_kanso/data?url=%2F'))
    ).json();
    expect(data.services).toEqual({ settings: { name: 'from-loader' } });
  });
  it('never caches a response whose service cleanup failed', async () => {
    let created = 0;
    const broken = defineService({
      id: 'cleanup-error',
      create: ({ onCleanup }) => {
        created++;
        onCleanup(() => {
          throw new Error('cleanup failed');
        });
        return {};
      },
    });
    const handler = createRequestHandler({
      ...options,
      routes: [{ ...routes[0], cache: { public: true, ttlMs: 10000 } }],
      handlers: {
        home: {
          loader: ({ services }) => {
            services.get(broken);
            return {};
          },
        },
      },
    });
    for (const method of ['GET', 'GET', 'HEAD']) {
      const response = await handler(
        new Request('http://localhost/', { method }),
      );
      expect(response.status).toBe(500);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      if (method === 'HEAD') expect(await response.text()).toBe('');
    }
    expect(created).toBe(3);
  });
});
