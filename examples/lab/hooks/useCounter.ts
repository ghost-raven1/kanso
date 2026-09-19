import { useState } from '@kanso/core';

/** A separately compiled hook exposes live values with familiar source syntax. */
export function useCounter(step = 1) {
  const [count, setCount] = useState(0);
  const doubled = count * 2;
  const increment = () => setCount(value => value + step);

  return { count, doubled, increment };
}
