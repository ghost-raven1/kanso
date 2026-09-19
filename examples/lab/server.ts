import { createRequestHandler } from '@kanso/app/server';
import { handlers, sitemapEntries } from './handlers.server';
import { routes } from './routes';
import { seo } from './seo.config';

export const buildId = __KANSO_BUILD_ID__;
export const createHandler = (assets: { entry: string; styles?: string[] }) => createRequestHandler({
  routes, handlers, buildId, assets, seo, sitemap: { entries: sitemapEntries },
  context: request => ({ requestId: request.headers.get('X-Request-Id') ?? crypto.randomUUID() }),
});
