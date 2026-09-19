import { createRequestHandler } from '@kanso/app/server';
import { handlers } from './handlers.server';
import { routes } from './routes';

export const buildId = __KANSO_BUILD_ID__;
export const createHandler = (assets: { entry: string; styles?: string[] }) => createRequestHandler({
  routes, handlers, buildId, assets,
  context: request => ({ requestId: request.headers.get('X-Request-Id') ?? crypto.randomUUID() }),
});
