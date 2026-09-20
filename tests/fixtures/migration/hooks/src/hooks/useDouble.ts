import { useMemo } from 'react';

export function useDouble(value: number) {
  return useMemo(() => value * 2, [value]);
}
