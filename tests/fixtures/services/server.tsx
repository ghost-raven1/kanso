import { createRequestHandler } from '@kanso/app/server';
import { routes, settings } from './app';

export { trace } from './app';
export let loads = 0;

export const handle = createRequestHandler({
  routes,
  buildId: 'services-fixture',
  assets: { entry: '/client.js' },
  handlers: {
    page: {
      loader: ({ services, params }) => {
        loads++;
        services.get(settings).setState({ name: params.name, count: 3 });
        return {};
      },
    },
  },
});
