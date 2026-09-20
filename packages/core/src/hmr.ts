import {
  createMemo,
  createSignal,
  onCleanup,
  untrack,
  type JSX,
} from 'solid-js';
import { state, useId as freshId, useRef as freshRef } from './hooks.js';
import type { StateSetter, RefObject } from './types.js';

// This entry is imported exclusively by the development compiler.
const marker = Symbol.for('kanso.hmr.descriptor');
type FunctionValue = (...args: never[]) => unknown;
interface Metadata {
  shape: string;
  code: string;
  hooks: () => FunctionValue[];
  dependencies: () => unknown[];
}
interface Descriptor {
  metadata: Metadata;
  component?: boolean;
}
interface Slot {
  value: unknown;
}
interface Instance {
  slots: Slot[];
  cursor: number;
  refresh: () => void;
  reset: boolean;
}
interface ComponentRecord extends Descriptor {
  implementation: (props: Record<string, unknown>) => JSX.Element;
  proxy: (props: Record<string, unknown>) => JSX.Element;
  target?: ComponentRecord;
  instances: Set<Instance>;
  signature: string | undefined;
  dependencies: unknown[];
}
export interface HotRegistry {
  components: Map<string, ComponentRecord>;
  mode: 'preserve' | 'remount';
  contexts: Map<string, { code: string; value: unknown }>;
}
let active: Instance | undefined;
const descriptor = (value: unknown): Descriptor | undefined =>
  typeof value === 'function'
    ? (value as unknown as Record<symbol, Descriptor>)[marker]
    : undefined;

function signature(
  metadata: Metadata,
  seen = new Set<Metadata>(),
): string | undefined {
  if (seen.has(metadata)) return undefined;
  const trail = new Set(seen).add(metadata);
  const children = metadata.hooks().map(hook => {
    const next = descriptor(hook);
    return next && signature(next.metadata, trail);
  });
  return children.some(value => value === undefined)
    ? undefined
    : JSON.stringify([metadata.shape, children]);
}
function dependencies(
  metadata: Metadata,
  seen = new Set<Metadata>(),
): unknown[] {
  if (seen.has(metadata)) return [undefined];
  const trail = new Set(seen).add(metadata);
  return [
    metadata.code,
    ...metadata.dependencies().flatMap(value => {
      const next = descriptor(value);
      return next?.component
        ? []
        : next
          ? dependencies(next.metadata, trail)
          : [value];
    }),
  ];
}

/** Each mounted boundary owns its slots; module replacement never serializes user values. */
export function registry(
  mode: HotRegistry['mode'],
  data: Record<string, unknown> = {},
): HotRegistry {
  const contexts = (data.kansoContexts ??=
    new Map()) as HotRegistry['contexts'];
  return { components: new Map(), contexts, mode };
}
/** Module-scoped contexts keep identity through compatible consumer-only edits. */
export function context<T>(
  registry: HotRegistry,
  id: string,
  create: () => T,
  code: string,
): T {
  const previous = registry.contexts.get(id);
  if (previous?.code === code) return previous.value as T;
  const value = create();
  registry.contexts.set(id, { code, value });
  return value;
}
export function hook<T extends FunctionValue>(value: T, metadata: Metadata): T {
  Object.defineProperty(value, marker, { value: { metadata } });
  return value;
}
export function component<T extends (props: never) => JSX.Element>(
  registry: HotRegistry,
  id: string,
  implementation: T,
  metadata: Metadata,
): T {
  const record: ComponentRecord = {
    implementation:
      implementation as unknown as ComponentRecord['implementation'],
    metadata,
    instances: new Set(),
    signature: undefined,
    dependencies: [],
    proxy(props) {
      if (record.target) return record.target.proxy(props);
      const [version, setVersion] = createSignal(0);
      const instance: Instance = {
        slots: [],
        cursor: 0,
        reset: false,
        refresh: () => setVersion(value => value + 1),
      };
      record.instances.add(instance);
      onCleanup(() => {
        record.instances.delete(instance);
        instance.slots = [];
      });
      return createMemo(() => {
        version();
        if (instance.reset) {
          instance.slots = [];
          instance.reset = false;
        }
        instance.cursor = 0;
        const previous = active;
        active = instance;
        try {
          return untrack(() => record.implementation(props));
        } finally {
          active = previous;
        }
      }) as unknown as JSX.Element;
    },
  };
  Object.defineProperty(record.proxy, marker, {
    value: { metadata, component: true },
  });
  registry.components.set(id, record);
  return record.proxy as unknown as T;
}

/** Initialize metadata after all declarations exist, including hooks declared below components. */
export function initialize(registry: HotRegistry): void {
  for (const record of registry.components.values()) {
    record.signature = signature(record.metadata);
    record.dependencies = dependencies(record.metadata);
  }
}
export function update(previous: HotRegistry, next: HotRegistry): boolean {
  if ([...previous.components.keys()].some(key => !next.components.has(key)))
    return false;
  // Update definitions first, then refresh only changed boundaries.
  const changes: ComponentRecord[] = [];
  for (const [id, incoming] of next.components) {
    const current = previous.components.get(id);
    if (!current) {
      previous.components.set(id, incoming);
      continue;
    }
    const compatible =
      incoming.signature !== undefined &&
      incoming.signature === current.signature;
    const changed =
      incoming.dependencies.length !== current.dependencies.length ||
      incoming.dependencies.some(
        (value, i) => !Object.is(value, current.dependencies[i]),
      );
    current.implementation = incoming.implementation;
    current.metadata = incoming.metadata;
    current.signature = incoming.signature;
    current.dependencies = incoming.dependencies;
    // Newly evaluated importers must receive the original boundary and instance ownership.
    incoming.target = current;
    next.components.set(id, current);
    if (changed) {
      const reset = previous.mode === 'remount' || !compatible;
      if (reset)
        console.info(
          `[Kanso HMR] ${id}: state reset (${compatible ? 'remount mode' : 'hook signature changed or unknown'}).`,
        );
      for (const instance of current.instances) instance.reset = reset;
      changes.push(current);
    }
  }
  for (const record of changes)
    for (const instance of [...record.instances]) instance.refresh();
  return true;
}

function slot<T>(initialize: () => T): Slot {
  if (!active) return { value: initialize() };
  const index = active.cursor++;
  return (active.slots[index] ??= { value: untrack(initialize) });
}
export function __state<T>(initial: T | (() => T)): [() => T, StateSetter<T>] {
  const saved = slot(() =>
    typeof initial === 'function' ? (initial as () => T)() : initial,
  );
  const [read, write] = state(() => saved.value as T);
  return [
    read,
    value =>
      write(previous => {
        const next =
          typeof value === 'function'
            ? (value as (previous: T) => T)(previous)
            : value;
        saved.value = next;
        return next;
      }),
  ];
}
export function __reducer<S, A, I = S>(
  reduce: (state: S, action: A) => S,
  initial: I,
  initialize?: (initial: I) => S,
): [() => S, (action: A) => void] {
  const [read, write] = __state(() =>
    initialize ? initialize(initial) : (initial as unknown as S),
  );
  return [read, action => write(previous => reduce(previous, action))];
}
export function useRef<T>(initial: T): RefObject<T>;
export function useRef<T>(initial: T | null): RefObject<T | null>;
export function useRef<T = undefined>(): RefObject<T | undefined>;
export function useRef<T>(initial?: T): RefObject<T | undefined> {
  return slot(() => freshRef(initial)).value as RefObject<T | undefined>;
}
export function useId(): string {
  return slot(freshId).value as string;
}
