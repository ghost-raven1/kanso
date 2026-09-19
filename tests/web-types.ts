import { defineRoutes, routeUrl, type RouteParams, type LoaderData, type ActionData } from '@kanso/app';
import { defineRouteHandlers, redirect } from '@kanso/app/server';
const Page = () => null;
const routes = defineRoutes([
  { id: 'home', path: '/', component: Page },
  { id: 'shop', path: '/shops/:shopId', component: Page, children: [
    { id: 'product', path: 'products/:productId', component: Page },
    { id: 'files', path: '*', component: Page },
  ] },
]);
const params: RouteParams<typeof routes, 'product'> = { shopId: 'one', productId: 'two' };
routeUrl(routes, 'product', params, new URLSearchParams({ sort: 'name' }));
routeUrl(routes, 'home', {});
routeUrl(routes, 'files', { shopId: 'one', rest: 'a/b' });
// @ts-expect-error Missing ancestor param.
routeUrl(routes, 'product', { productId: 'two' });
// @ts-expect-error Unknown route id.
routeUrl(routes, 'missing', {});
// @ts-expect-error Unknown param.
routeUrl(routes, 'home', { unknown: 'value' });
// @ts-expect-error Params are required.
routeUrl(routes, 'product');
const handlers = defineRouteHandlers(routes, {
  product: {
    loader: ({ params }) => {
      const shop: string = params.shopId;
      // @ts-expect-error The route does not declare this parameter.
      void params.other;
      if (shop === 'gone') return new Response(null, { status: 404 });
      return { name: params.productId, count: 2 };
    },
    action: async ({ params }) => params.productId === 'done' ? redirect('/') : { data: { saved: true }, values: { name: 'Ada' } },
  },
});
// @ts-expect-error A handler must belong to a known route.
defineRouteHandlers(routes, { missing: { loader: () => ({}) } });
const loaded: LoaderData<typeof handlers.product.loader> = { name: 'Book', count: 1 };
const saved: ActionData<typeof handlers.product.action> = { saved: true };
// @ts-expect-error Responses do not become loader data.
const response: LoaderData<typeof handlers.product.loader> = new Response();
// @ts-expect-error ActionData extracts the data payload.
const wrong: ActionData<typeof handlers.product.action> = { values: { name: 'Ada' } };
void [loaded, saved, response, wrong];
