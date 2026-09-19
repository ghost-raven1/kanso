import { createRequestHandler } from '@kanso/app/server';
import { routes } from './routes';
import { createHandlers } from './handlers.server';
import { products } from './catalog/products.server';
import { seo } from './seo.config';
import { routeUrl } from '@kanso/app';
export const buildId = __KANSO_BUILD_ID__;
const handlers = createHandlers();
export const createHandler = (assets: { entry: string; styles?: string[] }) =>
  createRequestHandler({
    routes,
    handlers,
    seo,
    buildId,
    assets,
    sitemap: {
      entries: () =>
        products.map(product => ({
          url: routeUrl(routes, 'product', { productId: product.id }),
        })),
    },
  });
