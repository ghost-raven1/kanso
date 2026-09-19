interface Entry<T> { value: T; expires: number }

/** Bounded TTL cache with single-flight work; invalidation cannot repopulate stale data. */
export function createRenderCache<T>(maxEntries = 200) {
  const entries = new Map<string, Entry<T>>();
  const inflight = new Map<string, Promise<T>>();
  let generation = 0;
  return {
    clear() { generation++; entries.clear(); inflight.clear(); },
    get size() { return entries.size; },
    async get(key: string, ttl: number, render: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      if (hit && hit.expires > Date.now()) { entries.delete(key); entries.set(key, hit); return hit.value; }
      const running = inflight.get(key);
      if (running) return running;
      const epoch = generation;
      const promise = render().then(value => {
        if (epoch === generation) {
          entries.set(key, { value, expires: Date.now() + ttl });
          while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
        }
        return value;
      }).finally(() => { if (inflight.get(key) === promise) inflight.delete(key); });
      inflight.set(key, promise);
      return promise;
    },
  };
}
