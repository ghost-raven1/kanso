import { useState } from 'react';
import { useDouble } from './useDouble';
export function useCounter({
  initial = 0,
  step = 1,
}: { initial?: number; step?: number } = {}) {
  const [count, setCount] = useState(initial);
  const doubled = useDouble(count);
  const increment = () => setCount(value => value + step);
  return {
    values: [count, doubled] as const,
    actions: { increment },
    marker: 'hook v1',
  };
}
