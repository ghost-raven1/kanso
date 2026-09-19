import { untrack, type Accessor } from 'solid-js';

/** Hook defaults initialize lazily once; props defaults follow the current undefined value. */
export function defaultValue<T>(
  read: Accessor<T | undefined>,
  fallback: Accessor<T>,
  once: boolean,
): Accessor<T> {
  let initialized = false;
  let value: T;
  return () => {
    const current = read();
    if (current !== undefined) return current;
    if (!once) return fallback();
    if (!initialized) {
      value = untrack(fallback);
      initialized = true;
    }
    return value;
  };
}
/** Match object rest's own enumerable string and symbol properties. */
export function objectRest(source: object, excluded: PropertyKey[]): object {
  const result: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(source))
    if (
      !excluded.includes(key) &&
      Object.prototype.propertyIsEnumerable.call(source, key)
    ) {
      Object.defineProperty(result, key, {
        value: (source as Record<PropertyKey, unknown>)[key],
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  return result;
}
