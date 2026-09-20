import { afterEach, expect, it, vi } from 'vitest';
import { browserModule } from './helpers.js';
import { installDOM } from './dom-environment.js';
installDOM();
afterEach(() => vi.unstubAllGlobals());
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
it('keeps navigation alive when revalidation overlaps route preparation', async () => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (request: string) => {
    const url = new URL(request, 'http://localhost').searchParams.get('url');
    calls.push(url!);
    return Response.json({
      version: 1,
      buildId: 'test',
      url,
      data: { page: { url } },
    });
  });
  const api = await browserModule<{
    start(): {
      go(): void;
      refresh(): Promise<void>;
      release(): void;
      read(): unknown;
      dispose(): void;
    };
  }>(`
    import { createRoot, createSignal } from 'solid-js';
    import { createRouteData } from '@kanso/app/data';
    export function start() {
      return createRoot(dispose => {
        const [url, setUrl] = createSignal('/');
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const data = createRouteData(url, {version:1,buildId:'test',url:'/',data:{}}, () => gate);
        return { go: () => setUrl('/two'), refresh: data.revalidator.revalidate, release, read: data.snapshot, dispose };
      });
    }
  `);
  const app = api.start();
  try {
    app.go();
    const refreshing = app.refresh();
    app.release();
    await refreshing;
    await tick();
    expect(calls).toContain('/two');
    expect(app.read()).toMatchObject({ url: '/two' });
  } finally {
    app.dispose();
  }
});
