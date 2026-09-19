import { afterEach, expect, it, vi } from 'vitest';
import { browserModule } from './helpers.js';
import { installDOM } from './dom-environment.js';
import { compile } from '@kanso/compiler';
import type { FormState, Revalidator } from '@kanso/app';
installDOM();
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; window.history.replaceState(null, '', '/'); });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const snapshot = (name: string) => Response.json({ version: 1, buildId: 'test', url: '/', data: { home: { name } } });

async function fixture(path = '/', url = '/') {
  window.scrollTo = () => {};
  return browserModule<{ run: (root: HTMLElement) => () => void; controls: { form: FormState; revalidator: Revalidator; navigate: (url: string) => void }; setups: number }>(`
    import { App, defineRoutes, useForm, useLoaderData, useRevalidator, useNavigate } from '@kanso/app';
    import { mount } from '@kanso/core/client';
    export const controls = {};
    export let setups = 0;
    function Home() {
      setups++;
      const form = useForm({ id: 'test' });
      const revalidator = useRevalidator();
      const navigate = useNavigate();
      const { name } = useLoaderData();
      controls.form = form; controls.revalidator = revalidator; controls.navigate = navigate;
      return <><output>{name}</output><span>{form.phase}</span><p>{form.errors.name}</p></>;
    }
    const routes = defineRoutes([{id:'home',path:${JSON.stringify(path)},component:Home}]);
    const bootstrap = {version:1,buildId:'test',url:${JSON.stringify(url)},data:{home:{name:'old'}}};
    export const run = root => mount(() => <App routes={routes} bootstrap={bootstrap}/>, root);
  `);
}
function transport() {
  const calls: { url: string; signal?: AbortSignal | null; resolve: (response: Response) => void }[] = [];
  vi.stubGlobal('fetch', (url: string, options: RequestInit) => new Promise<Response>(resolve => calls.push({ url, signal: options.signal, resolve })));
  return calls;
}

it('awaits revalidation, preserves successful data on failure, and retries only loaders', async () => {
  const calls = transport();
  const app = await fixture(); const dispose = app.run(document.body); await tick();
  expect(calls).toHaveLength(0);
  const submitted = app.controls.form.submit(new FormData());
  expect(app.controls.form.phase).toBe('submitting');
  calls[0].resolve(Response.json({ data: { saved: true } })); await tick();
  expect(app.controls.form.phase).toBe('revalidating');
  expect(app.controls.form.pending).toBe(true);
  expect(document.querySelector('output')?.textContent).toBe('old');
  calls[1].resolve(new Response('failed', { status: 500 })); await submitted;
  expect(app.controls.form.pending).toBe(false);
  expect(app.controls.form.data).toEqual({ saved: true });
  expect(app.controls.form.error).toBeUndefined();
  expect(app.controls.revalidator.error?.message).toContain('500');
  expect(document.querySelector('output')?.textContent).toBe('old');
  const retry = app.controls.revalidator.revalidate(); await tick();
  calls[2].resolve(snapshot('fresh')); await retry;
  expect(document.querySelector('output')?.textContent).toBe('fresh');
  expect(app.controls.revalidator.error).toBeUndefined();
  expect(calls.filter(call => call.url.includes('/action/'))).toHaveLength(1);
  expect(app.setups).toBe(1); dispose();
});

it('cancels submissions when params change while the component remains mounted', async () => {
  window.history.replaceState(null, '', '/products/one');
  const calls = transport();
  const app = await fixture('/products/:id', '/products/one');
  const dispose = app.run(document.body); await tick();
  const submitted = app.controls.form.submit(new FormData());
  app.controls.navigate('/products/two'); await tick();
  expect(calls[0].signal?.aborted).toBe(true);
  calls[1].resolve(Response.json({ version: 1, buildId: 'test', url: '/products/two', data: { home: { name: 'two' } } }));
  await tick();
  calls[0].resolve(Response.json({ errors: { name: 'from one' } }, { status: 422 })); await submitted;
  expect(app.controls.form.errors).toEqual({});
  expect(document.querySelector('output')?.textContent).toBe('two');
  expect(app.setups).toBe(1); dispose();
});

it('ignores stale submissions and late results after owner disposal', async () => {
  const calls = transport();
  const app = await fixture(); const dispose = app.run(document.body); await tick();
  const first = app.controls.form.submit(new FormData());
  const second = app.controls.form.submit(new FormData());
  expect(calls[0].signal?.aborted).toBe(true);
  calls[1].resolve(Response.json({ errors: { name: 'current' }, values: { name: 'new' } }, { status: 422 })); await second;
  calls[0].resolve(Response.json({ errors: { name: 'stale' } }, { status: 422 })); await first;
  expect(app.controls.form.errors.name).toBe('current');
  expect(app.controls.form.values.name).toBe('new');
  const last = app.controls.form.submit(new FormData()); dispose();
  expect(calls[2].signal?.aborted).toBe(true);
  calls[2].resolve(Response.json({ data: { saved: true } })); await last;
  expect(calls).toHaveLength(3);
});

it('lifts router reads and imported routeUrl by binding, retaining handler snapshots', () => {
  const output = compile(`
    import { useParams, useLocation, routeUrl as href } from '@kanso/app';
    function Product() {
      const { id } = useParams(); const location = useLocation();
      const current = href(routes, 'product', { id }); const search = location.search;
      const click = () => { const snapshot = id; setTimeout(() => console.log(snapshot), 1); };
      return <a href={current} onClick={click}>{search}</a>;
    }
  `).code;
  expect(output).toContain('__derived');
  expect(output).toMatch(/href\(routes/);
  expect(() => compile(`import { useParams, routeUrl } from '@kanso/app';
    function Product({routeUrl}) { const params = useParams(); const link = routeUrl(params.id); return <a href={link}/>; }
  `)).toThrow('KANSO_PURITY');
});
