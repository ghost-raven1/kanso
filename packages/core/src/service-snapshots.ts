export type ServiceSnapshots = Record<string, unknown>;

/** Copy only JSON data; reject accidental methods, cycles and unsupported object types. */
export function snapshotData(
  value: unknown,
  path = 'services',
  ancestors = new Set<object>(),
): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || !value || ancestors.has(value))
    throw new Error(
      `KANSO_SERVICE_SNAPSHOT: ${path} must contain finite, acyclic JSON data.`,
    );
  if (
    !Array.isArray(value) &&
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(
      `KANSO_SERVICE_SNAPSHOT: ${path} must be a plain object or array.`,
    );
  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? Array.from(value, (item, index) =>
          snapshotData(item, `${path}[${index}]`, ancestors),
        )
      : Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            snapshotData(item, `${path}.${key}`, ancestors),
          ]),
        );
  } finally {
    ancestors.delete(value);
  }
}

export function serviceSnapshots(value: unknown): ServiceSnapshots {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(
      'KANSO_SERVICE_SNAPSHOT: expected a record of service snapshots.',
    );
  return snapshotData(value) as ServiceSnapshots;
}
