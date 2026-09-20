import { splitProps, untrack } from 'solid-js';
import { effect } from './hooks.js';
import { attachRef } from './dom.js';
import type { DependencyList, RefTarget, ComponentType, ReactNode } from './types.js';

/** Forwarded components share the ordinary Solid owner and context. */
export function forwardRef<T, P = {}>(
  render: (props: P, ref: RefTarget<T>) => ReactNode,
): ComponentType<P & { ref?: RefTarget<T> }> {
  return props => {
    const [local, rest] = splitProps(props, ['ref']);
    return render(rest as P, local.ref);
  };
}

/** Ref identity participates in cleanup even when the explicit dependencies are empty. */
export function imperativeHandle<T>(readRef: () => RefTarget<T>, create: () => T, dependencies?: () => DependencyList): void {
  effect(() => {
    const ref = readRef();
    const value = dependencies ? untrack(create) : create();
    return attachRef(ref, value);
  }, dependencies ? () => [readRef(), ...dependencies()] : undefined, true);
}

export function useImperativeHandle<T>(ref: RefTarget<T>, create: () => T, dependencies?: DependencyList): void {
  throw new Error('Kanso compiler is required for useImperativeHandle.');
}
