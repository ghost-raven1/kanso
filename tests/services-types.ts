import {
  defineService,
  createServiceScope,
  useStore,
  type ExternalStore,
} from '@kanso/core';

declare const store: ExternalStore<{ name: string; count: number }>;
function Consumer() {
  const name: string = useStore(store, state => state.name);
  const all: { name: string; count: number } = useStore(store);
  // @ts-expect-error A selected string must not silently widen to number.
  const wrong: number = useStore(store, state => state.name);
  // @ts-expect-error A selector receives the actual state shape.
  useStore(store, state => state.missing);
  return [name, all, wrong];
}

const definition = defineService<{ count: number }, { count: number }>({
  id: 'typed',
  create: ({ snapshot }) => snapshot ?? { count: 0 },
  snapshot: value => value,
  restore: (value, next) => {
    value.count = next.count;
  },
});
const scope = createServiceScope();
const value: number = scope.get(definition).count;
// @ts-expect-error Service factories preserve their returned type.
const wrong: string = scope.get(definition).count;
scope.dispose();
void [Consumer, value, wrong];
