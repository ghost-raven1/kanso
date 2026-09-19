# Service workers

Kanso 0.6 includes optional service-worker tools in `@kanso/workers/service` and
`@kanso/workers/service-runtime`. Importing them does not register a worker, change
navigation, or add caching to an application. They work independently of routing
and microfrontends. For background calculations, see [Web workers](workers.md).

## Build and register

Configure a separate TypeScript entry. Kanso emits a classic, self-contained
`service-worker.js`, compatible with browsers that do not support module service
workers. The worker does not include the app's JSX compiler or HMR runtime.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import kanso from '@kanso/vite';

export default defineConfig({
  plugins: [
    kanso({
      serviceWorker: {
        entry: 'src/service-worker.ts',
      },
    }),
  ],
});
```

```ts
// src/service-worker.ts
import {
  defineServiceWorker,
  installServiceWorker,
} from '@kanso/workers/service-runtime';

installServiceWorker(
  defineServiceWorker({
    version: import.meta.env.KANSO_SERVICE_WORKER_BUILD_ID,
    name: 'catalog',
    routes: [
      {
        match: ({ url }) => url.pathname.startsWith('/assets/'),
        strategy: 'cache-first',
      },
    ],
  }),
);
```

Use an immutable build ID for the cache version. The plugin supplies
`KANSO_SERVICE_WORKER_BUILD_ID` from Kanso's `buildId`, `KANSO_BUILD_ID`, or the
client build contents. File names under `/assets/` should contain content hashes;
changing an asset must change its URL.

Register once from the client entry. The virtual URL respects Vite's `base` and
is `undefined` when development registration is disabled.

Include `@kanso/vite/client` alongside `vite/client` in `compilerOptions.types`,
or add `/// <reference types="@kanso/vite/client" />` to an included `.d.ts` file.
It declares the virtual module and `KANSO_SERVICE_WORKER_BUILD_ID` for TypeScript.

```ts
import { createServiceWorker } from '@kanso/workers/service';
import { serviceWorkerUrl } from 'virtual:kanso/service-worker';

export const serviceWorker = createServiceWorker(serviceWorkerUrl);

serviceWorker.subscribe(({ status, error }) => {
  if (status === 'update-available') showUpdateButton();
  if (status === 'error') showRegistrationError(error);
});

await serviceWorker.register();
```

`createServiceWorker()` is safe during SSR and performs no browser work.
An undefined URL or `enabled: false` gives status `disabled`; otherwise a missing
browser service-worker API gives `unsupported`. Other options are native `scope`, `type`
and `updateViaCache`; defaults are `classic` and `none` for the latter two.
The default scope is the worker script's directory. HTTPS or localhost is
required by the browser.

## Show updates without losing an open page

The controller exposes its current `state` as a readonly typed snapshot and immediately
notifies new subscribers. Statuses are `disabled`, `unsupported`, `idle`,
`registering`, `installing`, `ready`, `update-available`, `activating`, `error` and
`disposed`. The snapshot includes the native registration when available and
the registration error on failure.

```ts
// Called from the user's explicit “Use update” button.
serviceWorker.activateUpdate();

// Check for a new worker, for example from a “Check updates” command.
await serviceWorker.update();
```

`activateUpdate()` returns whether an activation request was sent. It asks the
waiting worker to activate; it **does not reload the page**. Kanso does not call
`clients.claim()` or delete old release caches automatically. The initial
registration begins controlling pages through the browser's normal lifecycle,
usually on their next navigation.

Effects can subscribe to a shared controller and clean up their subscription:

```tsx
import { useEffect, useState } from '@kanso/core';
import { serviceWorker } from './service-registration';

export function UpdateNotice() {
  const [status, setStatus] = useState(serviceWorker.state.status);

  useEffect(() => {
    return serviceWorker.subscribe(state => setStatus(state.status));
  }, []);

  return (
    <aside>
      {status === 'update-available' && (
        <button onClick={() => serviceWorker.activateUpdate()}>
          Activate update
        </button>
      )}
    </aside>
  );
}
```

At application shutdown, `dispose()` removes the controller's listeners without
uninstalling the worker. `unregister()` explicitly removes its registration and
returns the browser's result. Neither method clears Cache Storage. Do not
unregister a shared shell worker when an individual microfrontend unmounts.

## Choose what may be cached

Routes are evaluated in declaration order; the first matching route wins. Only
explicit static matches are intercepted. Supported strategies are:

| Strategy | Behavior |
| --- | --- |
| `cache-first` | Serve the exact cached URL, otherwise fetch and store a public response. Suitable for immutable assets. |
| `network-first` | Fetch first; fall back to the same cached URL after a network failure or a server `5xx` response. |
| `stale-while-revalidate` | Serve an existing cached response while refreshing it in the background. |

The helper always bypasses non-GET requests, document/JSON caching, Kanso's
`/_kanso/` endpoints, and `/api/`, `/auth/`, `/login/`, `/logout/`, `/account/`
path segments. Authorization, range, `no-store`, `no-cache` and `reload` requests bypass the cache.
Unknown resource types are left alone. Responses must be successful, readable
and non-redirected; `private`, `no-store`, `no-cache`, `Set-Cookie`, `Vary: *`,
HTML and JSON responses are not stored by static routes. Cache write/quota
failures preserve a successful network response.

Cross-origin assets need an explicit origin and a readable CORS response:

```ts
routes: [
  {
    origins: ['https://cdn.example.com'],
    match: ({ url }) => url.pathname.startsWith('/releases/'),
    strategy: 'cache-first',
  },
],
```

Microfrontend manifests and mutable release pointers must reach the network.
Cache immutable, versioned release assets only. URLs retain their complete
query string; a cache lookup never substitutes a different build. Old caches
remain available until the application deliberately removes versions that are
no longer in use.

## Precache and offline fallback

`precache` downloads explicit same-origin public static URLs during installation
and serves them with `cache-first`. Installation fails if a required resource
fails or has a response that must not be cached. An optional offline HTML file
is the only document cached by the helper:

```ts
defineServiceWorker({
  version: import.meta.env.KANSO_SERVICE_WORKER_BUILD_ID,
  precache: ['/assets/offline.82a1.svg'],
  offlineFallback: '/offline.html',
});
```

The fallback must be a same-origin, public, self-contained document. Serve it
without `private` or `no-store` response directives. With this option enabled,
navigation still goes to the network; the fallback is returned only if the
network request fails. Successful HTML, redirects, errors and personalized
pages are never placed in the cache. Offline loaders and actions fail normally;
the helper does not queue or replay submissions.

## Customize lifecycle and development

`onInstall(context)`, `onActivate(context)` and `onMessage(event, context)` can
perform application-specific work. Promises extend the native event lifetime.
The context contains the exact versioned `cacheName` and native `scope`; message
events include their source for replies. The internal
`kanso:activate-update` message is reserved for explicit activation.
`installServiceWorker()` returns a listener disposer, useful for tests.

Workers are disabled in development by default. To test them deliberately:

```ts
kanso({
  serviceWorker: {
    entry: 'src/service-worker.ts',
    fileName: 'service-worker.js',
    dev: true,
  },
});
```

The development endpoint compiles the worker entry on request without injecting
HMR. Update checks and activation remain explicit. Use a dedicated development
origin for offline tests and unregister its worker when finished. Configurations
without `serviceWorker` emit no worker or registration code; SSR builds do not
emit a client worker.

See the browser contracts for [registration](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)
and [explicit activation](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting).
