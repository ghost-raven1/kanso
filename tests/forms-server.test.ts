import { describe, expect, it } from 'vitest';
import { createComponent } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { JSDOM } from 'jsdom';
import { defineRoutes, routeUrl, useForm, Form } from '@kanso/app';
import { createRequestHandler, redirect } from '@kanso/app/server';

function Fields(props: { id?: string }) {
  const form = props.id ? useForm({ id: props.id }) : useForm();
  return createComponent(Form, {
    state: form, className: 'request-form', 'aria-label': props.id ?? 'generated',
    get children() { return [
      createComponent(Dynamic, { component: 'input', name: 'name', value: form.values.name ?? '' }),
      createComponent(Dynamic, { component: 'p', role: 'alert', children: form.errors.name ?? form.formError ?? '' }),
      createComponent(Dynamic, { component: 'output', children: form.data ? 'Saved' : '' }),
    ]; },
  });
}
function Page() { return [createComponent(Fields, { id: 'first' }), createComponent(Fields, { id: 'second' }), createComponent(Fields, {})]; }
const routes = defineRoutes([{ id: 'shop', path: '/shops/:shopId', component: props => props.children, children: [
  { id: 'product', path: 'products/:productId', component: Page, cache: { public: true, ttlMs: 10000 } },
] }]);
const config = { routes, buildId: 'forms', assets: { entry: '/client.js' } };
const url = 'http://localhost/shops/one/products/two?ref=search';
const post = (fields: Record<string, string> = {}, target = url) => new Request(target, {
  method: 'POST', body: new URLSearchParams({ __kanso_route: 'product', __kanso_form: 'first', name: 'Ada', secret: 'never-reflect', ...fields }),
  headers: { Origin: 'http://localhost', 'X-Kanso-Location': '/shops/one/products/two?ref=search' },
});
const document = (html: string) => new JSDOM(html).window.document;

describe('native and enhanced form contracts', () => {
  it('builds typed nested URLs with encoded params, splats and query values', () => {
    expect(routeUrl(routes, 'product', { shopId: 'A B', productId: 'x/y' }, new URLSearchParams([['q', 'a&b'], ['q', 'c']]))).toBe('/shops/A%20B/products/x%2Fy?q=a%26b&q=c');
  });
  it('returns 422 HTML scoped to one form and uses the same page request for JSON', async () => {
    const seen: unknown[] = [];
    const handler = createRequestHandler({ ...config, context: () => ({ request: 'scoped' }), handlers: { product: {
      action: async ({ request, params, context, signal }) => {
        seen.push({ url: request.url, params, context, aborted: signal.aborted });
        const fields = await request.formData();
        return { errors: { name: 'Choose another name' }, values: { name: String(fields.get('name')) }, formError: 'Check the form' };
      },
    } } });
    const response = await handler(post({ name: '</script><script>bad()</script>' }));
    expect(response.status).toBe(422);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const html = await response.text();
    expect(html).not.toContain('never-reflect');
    expect([...document(html).querySelectorAll('script:not([type="application/json"])')].some(script => script.textContent?.includes('bad()'))).toBe(false);
    const doc = document(html);
    const forms = [...doc.querySelectorAll('form')];
    expect(forms).toHaveLength(3);
    expect(forms.map(form => form.getAttribute('action'))).toEqual(Array(3).fill('/shops/one/products/two?ref=search'));
    expect(forms[0].querySelector<HTMLInputElement>('[name="name"]')?.value).toBe('</script><script>bad()</script>');
    expect(forms[1].querySelector<HTMLInputElement>('[name="name"]')?.value).toBe('');
    expect(forms[0].textContent).toContain('Choose another name');
    expect(forms[1].textContent).not.toContain('Choose another name');
    const json = await handler(post({}, 'http://localhost/_kanso/action/product'));
    expect(json.status).toBe(422);
    expect(await json.json()).toMatchObject({ errors: { name: 'Choose another name' }, values: { name: 'Ada' } });
    expect(seen).toEqual(Array(2).fill({ url, params: { shopId: 'one', productId: 'two' }, context: { request: 'scoped' }, aborted: false }));
  });
  it('reuses generated form identities and isolates parallel validation responses', async () => {
    const handler = createRequestHandler({ ...config, handlers: { product: { action: async ({ request }) => {
      const fields = await request.formData();
      return { errors: { name: String(fields.get('name')) }, values: { name: String(fields.get('name')) } };
    } } } });
    const doc = document(await (await handler(new Request(url))).text());
    const generated = doc.querySelector<HTMLInputElement>('form[aria-label="generated"] [name="__kanso_form"]')!.value;
    const responses = await Promise.all(['one', 'two'].map(name => handler(post({ name, __kanso_form: generated }))));
    const docs = await Promise.all(responses.map(async response => document(await response.text())));
    expect(docs.map(doc => doc.querySelector<HTMLInputElement>('form[aria-label="generated"] [name="name"]')?.value)).toEqual(['one', 'two']);
  });
  it('rejects unknown, ambiguous, inactive and cross-origin actions before mutation', async () => {
    let writes = 0;
    const handler = createRequestHandler({ ...config, handlers: { product: { action: () => { writes++; return {}; } } } });
    expect((await handler(post({ __kanso_route: 'outside' }))).status).toBe(400);
    expect((await handler(new Request(url, { method: 'POST', body: '__kanso_route=product' }))).status).toBe(400);
    const evil = post(); evil.headers.set('Origin', 'https://evil.test');
    expect((await handler(evil)).status).toBe(403);
    const duplicate = post(); const body = await duplicate.text();
    expect((await handler(new Request(url, { method: 'POST', body: body + '&__kanso_form=second', headers: duplicate.headers }))).status).toBe(400);
    expect(writes).toBe(0);
  });
  it('never caches POST and invalidates GET only after successful actions', async () => {
    let loads = 0;
    const handler = createRequestHandler({ ...config, handlers: { product: {
      loader: () => ({ count: ++loads }),
      action: async ({ request }) => (await request.formData()).get('name') === 'invalid' ? { errors: { name: 'Invalid' } } : { data: { saved: true } },
    } } });
    await handler(new Request(url)); await handler(new Request(url)); expect(loads).toBe(1);
    expect((await handler(post({ name: 'invalid' }))).status).toBe(422); expect(loads).toBe(2);
    await handler(new Request(url)); expect(loads).toBe(2);
    const saved = await handler(post()); expect(saved.status).toBe(200); expect(await saved.text()).toContain('Saved'); expect(loads).toBe(3);
    await handler(new Request(url)); expect(loads).toBe(4);
    await handler(post()); expect(loads).toBe(5);
  });
  it('preserves PRG redirects, cookies, HEAD and explicit error statuses', async () => {
    for (const thrown of [false, true]) {
      const handler = createRequestHandler({ ...config, handlers: { product: { action: () => {
        const response = redirect('/done', 303, { 'Set-Cookie': 'request=ok; HttpOnly' });
        if (thrown) throw response;
        return response;
      } } } });
      const native = await handler(post());
      expect(native.status).toBe(303); expect(native.headers.get('Location')).toBe('/done');
      expect(native.headers.get('Set-Cookie')).toContain('HttpOnly');
      const enhanced = await handler(post({}, 'http://localhost/_kanso/action/product'));
      expect(enhanced.status).toBe(200); expect(enhanced.headers.get('X-Kanso-Redirect')).toBe('/done');
      expect(await (await handler(new Request(url, { method: 'HEAD' }))).text()).toBe('');
    }
    const failure = createRequestHandler({ ...config, handlers: { product: { action: () => new Response('Conflict', { status: 409 }) } } });
    expect((await failure(post())).status).toBe(409);
  });
});
