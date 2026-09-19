import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { remoteResources } from '../packages/vite/src/remote-resources.js';
import { RUNTIME_VERSIONS, validateManifest, type RemoteManifest } from '../packages/microfrontends/src/manifest.js';

const federation = vi.hoisted(() => ({ load: vi.fn(), create: vi.fn() }));
vi.mock('@module-federation/runtime', () => ({ createInstance: federation.create }));
vi.mock('@kanso/core/hmr', () => ({}));

const manifest = (resources?: Record<string, string[]>): RemoteManifest => ({
  schema: 1, name: 'catalog', buildId: 'A', contract: '1.0.0', runtime: { ...RUNTIME_VERSIONS },
  exports: ['Card'], entry: 'https://cdn.example.test/releases/A/entry.js', styles: [], preloads: [],
  ...(resources ? { resources } : {}),
});
const definition = { name: 'catalog', contract: '^1.0.0' };
const chunk = (fileName: string, imports: string[] = [], moduleIds: string[] = [], dynamicImports: string[] = []) => ({ type: 'chunk', fileName, imports, moduleIds, dynamicImports });

beforeEach(() => {
  vi.resetModules();
  federation.create.mockReset().mockReturnValue({ loadRemote: federation.load });
  federation.load.mockReset().mockResolvedValue({ default: 'Remote component' });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('remote resource metadata', () => {
  it('records the selected export and static dependencies plus federation startup, without other dynamic exports', () => {
    const result = remoteResources({
      'remoteEntry.js': chunk('remoteEntry.js', ['runtime.js'], [], ['Card.js', 'Other.js', 'localSharedImportMap.js']),
      'runtime.js': chunk('runtime.js', ['helper.js']),
      'helper.js': chunk('helper.js', ['runtime.js']),
      'localSharedImportMap.js': chunk('localSharedImportMap.js', ['helper.js']),
      'Card.js': { ...chunk('Card.js', ['shared.js']), facadeModuleId: '/app/src/Card.tsx' },
      'shared.js': chunk('shared.js'),
      'Other.js': chunk('Other.js', [], ['/app/src/Other.tsx']),
      'style.css': { type: 'asset', fileName: 'style.css' },
    }, '/app', { Card: 'src/Card.tsx', Other: 'src/Other.tsx' }, file => `https://cdn.test/A/${file}`);
    expect(result.Card).toEqual(['Card.js', 'helper.js', 'localSharedImportMap.js', 'remoteEntry.js', 'runtime.js', 'shared.js'].map(file => `https://cdn.test/A/${file}`));
    expect(result.Other).not.toContain('https://cdn.test/A/Card.js');
    expect(result.Other).not.toContain('https://cdn.test/A/shared.js');
  });

  it('fails a build if a declared export has no executable output', () => {
    expect(() => remoteResources({ 'remoteEntry.js': chunk('remoteEntry.js') }, '/app', { Card: 'missing.tsx' }, file => file)).toThrow('Cannot locate');
  });

  it('normalizes and deduplicates optional resource URLs', () => {
    const result = validateManifest(manifest({ Card: ['./Card.js', './Card.js', '/shared.js'] }), definition, 'https://cdn.test/A/kanso-remote.json');
    expect(result.resources).toEqual({ Card: ['https://cdn.test/A/Card.js', 'https://cdn.test/shared.js'] });
    expect(validateManifest(manifest(), definition, 'https://cdn.test/A/manifest.json').resources).toBeUndefined();
  });

  it.each([null, [], 'bad', { Card: 'not-array' }, { Unknown: [] }])('rejects malformed resources %j', resources => {
    expect(() => validateManifest({ ...manifest(), resources }, definition, 'https://cdn.test/manifest.json')).toThrow(expect.objectContaining({ code: 'MF_INVALID_MANIFEST' }));
  });

  it.each(['file:///tmp/code.js', 'javascript:alert(1)', 'https://user:secret@cdn.test/code.js', 1])('rejects unsafe resource URL %j', url => {
    expect(() => validateManifest({ ...manifest(), resources: { Card: [url] } }, definition, 'https://cdn.test/manifest.json')).toThrow(expect.objectContaining({ code: 'MF_INVALID_URL' }));
  });
});

describe('browser resource preparation', () => {
  it('fully downloads shared resources before execution and deduplicates concurrent and successful downloads', async () => {
    let finish!: () => void;
    const body = new Promise<ArrayBuffer>(resolve => { finish = () => resolve(new ArrayBuffer(0)); });
    const fetcher = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => body });
    vi.stubGlobal('fetch', fetcher);
    const { loadModule } = await import('../packages/microfrontends/src/browser.js');
    const value = manifest({ Card: ['https://cdn.test/chunk.js'] });
    const first = loadModule(value, 'Card', {});
    const second = loadModule(value, 'Card', {});
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(federation.create).not.toHaveBeenCalled();
    finish();
    await Promise.all([first, second]);
    await loadModule(value, 'Card', {});
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith('https://cdn.test/chunk.js', expect.objectContaining({ cache: 'force-cache', mode: 'cors' }));
  });

  it('removes a failed request so explicit recovery can load the same immutable URL', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('missing', { status: 404 })).mockResolvedValue(new Response('export {};'));
    vi.stubGlobal('fetch', fetcher);
    const { loadModule } = await import('../packages/microfrontends/src/browser.js');
    const value = manifest({ Card: ['https://cdn.test/chunk.js'] });
    await expect(loadModule(value, 'Card', {})).rejects.toMatchObject({ code: 'MF_RESOURCE_UNAVAILABLE', status: 503 });
    expect(federation.create).not.toHaveBeenCalled();
    await expect(loadModule(value, 'Card', {})).resolves.toEqual({ default: 'Remote component' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('times out a stalled download without executing remote code', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    })));
    const { loadModule } = await import('../packages/microfrontends/src/browser.js');
    const pending = expect(loadModule(manifest({ Card: ['https://cdn.test/stalled.js'] }), 'Card', {})).rejects.toMatchObject({ code: 'MF_RESOURCE_UNAVAILABLE', status: 504 });
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(federation.create).not.toHaveBeenCalled();
  });
});
