import { useState } from 'react';
type Item = { id: number; name: string };
function Row({ item: { id, name }, ...rest }: { item: Item; suffix: string }) {
  const [note, setNote] = useState('');
  return (
    <li data-row={id}>
      <span>
        {name}
        {rest.suffix}
      </span>
      <input
        aria-label={'Note ' + id}
        value={note}
        onChange={event => setNote(event.currentTarget.value)}
      />
    </li>
  );
}
export function App() {
  const [items, setItems] = useState<Item[]>([
    { id: 1, name: 'Alpha' },
    { id: 2, name: 'Beta' },
  ]);
  const [query, setQuery] = useState('');
  const visible = items.filter(item =>
    item.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <main>
      <input
        aria-label="Search"
        value={query}
        onChange={event => setQuery(event.currentTarget.value)}
      />
      <button onClick={() => setItems(values => [...values].reverse())}>
        Reverse
      </button>
      <button
        onClick={() =>
          setItems(values =>
            values.map(item => ({ ...item, name: item.name + '!' })),
          )
        }
      >
        Replace
      </button>
      <ul>
        {visible.map(item => (
          <Row key={item.id} item={item} suffix="." />
        ))}
      </ul>
    </main>
  );
}
