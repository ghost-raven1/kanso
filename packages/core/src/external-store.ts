import {
  createComputed,
  createMemo,
  createSignal,
  getOwner,
  onCleanup,
  onMount,
  sharedConfig,
  untrack,
  type Accessor,
} from 'solid-js';
import { isServer } from 'solid-js/web';

/** A native subscription contract, compatible with immutable vanilla stores. */
export interface ExternalStore<T> {
  getState(): T;
  subscribe(listener: () => void): () => void;
  /** Optional deterministic value for server rendering and the first hydration pass. */
  getServerSnapshot?(): T;
}
export type StoreSelector<T, U> = (state: T) => U;
export type StoreEquality<T> = (previous: T, next: T) => boolean;

/** Compiler runtime: subscriptions follow the owner and a reactive store replacement. */
export function storeValue<T, U = T>(
  readStore: Accessor<ExternalStore<T>>,
  readSelector: Accessor<StoreSelector<T, U> | undefined> = () => undefined,
  readEquality: Accessor<StoreEquality<U> | undefined> = () => undefined,
): Accessor<U> {
  if (!getOwner())
    throw new Error(
      'KANSO_STORE_OWNER: useStore requires a component or createRoot owner.',
    );
  const store = createMemo(readStore);
  const [revision, change] = createSignal(0);
  const [hydrating, finishHydration] = createSignal(
    !isServer && !!sharedConfig.context,
  );
  const selected = createMemo(
    () => {
      revision();
      const source = store();
      const snapshot =
        (isServer || hydrating()) && source.getServerSnapshot
          ? source.getServerSnapshot()
          : source.getState();
      const selector = readSelector();
      return selector ? selector(snapshot) : (snapshot as unknown as U);
    },
    undefined,
    {
      equals: (previous, next) => (readEquality() ?? Object.is)(previous, next),
    },
  );
  if (!isServer) {
    const subscribe = () =>
      createComputed(() => {
        const source = store();
        let active = true;
        const notify = () => {
          if (active) change(value => value + 1);
        };
        const unsubscribe = untrack(() => source.subscribe(notify));
        onCleanup(() => {
          active = false;
          unsubscribe();
        });
        // Close the read/subscribe gap, including stores that change during registration.
        untrack(notify);
      });
    if (hydrating())
      onMount(() => {
        subscribe();
        finishHydration(false);
      });
    else subscribe();
  }
  return selected;
}

/** Select a live value without re-executing the component; compiled by Kanso. */
export function useStore<T>(store: ExternalStore<T>): T;
export function useStore<T, U>(
  store: ExternalStore<T>,
  selector: StoreSelector<T, U>,
  equals?: StoreEquality<U>,
): U;
export function useStore(): never {
  throw new Error(
    'Kanso compiler is required for useStore. Add kanso() to Vite plugins.',
  );
}
