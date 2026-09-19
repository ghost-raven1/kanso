# Web Workers

`@kanso/workers` moves computations into native module workers. Calls are typed,
concurrent and cancellable. The optional package has no React, Solid or server
runtime dependencies. Importing it or creating a client during SSR does not start
a worker.

For registration, offline caching and controlled updates, see
[Service Workers](./service-workers.md).

## Define tasks once

Put the implementation in a separate worker entry. Export the task object to
infer its input and result types; the application imports this export **as a
type**.

```ts
// search.worker.ts
import { exposeWorker, type WorkerContext } from '@kanso/workers/worker';

export const tasks = {
  async search(
    input: { query: string; items: string[] },
    { signal }: WorkerContext,
  ) {
    const matches: string[] = [];
    const query = input.query.toLowerCase();

    for (let offset = 0; offset < input.items.length; offset += 1000) {
      signal.throwIfAborted();
      matches.push(
        ...input.items
          .slice(offset, offset + 1000)
          .filter(item => item.toLowerCase().includes(query)),
      );
      // Yield to the worker event loop so cancellation can arrive.
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    return matches;
  },
};

exposeWorker(tasks);
```

Each task accepts one input, which can be an object, tuple, primitive or `undefined`,
and an optional second `WorkerContext` parameter. A task may return synchronously
or asynchronously. Input and output must support the browser's structured clone
algorithm. Runtime validation of external input belongs inside the task.

## Call from the application

```ts
import { createWorker } from '@kanso/workers';
import type { tasks } from './search.worker';

const search = createWorker<typeof tasks>(
  () => new Worker(new URL('./search.worker.ts', import.meta.url), {
    type: 'module',
    name: 'catalog-search',
  }),
);

const controller = new AbortController();
const matches = await search.call(
  'search',
  { query: 'camera', items: ['Camera', 'Tripod'] },
  { signal: controller.signal },
);
// matches: string[]

search.terminate();
```

Keep `new Worker(new URL(..., import.meta.url), { type: 'module' })` inside the
factory. Vite recognizes this native syntax and emits a separate worker bundle.
Customize the worker name, credentials and entry there; no Kanso configuration
is required. [Vite worker support](https://vite.dev/guide/features#web-workers).

The first `call` creates one worker. Concurrent calls share that worker and
resolve against their own request IDs even when results arrive out of order.
There is no worker pool or automatic retry. Create separate clients for separate
threads. Call workers from browser events or effects, not during SSR rendering.

## Cancellation and ownership

`controller.abort()` immediately rejects the corresponding client promise and
signals its task. Already aborted calls do not start a worker. The caller receives
the local `AbortSignal.reason`; the worker receives an aborted signal with the
standard abort reason. Late results are ignored.

Cancellation is cooperative. An uninterrupted CPU loop prevents the worker from
receiving messages; check the signal and yield between chunks. Terminating the
client stops the native worker immediately and rejects every pending call.
Pass `AbortSignal.timeout(milliseconds)` as the call's signal to impose a deadline.

Each component should own its client and release it on unmount:

```tsx
import { useEffect, useMemo } from '@kanso/core';
import { createWorker } from '@kanso/workers';
import type { tasks } from './search.worker';

function SearchPanel() {
  const search = useMemo(
    () => createWorker<typeof tasks>(
      () => new Worker(new URL('./search.worker.ts', import.meta.url), {
        type: 'module',
      }),
    ),
    [],
  );

  useEffect(() => () => search.terminate(), []);

  // Use search.call(...) from event handlers and handle rejected calls.
  return <section>Search</section>;
}
```

A terminated client stays closed. Explicitly create another client to restart;
pending work is never replayed. For a client owned by a development module, use
`import.meta.hot?.dispose(() => search.terminate())` as well. `exposeWorker()`
returns a disposer that removes its message listener and aborts active task
signals when embedding the protocol in an explicitly managed worker scope.

## Transfer large buffers

Use native transferables to move ownership without copying the same buffer twice:

```ts
// pixels.worker.ts
import { exposeWorker, type WorkerContext } from '@kanso/workers/worker';

export const tasks = {
  invert(pixels: Uint8Array, context: WorkerContext) {
    for (let i = 0; i < pixels.length; i++) pixels[i] = 255 - pixels[i];
    context.transfer(pixels.buffer as ArrayBuffer);
    return pixels;
  },
};

exposeWorker(tasks);

// Browser application
import { createWorker } from '@kanso/workers';
import type { tasks as pixelTasks } from './pixels.worker';

const worker = createWorker<typeof pixelTasks>(
  () => new Worker(new URL('./pixels.worker.ts', import.meta.url), {
    type: 'module',
  }),
);
const pixels = new Uint8Array([0, 127, 255]);
const result = await worker.call('invert', pixels, {
  transfer: [pixels.buffer],
});
// The original buffer is detached; result now owns the returned buffer.
worker.terminate();
```

Transferred objects must occur in the input or returned value. The `transfer`
option passes through to native `postMessage`; `context.transfer(...)` selects
objects for the response. Other cloneable values are copied normally.
[Native ownership transfer](https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage).

## Errors and verification

Task errors preserve their `name`, `message` and available stack. A task failure or
non-cloneable argument/result rejects only its call. A native worker `error` or
`messageerror` rejects pending calls and closes the client; restart explicitly
after handling the failure.

Run `npm run test:workers` after building the packages. The acceptance script
installs the packed package in a separate Vite project, checks its types, builds
production worker bundles, and verifies calls, cancellation, transfers, failures
and teardown in Chromium, Firefox and WebKit.
