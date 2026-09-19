import {
  batch,
  createComponent,
  createContext,
  getOwner,
  useContext,
  type JSX,
} from 'solid-js';
import {
  serviceSnapshots,
  snapshotData,
  type ServiceSnapshots,
} from './service-snapshots.js';

export type { ServiceSnapshots } from './service-snapshots.js';
export interface ServiceFactoryContext<S> {
  snapshot: S | undefined;
  signal: AbortSignal;
  get<T, U>(definition: ServiceDefinition<T, U>): T;
  onCleanup(cleanup: () => void): void;
}
export interface ServiceDefinition<T, S = never> {
  readonly id: string;
  readonly create: (context: ServiceFactoryContext<S>) => T;
  /** Opt in to public bootstrap data. Never serialize a whole service implicitly. */
  readonly snapshot?: (value: T) => S;
  /** Update an existing instance after navigation or revalidation. */
  readonly restore?: (value: T, snapshot: S) => void;
}
export interface ServiceScope {
  readonly signal: AbortSignal;
  readonly disposed: boolean;
  get<T, S>(definition: ServiceDefinition<T, S>): T;
  snapshot(): ServiceSnapshots;
  restore(snapshots: ServiceSnapshots): void;
  dispose(): void;
}

/** Define a shared identity and factory; instances are created only inside a scope. */
export function defineService<T, S = never>(
  definition: ServiceDefinition<T, S>,
): ServiceDefinition<T, S> {
  if (!definition.id || definition.id.trim() !== definition.id)
    throw new Error('KANSO_SERVICE_ID: provide a nonempty stable service ID.');
  if (!!definition.snapshot !== !!definition.restore)
    throw new Error(
      'KANSO_SERVICE_TRANSFER: snapshot and restore must be provided together.',
    );
  return Object.freeze({ ...definition });
}

/** Own one application's services, pending work and optional public hydration snapshots. */
export function createServiceScope(
  options: { snapshots?: ServiceSnapshots; signal?: AbortSignal } = {},
): ServiceScope {
  const controller = new AbortController();
  let snapshots = serviceSnapshots(options.snapshots ?? {});
  const entries = new Map<
    string,
    {
      definition: object;
      value: unknown;
      snapshot?: () => unknown;
      restore?: (snapshot: unknown) => void;
    }
  >();
  const creating = new Set<string>();
  const cleanups: (() => void)[] = [];
  let disposed = false;
  let cleanupFailure: unknown;
  const available = () => {
    if (disposed)
      throw new Error('KANSO_SERVICE_DISPOSED: the service scope is closed.');
  };
  const scope: ServiceScope = {
    signal: controller.signal,
    get disposed() {
      return disposed;
    },
    get<T, S>(definition: ServiceDefinition<T, S>): T {
      available();
      const entry = entries.get(definition.id);
      if (entry) {
        if (entry.definition !== definition)
          throw new Error(
            `KANSO_SERVICE_ID: two definitions use ${definition.id}; share the definition module.`,
          );
        return entry.value as T;
      }
      if (creating.has(definition.id))
        throw new Error(
          `KANSO_SERVICE_CYCLE: recursive factory ${definition.id}.`,
        );
      creating.add(definition.id);
      const localCleanups: (() => void)[] = [];
      try {
        const value = definition.create({
          snapshot: Object.hasOwn(snapshots, definition.id)
            ? (snapshots[definition.id] as S)
            : undefined,
          signal: scope.signal,
          get: scope.get,
          onCleanup(cleanup) {
            available();
            localCleanups.push(cleanup);
          },
        });
        if (value && typeof value === 'object' && 'then' in value)
          throw new Error(
            `KANSO_SERVICE_ASYNC: ${definition.id} must create its instance synchronously; expose async methods on it.`,
          );
        available();
        entries.set(definition.id, {
          definition,
          value,
          snapshot: definition.snapshot && (() => definition.snapshot!(value)),
          restore:
            definition.restore &&
            (data => definition.restore!(value, data as S)),
        });
        cleanups.push(() => {
          const errors: unknown[] = [];
          for (const cleanup of localCleanups.splice(0).reverse()) {
            try {
              cleanup();
            } catch (error) {
              errors.push(error);
            }
          }
          if (errors.length)
            throw new AggregateError(
              errors,
              `Service ${definition.id} cleanup failed.`,
            );
        });
        return value;
      } catch (error) {
        for (const cleanup of localCleanups.reverse()) {
          try {
            cleanup();
          } catch {
            /* Preserve the factory error. */
          }
        }
        throw error;
      } finally {
        creating.delete(definition.id);
      }
    },
    snapshot() {
      available();
      return Object.fromEntries(
        [...entries]
          .filter(([, entry]) => entry.snapshot)
          .map(([id, entry]) => [id, snapshotData(entry.snapshot!(), id)]),
      );
    },
    restore(next) {
      available();
      const values = serviceSnapshots(next);
      batch(() => {
        for (const [id, value] of Object.entries(values))
          entries.get(id)?.restore?.(value);
        snapshots = { ...snapshots, ...values };
      });
    },
    dispose() {
      if (disposed) {
        if (cleanupFailure) {
          const error = cleanupFailure;
          cleanupFailure = undefined;
          throw error;
        }
        return;
      }
      disposed = true;
      options.signal?.removeEventListener('abort', abort);
      controller.abort(
        options.signal?.reason ??
          new DOMException('Service scope disposed', 'AbortError'),
      );
      const errors: unknown[] = [];
      for (const cleanup of cleanups.splice(0).reverse()) {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      entries.clear();
      snapshots = {};
      if (errors.length)
        throw new AggregateError(errors, 'Kanso service cleanup failed.');
    },
  };
  // AbortSignal dispatch must not throw an uncaught exception. The owning disposer reports it.
  const abort = () => {
    try {
      scope.dispose();
    } catch (error) {
      cleanupFailure = error;
    }
  };
  if (options.signal?.aborted) scope.dispose();
  else options.signal?.addEventListener('abort', abort, { once: true });
  return scope;
}

const ServiceContext = createContext<ServiceScope>();

/** Borrow a scope. Its creator is responsible for disposal; App handles its own scope. */
export function ServiceProvider(props: {
  scope: ServiceScope;
  children?: JSX.Element;
}): JSX.Element {
  return createComponent(ServiceContext.Provider, {
    value: props.scope,
    get children() {
      return props.children;
    },
  });
}

export function useService<T, S>(definition: ServiceDefinition<T, S>): T {
  if (!getOwner())
    throw new Error(
      'KANSO_SERVICE_OWNER: useService requires a component owner.',
    );
  const scope = useContext(ServiceContext);
  if (!scope)
    throw new Error(
      'KANSO_SERVICE_PROVIDER: useService requires App or ServiceProvider.',
    );
  return scope.get(definition);
}
