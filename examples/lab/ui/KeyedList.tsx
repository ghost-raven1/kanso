import { useState } from '@kanso/core';

interface Item {
  id: string;
  label: string;
}
function Row({ item }: { item: Item }) {
  if (typeof window !== 'undefined' && window.kansoMetrics)
    window.kansoMetrics.rowMounts++;
  const [count, setCount] = useState(0);
  return (
    <li data-row={item.id}>
      <span className="row-id">{item.id}</span>
      <input aria-label={`Label ${item.id}`} value={item.label} />
      <button
        aria-label={`Count ${item.id}`}
        onClick={() => setCount(value => value + 1)}
      >
        {count}
      </button>
    </li>
  );
}

export function KeyedList() {
  const [items, setItems] = useState<Item[]>([
    { id: 'A', label: 'State stays with the key' },
    { id: 'B', label: 'DOM nodes are reused' },
    { id: 'C', label: 'Objects may be replaced' },
  ]);
  return (
    <article className="panel compact">
      <span className="tag">IDENTITY</span>
      <h2>Reorder. Keep the state.</h2>
      <p>Нажми счётчик строки, затем переставь список.</p>
      <ul className="keyed-list">
        {items.map(item => (
          <Row key={item.id} item={item} />
        ))}
      </ul>
      <button
        id="reverse"
        onClick={() =>
          setItems(previous =>
            [...previous].reverse().map(item => ({ ...item })),
          )
        }
      >
        Reverse & replace objects ↕
      </button>
    </article>
  );
}
