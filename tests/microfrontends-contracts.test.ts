import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MicrofrontendOptions, RemotePins } from '@kanso/app/integration';
import { createComponent } from 'solid-js';
import { Form, useForm } from '@kanso/app';
import { createRequestHandler } from '@kanso/app/server';
import { defineRemote } from '../packages/microfrontends/src/index.js';
import { createSession } from '../packages/microfrontends/src/session.js';
import { releaseManifest, RUNTIME_VERSIONS, validateManifest, validBuildId, type RemoteManifest } from '../packages/microfrontends/src/manifest.js';

const federation = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@kanso/microfrontends/transport', () => ({ loadModule: federation.execute }));

const currentManifest = 'https://cdn.example.test/catalog/kanso-remote.json';
const serverManifest = 'https://private.example.test/catalog/{buildId}/kanso-server.json';
const definition = { name: 'catalog', manifest: currentManifest, contract: '^1.0.0', createSession };
const manifest = (changes: Partial<RemoteManifest> = {}): RemoteManifest => ({
  schema: 1, name: 'catalog', buildId: 'release-a', contract: '1.2.0', runtime: { ...RUNTIME_VERSIONS },
  entry: './entry.js', exports: ['ProductCard'], styles: ['./style.css'], preloads: ['./chunk.js'],
  types: './contract.d.ts', ...changes,
});
const pin = (buildId = 'release-a', manifest = 'https://untrusted.invalid/override.json'): RemotePins => ({
  catalog: { buildId, manifest, modules: [] },
});
const options = (changes: Partial<MicrofrontendOptions> = {}): MicrofrontendOptions => ({
  definitions: [definition], sources: { catalog: { manifest: serverManifest } }, ...changes,
});
const mockedFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  const fetcher = vi.fn((url: string | URL | Request, init?: RequestInit) => handler(url instanceof Request ? url.url : String(url), init));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
};

beforeEach(() => { federation.execute.mockReset(); federation.execute.mockImplementation(async (value: RemoteManifest) => ({ release: value.buildId })); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('microfrontend manifest contracts', () => {
  it('resolves relative public assets and validates the exact host runtime', () => {
    const base = releaseManifest(currentManifest, 'release-a');
    const result = validateManifest(manifest(), definition, base);
    expect(result.entry).toBe('https://cdn.example.test/catalog/releases/release-a/entry.js');
    expect(result.styles).toEqual(['https://cdn.example.test/catalog/releases/release-a/style.css']);
    expect(result.types).toBe('https://cdn.example.test/catalog/releases/release-a/contract.d.ts');
    expect(result.runtime).toEqual(RUNTIME_VERSIONS);
  });

  it.each(['', '../release', 'release/a', 'release%2Fa', 'a.b', 'a'.repeat(101)])('rejects invalid build identity %j', buildId => {
    expect(validBuildId(buildId)).toBe(false);
    expect(() => releaseManifest(currentManifest, buildId)).toThrow(expect.objectContaining({ code: 'MF_INVALID_BUILD', status: 400 }));
  });

  it.each(['file:///tmp/remote.js', 'javascript:alert(1)', 'https://user:password@cdn.example.test/entry.js', 'http://['])('diagnoses invalid executable URL %j', entry => {
    expect(() => validateManifest(manifest({ entry }), definition, currentManifest)).toThrow(expect.objectContaining({ code: 'MF_INVALID_URL' }));
  });

  it('rejects incompatible contract, renamed remote, invalid exports and a different pinned build', () => {
    expect(() => validateManifest(manifest({ contract: '2.0.0' }), definition, currentManifest)).toThrow(expect.objectContaining({ code: 'MF_CONTRACT_MISMATCH' }));
    expect(() => validateManifest(manifest({ name: 'other' }), definition, currentManifest)).toThrow(expect.objectContaining({ code: 'MF_INVALID_MANIFEST' }));
    expect(() => validateManifest(manifest({ exports: ['../server'] }), definition, currentManifest)).toThrow(expect.objectContaining({ code: 'MF_INVALID_MANIFEST' }));
    expect(() => validateManifest(manifest(), definition, currentManifest, 'release-b')).toThrow(expect.objectContaining({ code: 'MF_RELEASE_MISMATCH', status: 409 }));
  });

  it.each(Object.keys(RUNTIME_VERSIONS))('rejects %s runtime mismatch before executing modules', async name => {
    mockedFetch(() => Response.json(manifest({ runtime: { ...RUNTIME_VERSIONS, [name]: '999.0.0' } })));
    const session = createSession(options());
    await expect(session.load('catalog', 'ProductCard')).rejects.toMatchObject({ code: 'MF_RUNTIME_MISMATCH' });
    expect(federation.execute).not.toHaveBeenCalled();
    session.dispose();
  });

  it('checks contract compatibility before executing modules', async () => {
    mockedFetch(() => Response.json(manifest({ contract: '2.0.0' })));
    const session = createSession(options());
    await expect(session.load('catalog', 'ProductCard')).rejects.toMatchObject({ code: 'MF_CONTRACT_MISMATCH' });
    expect(federation.execute).not.toHaveBeenCalled();
    session.dispose();
  });
});

describe('microfrontend sessions and trusted release pins', () => {
  it('preloads widget-only exports without requesting routes or mounting components', async () => {
    mockedFetch(url => Response.json(manifest({ server: url.startsWith('https://private.'), exports: ['ProductCard', 'Banner'] })));
    const component = vi.fn(() => 'Widget');
    federation.execute.mockResolvedValue({ default: component });
    const remote = defineRemote<{ components: { ProductCard: typeof component; Banner: typeof component } }>({ name: 'catalog', manifest: currentManifest, contract: '^1.0.0' });
    const session = createSession(options());
    await remote.preload(session);
    expect(federation.execute.mock.calls.map(([, name]) => name).sort()).toEqual(['Banner', 'ProductCard']);
    expect(component).not.toHaveBeenCalled();
    expect(session.pins().catalog.modules.sort()).toEqual(['Banner', 'ProductCard']);
    await remote.preload(session);
    expect(federation.execute).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it('uses an explicitly configured local SSR loader for the matching release', async () => {
    const fetcher = mockedFetch(() => Response.json(manifest()));
    const local = vi.fn(async () => ({ default: () => 'Local widget' }));
    const session = createSession(options({ sources: { catalog: { development: { buildId: 'release-a', load: local } } } }));
    const module = await session.load('catalog', 'ProductCard');
    expect(module).toBe(await local.mock.results[0].value);
    expect(local).toHaveBeenCalledExactlyOnceWith('ProductCard');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(federation.execute).not.toHaveBeenCalled();
    expect(session.pins().catalog.buildId).toBe('release-a');
    session.dispose();
  });

  it('rejects a different local SSR release before executing the development loader', async () => {
    mockedFetch(() => Response.json(manifest()));
    const local = vi.fn();
    const session = createSession(options({ sources: { catalog: { development: { buildId: 'release-b', load: local } } } }));
    await expect(session.load('catalog', 'ProductCard')).rejects.toMatchObject({ code: 'MF_RELEASE_MISMATCH', status: 409 });
    expect(local).not.toHaveBeenCalled();
    expect(federation.execute).not.toHaveBeenCalled();
    session.dispose();
  });

  it('rejects duplicate remote names before any network request', () => {
    const fetcher = mockedFetch(() => Response.json(manifest()));
    expect(() => createSession(options({ definitions: [definition, definition] }))).toThrow(expect.objectContaining({ code: 'MF_DUPLICATE_REMOTE' }));
    expect(fetcher).not.toHaveBeenCalled();
    expect(federation.execute).not.toHaveBeenCalled();
  });

  it('requires an explicit trusted private server source', async () => {
    mockedFetch(() => Response.json(manifest()));
    const session = createSession(options({ sources: undefined }));
    await expect(session.load('catalog', 'ProductCard')).rejects.toMatchObject({ code: 'MF_SERVER_SOURCE_REQUIRED' });
    expect(federation.execute).not.toHaveBeenCalled();
    session.dispose();
  });

  it('rejects a public manifest used as a private server artifact', async () => {
    mockedFetch(() => Response.json(manifest()));
    const session = createSession(options());
    await expect(session.load('catalog', 'ProductCard')).rejects.toMatchObject({ code: 'MF_SERVER_MANIFEST_REQUIRED' });
    expect(federation.execute).not.toHaveBeenCalled();
    session.dispose();
  });

  it('ignores client-supplied executable URLs and derives pinned sources from trusted definitions', async () => {
    const fetcher = mockedFetch(url => Response.json(manifest({ server: url.startsWith('https://private.') })));
    const session = createSession(options({ pins: pin() }));
    await expect(session.load('catalog', 'ProductCard')).resolves.toEqual({ release: 'release-a' });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://cdn.example.test/catalog/releases/release-a/kanso-remote.json',
      'https://private.example.test/catalog/release-a/kanso-server.json',
    ]);
    expect(federation.execute.mock.calls[0][0].entry).toBe('https://private.example.test/catalog/release-a/entry.js');
    expect(session.pins().catalog.manifest).toBe(releaseManifest(currentManifest, 'release-a'));
    expect(session.pins().catalog.modules).toEqual(['ProductCard']);
    const snapshot = session.pins();
    snapshot.catalog.modules.push('tampered');
    snapshot.catalog.buildId = 'release-b';
    expect(session.pins().catalog.modules).toEqual(['ProductCard']);
    expect(session.pins().catalog.buildId).toBe('release-a');
    session.dispose();
  });

  it('rejects unknown, malformed and conflicting pins before executing a different release', () => {
    expect(() => createSession(options({ pins: { stranger: pin().catalog } }))).toThrow(expect.objectContaining({ code: 'MF_INVALID_PINS' }));
    expect(() => createSession(options({ pins: pin('../outside') }))).toThrow(expect.objectContaining({ code: 'MF_INVALID_BUILD', status: 400 }));
    const session = createSession(options({ pins: pin() }));
    expect(() => session.adopt(pin('release-b'))).toThrow(expect.objectContaining({ code: 'MF_RELEASE_MISMATCH', status: 409 }));
    expect(session.pins().catalog.buildId).toBe('release-a');
    expect(federation.execute).not.toHaveBeenCalled();
    session.dispose();
  });

  it('deduplicates concurrent module loads within a session', async () => {
    const fetcher = mockedFetch(url => Response.json(manifest({ server: url.startsWith('https://private.') })));
    const session = createSession(options());
    const [first, second] = await Promise.all([session.load('catalog', 'ProductCard'), session.load('catalog', 'ProductCard')]);
    expect(first).toBe(second);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(federation.execute).toHaveBeenCalledOnce();
    expect(session.peek('catalog', 'ProductCard')).toBe(first);
    session.dispose();
  });

  it('isolates concurrent request identities, assets and loaded modules', async () => {
    mockedFetch(url => {
      const buildId = url.includes('release-b') ? 'release-b' : 'release-a';
      return Response.json(manifest({ buildId, server: url.startsWith('https://private.') }));
    });
    const first = createSession(options({ pins: pin('release-a') }));
    const second = createSession(options({ pins: pin('release-b') }));
    const result = await Promise.all([first.load('catalog', 'ProductCard'), second.load('catalog', 'ProductCard')]);
    expect(result).toEqual([{ release: 'release-a' }, { release: 'release-b' }]);
    expect(first.pins().catalog.buildId).toBe('release-a');
    expect(second.pins().catalog.buildId).toBe('release-b');
    expect(first.assets().styles).toEqual(['https://cdn.example.test/catalog/releases/release-a/style.css']);
    expect(second.assets().styles).toEqual(['https://cdn.example.test/catalog/releases/release-b/style.css']);
    first.dispose(); second.dispose();
  });

  it('allows identifier names that overlap Object.prototype properties', async () => {
    const remote = defineRemote<{ components: { ProductCard: () => string } }>({ name: 'constructor', contract: '^1.0.0', manifest: currentManifest });
    mockedFetch(url => Response.json(manifest({ name: 'constructor', server: url.startsWith('https://private.') })));
    const session = createSession({ definitions: [remote], sources: { constructor: { manifest: serverManifest } } });
    await expect(session.load('constructor', 'ProductCard')).resolves.toEqual({ release: 'release-a' });
    expect(Object.keys(session.pins())).toEqual(['constructor']);
    session.dispose();
  });

  it('returns unavailable for a missing current manifest and refresh-required for a missing pinned release', async () => {
    mockedFetch(() => new Response('missing', { status: 404 }));
    const unpinned = createSession(options());
    const pinned = createSession(options({ pins: pin() }));
    await expect(unpinned.load('catalog', 'ProductCard')).rejects.toMatchObject({ status: 503 });
    await expect(pinned.load('catalog', 'ProductCard')).rejects.toMatchObject({ status: 409 });
    expect(federation.execute).not.toHaveBeenCalled();
    unpinned.dispose(); pinned.dispose();
  });

  it('cancels outstanding metadata requests when their session is disposed', async () => {
    mockedFetch((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }));
    const session = createSession(options());
    const pending = session.load('catalog', 'ProductCard');
    session.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'MF_TIMEOUT', status: 504 });
    expect(federation.execute).not.toHaveBeenCalled();
  });

  it('does not execute code after cancellation races with completed metadata parsing', async () => {
    const controller = new AbortController();
    mockedFetch(url => {
      const server = url.startsWith('https://private.');
      const response = Response.json(manifest({ server }));
      if (server) response.json = async () => { controller.abort(); return manifest({ server: true }); };
      return response;
    });
    const session = createSession(options({ signal: controller.signal }));
    await expect(session.load('catalog', 'ProductCard')).rejects.toBeInstanceOf(Error);
    expect(federation.execute).not.toHaveBeenCalled();
    session.dispose();
  });
});

describe('microfrontend SSR integration', () => {
  it('keeps native-form release pins in sync with widgets resolved later during SSR', async () => {
    const remote = defineRemote<{ components: { ProductCard: () => string } }>({ name: 'catalog', manifest: currentManifest, contract: '^1.0.0' });
    const ProductCard = remote.component('ProductCard');
    mockedFetch(url => Response.json(manifest({ server: url.startsWith('https://private.') })));
    federation.execute.mockResolvedValue({ default: () => 'Remote widget' });
    function Home() {
      const form = useForm({ routeId: 'home', id: 'contact' });
      return [createComponent(Form, { state: form, children: 'Contact' }), createComponent(ProductCard, {})];
    }
    const handler = createRequestHandler({
      buildId: 'host', assets: { entry: '/entry.js' }, routes: [{ id: 'home', path: '/', component: Home }],
      microfrontends: [remote], remoteSources: { catalog: { manifest: serverManifest } },
    });
    const response = await handler(new Request('https://example.test/'));
    expect(response.status).toBe(200);
    const html = await response.text();
    const bootstrap = JSON.parse(/<script id="kanso-data"[^>]*>(.*?)<\/script>/.exec(html)![1]);
    const field = /<input[^>]*name="__kanso_remotes"[^>]*value="([^"]*)"/.exec(html)![1];
    const formPins = JSON.parse(field.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
    expect(bootstrap.remotes.catalog.buildId).toBe('release-a');
    expect(formPins.catalog?.buildId).toBe('release-a');
  });

  it('retains sitemap generations across requests when microfrontends are enabled', async () => {
    let enumerations = 0;
    const handler = createRequestHandler({
      buildId: 'host', assets: { entry: '/entry.js' },
      routes: [{ id: 'home', path: '/', component: () => 'Home', sitemap: true }],
      microfrontends: [definition], seo: { siteUrl: 'https://example.test' },
      sitemap: { entries: () => { enumerations++; return Array.from({ length: 50001 }, (_, index) => ({ url: `/products/${index}` })); } },
    });
    const indexResponse = await handler(new Request('https://example.test/sitemap.xml'));
    expect(indexResponse.status).toBe(200);
    const index = await indexResponse.text();
    expect(index).toContain('<sitemapindex');
    const firstPart = /<loc>(.*?)<\/loc>/.exec(index)![1];
    const part = await handler(new Request(firstPart));
    expect(part.status).toBe(200);
    expect(await part.text()).toContain('/products/0');
    expect(await (await handler(new Request('https://example.test/sitemap.xml'))).text()).toBe(index);
    expect(enumerations).toBe(1);
  });

  it('serves old sitemap parts after a remote release changes or becomes unavailable', async () => {
    let release = 'release-a';
    const remote = defineRemote<{ components: object }>({ name: 'catalog', manifest: currentManifest, contract: '^1.0.0' });
    const fetcher = mockedFetch(url => Response.json(manifest({ buildId: release, server: url.startsWith('https://private.'), routes: true })));
    federation.execute.mockImplementation(async (_manifest: RemoteManifest, name: string) => name === 'routes'
      ? { routes: [{ id: 'index', path: '/', component: () => 'Catalog', sitemap: true }] }
      : { handlers: {} });
    const handler = createRequestHandler({
      buildId: 'host', assets: { entry: '/entry.js' }, routes: [remote.routes({ path: '/catalog' })],
      microfrontends: [remote], remoteSources: { catalog: { manifest: serverManifest } },
      seo: { siteUrl: 'https://example.test' },
      sitemap: { entries: () => Array.from({ length: 50001 }, (_, index) => ({ url: `/${release}/products/${index}` })) },
    });
    const first = await (await handler(new Request('https://example.test/sitemap.xml'))).text();
    const partUrl = /<loc>(.*?)<\/loc>/.exec(first)![1];
    release = 'release-b';
    const next = await (await handler(new Request('https://example.test/sitemap.xml'))).text();
    expect(next).not.toBe(first);
    fetcher.mockRejectedValue(new Error('Remote is offline'));
    const calls = fetcher.mock.calls.length;
    const part = await handler(new Request(partUrl));
    expect(part.status).toBe(200);
    const body = await part.text();
    expect(body).toContain('/release-a/products/0');
    expect(body).not.toContain('/release-b/products/0');
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });
});

it('checks explicitly shared contract packages before module execution', async () => {
  mockedFetch(() => Response.json(manifest({ runtime: { ...RUNTIME_VERSIONS, '@company/contracts': '1.2.0' } })));
  const session = createSession(options());
  await expect(session.load('catalog', 'ProductCard')).rejects.toMatchObject({ code: 'MF_SHARED_MISMATCH' });
  expect(federation.execute).not.toHaveBeenCalled();
  session.dispose();
  expect(() => createSession(options({ definitions: [{ ...definition, shared: { 'solid-js': { version: '1.9.15', module: {} } } }] }))).toThrow(expect.objectContaining({ code: 'MF_RESERVED_SHARED' }));
});

it('times out a stalled executable without publishing its late result', async () => {
  mockedFetch(url => Response.json(manifest({ server: url.startsWith('https://private.') })));
  let finish!: (value: unknown) => void;
  federation.execute.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const session = createSession(options({ timeoutMs: 10 }));
  await expect(session.load('catalog', 'ProductCard')).rejects.toMatchObject({ code: 'MF_TIMEOUT', status: 504 });
  finish({ default: () => 'late' });
  await Promise.resolve();
  expect(session.peek('catalog', 'ProductCard')).toBeUndefined();
  session.dispose();
});

it('resolves nested mounts once and keeps identities across parameter navigation', async () => {
  const remote = defineRemote<{ components: {} }>({ name: 'catalog', manifest: currentManifest, contract: '^1.0.0' });
  mockedFetch(url => Response.json(manifest({ exports: ['routes'], routes: true, server: url.startsWith('https://private.') })));
  federation.execute.mockImplementation(async (_manifest, name) => name === 'routes'
    ? { routes: [{ id: 'product', path: '/product/:id', component: () => 'product' }] }
    : { handlers: { product: { loader: () => ({ ok: true }) } } });
  const session = createSession(options({ definitions: [remote] }));
  const routes = [{ id: 'workspace', path: '/:workspace', component: () => null, children: [remote.routes({ path: '/Catalog' })] }];
  const [first, simultaneous] = await Promise.all([
    session.prepare(routes, '/team/catalog/product/camera'),
    session.prepare(routes, '/team/catalog/product/lens'),
  ]);
  expect(first[0].children![0].children![0].id).toBe('catalog__product');
  expect(first[0]).toBe(simultaneous[0]);
  expect((await session.prepare(routes, '/another/catalog/product/camera'))[0]).toBe(first[0]);
  expect(federation.execute).toHaveBeenCalledTimes(2);
  expect(session.handlers.catalog__product.loader).toBeTypeOf('function');
  session.dispose();
});
