import { createStore } from 'zustand/vanilla';
import { useEffect, useService, useStore, defineService } from '@kanso/core';
import { defineRoutes, Link, useRevalidator } from '@kanso/app';

export interface State {
  name: string;
  count: number;
}
export const trace = {
  factories: 0,
  bodies: 0,
  subscriptions: 0,
  effects: 0,
  cleanup: 0,
};
const external = {
  getState: () => 900,
  getServerSnapshot: () => 42,
  subscribe: (_listener: () => void) => () => {},
};

function ServerSnapshot() {
  const value = useStore(external);
  return <output id="server-snapshot">{value}</output>;
}

function makeStore(initial: State) {
  const store = createStore<State>(() => initial);
  const subscribe = store.subscribe;
  store.subscribe = listener => {
    trace.subscriptions++;
    const unsubscribe = subscribe(listener);
    return () => {
      trace.subscriptions--;
      unsubscribe();
    };
  };
  return store;
}

export const settings = defineService<ReturnType<typeof makeStore>, State>({
  id: 'settings',
  create: ({ snapshot, onCleanup }) => {
    trace.factories++;
    onCleanup(() => {
      trace.cleanup++;
    });
    return makeStore(snapshot ?? { name: 'client fallback', count: 0 });
  },
  snapshot: store => store.getState(),
  restore: (store, snapshot) => store.setState(snapshot, true),
});

function Count() {
  trace.bodies++;
  const store = useService(settings);
  const count = useStore(store, value => value.count);
  useEffect(() => {
    trace.effects++;
  }, [count]);
  return (
    <button data-count onClick={() => store.setState({ count: count + 1 })}>
      {count}
    </button>
  );
}

export function Page() {
  const store = useService(settings);
  const name = useStore(store, value => value.name);
  const refresh = useRevalidator();
  return (
    <main>
      <ServerSnapshot />
      <h1 id="name">{name}</h1>
      <input id="draft" aria-label="Draft" />
      <Count />
      <Count />
      <button id="rename" onClick={() => store.setState({ name: 'renamed' })}>
        Rename
      </button>
      <button id="refresh" onClick={() => void refresh.revalidate()}>
        Refresh
      </button>
      <output id="refresh-status">
        {refresh.pending ? 'pending' : 'idle'}
      </output>
      <output id="refresh-error">{refresh.error?.message}</output>
      <Link href="/one">One</Link>
      <Link href="/two">Two</Link>
      <Link href="/slow">Slow</Link>
    </main>
  );
}

export const routes = defineRoutes([
  { id: 'page', path: '/:name', component: Page },
]);
