import { createRequestHandler } from '@kanso/app/server';
import { routes } from './routes';
import { microfrontends } from './remotes';
import { seo } from './seo';
import type { RemoteSource } from '@kanso/app/integration';

export const buildId = import.meta.env.KANSO_HOST_BUILD_ID;

export function createHandler(
  assets: { entry: string; styles?: string[] },
  remoteSources?: Record<string, RemoteSource>,
) {
  return createRequestHandler({
    routes,
    microfrontends,
    seo,
    assets,
    buildId,
    remoteSources: {
      catalog: {
        manifest: `${process.env.KANSO_CATALOG_SERVER_ORIGIN ?? 'http://127.0.0.1:4301'}/releases/{buildId}/kanso-server.json`,
      },
      promotion: {
        manifest: `${process.env.KANSO_PROMOTION_SERVER_ORIGIN ?? 'http://127.0.0.1:4302'}/releases/{buildId}/kanso-server.json`,
      },
      ...remoteSources,
    },
    context: request => ({ user: request.headers.get('X-User') ?? 'guest' }),
  });
}
