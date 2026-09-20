import { useState } from '@kanso/core';

/** A separately compiled interactive panel used by the transition example. */
export default function AdvancedPanel() {
  const [count, setCount] = useState(0);
  return (
    <section aria-label="Advanced panel">
      <h3>Новый компонент готов</h3>
      <button onClick={() => setCount(value => value + 1)}>
        Advanced count: {count}
      </button>
    </section>
  );
}
