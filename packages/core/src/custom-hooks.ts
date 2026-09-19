import { createMemo, getOwner, untrack, type Accessor } from 'solid-js';

const argumentTag = Symbol.for('kanso.hook.argument.v1');
const resultTag = Symbol.for('kanso.hook.result.v1');
interface LiveArgument<T> { [argumentTag]: Accessor<T> }
interface HookResult<T> { [resultTag]: Accessor<T> }

/** Internal compiler ABI: distinguish live arguments from ordinary function values. */
export function liveArgument<T>(read: Accessor<T>): LiveArgument<T> {
  return { [argumentTag]: read };
}

/** Parameter defaults initialize once; supplied reactive arguments remain live. */
export function hookArgument<T>(input: T | LiveArgument<T>, fallback?: Accessor<T>): Accessor<T> {
  let initialized = false;
  let defaultValue: T;
  return () => {
    const value = input !== null && typeof input === 'object' && argumentTag in input
      ? (input as LiveArgument<T>)[argumentTag]() : input as T;
    if (value !== undefined || !fallback) return value;
    if (!initialized) { defaultValue = untrack(fallback); initialized = true; }
    return defaultValue;
  };
}

/** Only the returned expression recomputes; the hook's setup retains one owner. */
export function hookResult<T>(read: Accessor<T>): HookResult<T> {
  return { [resultTag]: createMemo(read, undefined, { equals: Object.is }) };
}

/** Reject uncompiled hook contracts instead of silently returning stale values. */
export function callHook(hook: (...args: unknown[]) => unknown, args: unknown[]): Accessor<unknown> {
  if (!getOwner()) throw new Error('Kanso custom hooks require a component owner.');
  const result = untrack(() => hook(...args));
  if (!result || typeof result !== 'object' || !(resultTag in result)) {
    throw new Error('KANSO_HOOK_ABI: compile the custom hook with the same Kanso compiler as its caller.');
  }
  return (result as HookResult<unknown>)[resultTag];
}
