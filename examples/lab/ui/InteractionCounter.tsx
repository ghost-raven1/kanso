import { useState } from '@kanso/core';

/** This module enters the browser only after interaction with its light shell. */
export default function InteractionCounter({ id }: { id: string }) {
  const [count, setCount] = useState(0);
  const [draft, setDraft] = useState('');
  return (
    <div>
      <label htmlFor={`${id}-draft`}>Deferred draft {id}</label>
      <input
        id={`${id}-draft`}
        value={draft}
        onInput={event => setDraft(event.currentTarget.value)}
      />
      <button
        id={`${id}-increment`}
        onClick={() => setCount(value => value + 1)}
      >
        Deferred count {id}: {count}
      </button>
      <output aria-label={`Deferred value ${id}`}>{draft}</output>
    </div>
  );
}
