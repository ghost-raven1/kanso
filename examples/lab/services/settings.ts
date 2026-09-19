import { defineService } from '@kanso/core';

export interface SettingsState {
  workspace: string;
  theme: 'light' | 'dark';
  count: number;
}

/** Small native store for this example; getState/subscribe also fit existing vanilla stores. */
function createSettings(initial: SettingsState) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setState(patch: Partial<SettingsState>) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
  };
}

export const settings = defineService<
  ReturnType<typeof createSettings>,
  SettingsState
>({
  id: 'lab/settings',
  create: ({ snapshot }) =>
    createSettings(
      snapshot ?? { workspace: 'Local', theme: 'light', count: 0 },
    ),
  snapshot: store => store.getState(),
  restore: (store, snapshot) => store.setState(snapshot),
});
