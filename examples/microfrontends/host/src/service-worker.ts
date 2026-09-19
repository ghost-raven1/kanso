import {
  defineServiceWorker,
  installServiceWorker,
} from '@kanso/workers/service-runtime';

/** Cache only immutable host assets; documents, forms and remote manifests stay on the network. */
installServiceWorker(
  defineServiceWorker({
    name: 'microfrontend-demo',
    version: import.meta.env.KANSO_SERVICE_WORKER_BUILD_ID,
    routes: [
      {
        match: ({ url }) => url.pathname.startsWith('/assets/'),
        strategy: 'cache-first',
      },
    ],
  }),
);
