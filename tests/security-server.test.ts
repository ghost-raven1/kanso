import { expect, it } from 'vitest';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createRequestHandler, redirect } from '@kanso/app/server';
import { nodeHandler } from '@kanso/app/node';
import { useLoaderData } from '@kanso/app';

const options = {
  buildId: 'security-test', assets: { entry: '/client.js' },
  routes: [{ id: 'home', path: '/', component: () => useLoaderData<{ host: string }>().host, cache: { public: true as const, ttlMs: 10000 } }],
};

it('partitions public HTML and concurrent cache work by origin', async () => {
  const handler = createRequestHandler({ ...options, handlers: { home: { loader: ({ request }) => ({ host: new URL(request.url).host }) } } });
  const responses = await Promise.all(['alpha.test', 'beta.test'].map(host => handler(new Request(`https://${host}/`))));
  const html = await Promise.all(responses.map(response => response.text()));
  expect(html[0]).toContain('alpha.test');
  expect(html[1]).toContain('beta.test');
  expect(html[1]).not.toContain('alpha.test');
});

it('rejects cross-origin and unproven cookie mutations before context or body parsing', async () => {
  let calls = 0;
  const handler = createRequestHandler({ ...options, context: () => { calls++; }, handlers: { home: { action: () => { calls++; return {}; } } } });
  for (const headers of [
    { Origin: 'https://evil.test' }, { Origin: 'null' },
    { Referer: 'https://evil.test/form' }, { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'same-site' }, { Cookie: 'session=ambient' },
  ] as HeadersInit[]) expect((await handler(new Request('https://app.test/_kanso/action/home', { method: 'POST', headers }))).status).toBe(403);
  expect(calls).toBe(0);
  for (const headers of [{ Origin: 'https://app.test', Cookie: 'session=ok' }, { Referer: 'https://app.test/form', Cookie: 'session=ok' }, { 'Sec-Fetch-Site': 'same-origin', Cookie: 'session=ok' }, {}] as HeadersInit[]) {
    expect((await handler(new Request('https://app.test/_kanso/action/home', { method: 'POST', headers }))).status).toBe(200);
  }
});

it('bounds POST bodies including chunked requests before running application code', async () => {
  let calls = 0, cancelled = false;
  const handler = createRequestHandler({ ...options, maxBodyBytes: 8, handlers: { home: { action: async ({ request }) => { calls++; return { data: await request.text() }; } } } });
  const post = (body: BodyInit, headers?: HeadersInit) => new Request('https://app.test/_kanso/action/home', { method: 'POST', body, headers, ...{ duplex: 'half' } });
  expect((await handler(post('123456789', { 'Content-Length': '9' }))).status).toBe(413);
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new TextEncoder().encode('12345')); }, cancel() { cancelled = true; } });
  expect((await handler(post(stream)))).toMatchObject({ status: 413 });
  expect(cancelled).toBe(true);
  expect(calls).toBe(0);
  expect(await (await handler(post('12345678'))).json()).toEqual({ data: '12345678' });
});

it('refuses active redirect schemes in helpers and raw native/enhanced responses', async () => {
  for (const url of ['javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,bad', 'vbscript:bad']) {
    expect(() => redirect(url)).toThrow(/redirect/i);
    const handler = createRequestHandler({ ...options, handlers: { home: { loader: () => new Response(null, { status: 302, headers: { Location: url } }) } } });
    for (const path of ['/', '/_kanso/data?url=%2F']) {
      const result = await handler(new Request(`https://app.test${path}`));
      expect(result.status).toBe(500);
      expect(result.headers.has('X-Kanso-Redirect')).toBe(false);
      expect(result.headers.has('Location')).toBe(false);
    }
  }
  expect(redirect('/next').headers.get('Location')).toBe('/next');
  expect(redirect('https://identity.test/login').status).toBe(303);
});

it('keeps the configured Node origin even for hostile HTTP request targets', async () => {
  const seen: string[] = [];
  const server = createServer(nodeHandler(async request => { seen.push(request.url); return new Response('ok'); }, 'http://app.test'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  try {
    for (const path of ['//evil.test/', '/\\evil.test/', 'http://evil.test/']) {
      const status = await new Promise<number>(resolve => {
        const request = httpRequest({ host: '127.0.0.1', port, path }, response => { response.resume(); resolve(response.statusCode!); }); request.end();
      });
      expect(status).toBe(400);
    }
    expect(seen).toEqual([]);
    expect((await fetch(`http://127.0.0.1:${port}/safe?value=1`)).status).toBe(200);
    expect(seen).toEqual(['http://app.test/safe?value=1']);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('returns a real HTTP 413 through the Node adapter without resetting the connection', async () => {
  const handler = createRequestHandler({ ...options, maxBodyBytes: 8 });
  const server = createServer(nodeHandler(handler, 'http://app.test'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  try {
    expect((await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: '123456789' })).status).toBe(413);
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest({ host: '127.0.0.1', port, path: '/', method: 'POST' }, response => { response.resume(); resolve(response.statusCode!); });
      request.on('error', reject); request.write('123456'); request.end('789');
    });
    expect(status).toBe(413);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('cancels a stalled body on timeout before application work starts', async () => {
  let cancelled = false, calls = 0;
  const handler = createRequestHandler({ ...options, timeoutMs: 10, context: () => { calls++; } });
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const result = await handler(new Request('https://app.test/', { method: 'POST', body, ...{ duplex: 'half' } }));
  expect(result.status).toBe(504);
  expect(cancelled).toBe(true);
  expect(calls).toBe(0);
});
