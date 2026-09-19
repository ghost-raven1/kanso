import {
  createEffect, createMemo, createSignal, createUniqueId, getOwner, onCleanup, untrack,
  type Accessor,
} from 'solid-js';
import type { DependencyList, StateSetter, Effect, Ref } from './types.js';

function ownerRequired(): void {
  if (!getOwner()) throw new Error('Kanso hooks require a component or createRoot owner.');
}

/** Runtime primitive; the compiler turns its accessor into ordinary value reads. */
export function state<T>(initial: T | (() => T)): [Accessor<T>, StateSetter<T>] {
  ownerRequired();
  const [read, write] = createSignal(
    typeof initial === 'function' ? (initial as () => T)() : initial,
    { equals: Object.is },
  );
  return [read, value => { write(previous => typeof value === 'function'
    ? (value as (previous: T) => T)(previous) : value); }];
}

export function reducer<S, A, I = S>(fn: (state: S, action: A) => S, initial: I, initialize?: (initial: I) => S): [Accessor<S>, (action: A) => void] {
  const [read, write] = state(() => initialize ? initialize(initial) : initial as unknown as S);
  return [read, action => write(previous => fn(previous, action))];
}

const sameDependencies = (left: DependencyList, right: DependencyList) =>
  left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

/** Explicit dependencies track only the list; absent dependencies track the callback. */
export function effect(callback: Effect, dependencies?: Accessor<DependencyList>): void {
  ownerRequired();
  let first = true;
  let previous: DependencyList = [];
  let cleanup: void | (() => void);
  onCleanup(() => cleanup?.());
  createEffect(() => {
    const next = dependencies?.();
    if (next && !first && sameDependencies(previous, next)) return;
    first = false;
    if (next) previous = [...next];
    untrack(() => { cleanup?.(); cleanup = undefined; });
    cleanup = dependencies ? untrack(callback) : callback();
  });
}

export function memoValue<T>(factory: () => T, dependencies?: Accessor<DependencyList>): Accessor<T> {
  ownerRequired();
  if (!dependencies) return createMemo(factory, undefined, { equals: Object.is });
  const trigger = createMemo(dependencies, undefined, { equals: sameDependencies });
  return createMemo(() => { trigger(); return untrack(factory); }, undefined, { equals: Object.is });
}

export function callbackValue<T extends (...args: never[]) => unknown>(factory: () => T, dependencies?: Accessor<DependencyList>): Accessor<T> {
  return memoValue(factory, dependencies);
}

/** A ref is intentionally not reactive. */
export function useRef<T>(initial: T): Ref<T> { return { current: initial }; }

const compileRequired = (): never => {
  throw new Error('Kanso compiler is required. Add kanso() from @kanso/vite to Vite plugins.');
};

// Value-shaped signatures are the source API. Compilation replaces these calls.
export function useState<T>(initial: T | (() => T)): [T, StateSetter<T>];
export function useState<T = undefined>(): [T | undefined, StateSetter<T | undefined>];
export function useState(): never { return compileRequired(); }
export function useReducer<S, A>(fn: (state: S, action: A) => S, initial: S): [S, (action: A) => void];
export function useReducer<S, A, I>(fn: (state: S, action: A) => S, initial: I, initialize: (initial: I) => S): [S, (action: A) => void];
export function useReducer(): never { return compileRequired(); }
export function useEffect(callback: Effect, dependencies?: DependencyList): void;
export function useEffect(): never { return compileRequired(); }
export function useMemo<T>(factory: () => T, dependencies?: DependencyList): T;
export function useMemo(): never { return compileRequired(); }
export function useCallback<T extends (...args: never[]) => unknown>(callback: T, dependencies?: DependencyList): T;
export function useCallback(): never { return compileRequired(); }

/** Stable DOM identifier shared by SSR and hydration. */
export function useId(): string { ownerRequired(); return createUniqueId(); }
