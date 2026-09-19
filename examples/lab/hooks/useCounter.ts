import { useEffect, useState } from '@kanso/core';

/** A separately compiled hook exposes live values with familiar source syntax. */
export function useCounter(step = 1) {
  const [count, setCount] = useState(0);
  const doubled = count * 2;
  const increment = () => setCount(value => value + step);

  useEffect(() => { document.title = `Kanso · ${count}`; }, [count]);

  return { count, doubled, increment };
}
