import { useState } from 'react';
import { useCount as useCounter } from '@/hooks';
function Counter() {
  const [step, setStep] = useState(1);
  const {
    values: [count, ...tail],
    actions: { increment },
    ...rest
  } = useCounter({ step });
  return (
    <section>
      <button data-counter onClick={increment}>
        Count: {count}
      </button>
      <output>{tail[0]}</output>
      <span data-marker>{rest.marker}</span>
      <button onClick={() => setStep(3)}>Step</button>
    </section>
  );
}
export function App() {
  return (
    <main>
      <Counter />
      <Counter />
    </main>
  );
}
