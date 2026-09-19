import { batch, createMemo, createRoot, createSignal, getOwner, onCleanup, type Accessor, type JSX } from 'solid-js';

interface Row<T, R> {
  value: R;
  update: (item: T, index: number) => void;
  dispose: () => void;
}

/** Keys, rather than object identities, own row state and DOM. */
export function keyedMap<T, R>(
  items: Accessor<readonly T[]>, key: (item: T, index: number) => unknown,
  render: (item: Accessor<T>, index: Accessor<number>) => R,
): Accessor<R[]> {
  const owner = getOwner();
  const rows = new Map<unknown, Row<T, R>>();
  onCleanup(() => { rows.forEach(row => row.dispose()); rows.clear(); });
  return createMemo(() => {
    const list = items();
    const keys = list.map(key);
    if (new Set(keys).size !== keys.length) throw new Error('Kanso list contains duplicate keys.');
    const active = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null;
    const next = new Set(keys);
    for (const [id, row] of rows) if (!next.has(id)) { row.dispose(); rows.delete(id); }
    const values = batch(() => list.map((item, index) => {
      const id = keys[index];
      const existing = rows.get(id);
      if (existing) { existing.update(item, index); return existing.value; }
      return createRoot(dispose => {
        const [read, write] = createSignal(item, { equals: Object.is });
        const [position, setPosition] = createSignal(index);
        const value = render(read, position);
        rows.set(id, { value, dispose, update: (replacement, at) => {
          write(() => replacement); setPosition(at);
        } });
        return value;
      }, owner);
    }));
    if (active && active !== document.body) queueMicrotask(() => {
      if (active.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
    });
    return values;
  });
}

/** A component boundary creates the keyed owner exactly once, not inside a DOM effect. */
export function Keyed<T>(props: {
  each: readonly T[];
  by: (item: T, index: number) => unknown;
  children: (item: Accessor<T>, index: Accessor<number>) => JSX.Element;
}): JSX.Element {
  return keyedMap(() => props.each, props.by, props.children) as unknown as JSX.Element;
}
