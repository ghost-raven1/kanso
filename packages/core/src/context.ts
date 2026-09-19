import {
  createComponent,
  createContext as solidContext,
  useContext as solidUseContext,
  type Accessor,
  type Context as SolidContext,
  type JSX,
} from 'solid-js';

const liveContext = Symbol('kanso.context');
export interface Context<T> {
  Provider: (props: { value: T; children?: JSX.Element }) => JSX.Element;
  readonly [liveContext]: SolidContext<Accessor<T>>;
}

/** Providers transport a getter, so replacing a primitive or object remains reactive. */
export function createContext<T>(defaultValue: T): Context<T>;
export function createContext<T>(): Context<T | undefined>;
export function createContext<T>(defaultValue?: T): Context<T | undefined> {
  const inner = solidContext<Accessor<T | undefined>>(() => defaultValue);
  return {
    [liveContext]: inner,
    Provider: props =>
      createComponent(inner.Provider, {
        value: () => props.value,
        get children() {
          return props.children;
        },
      }),
  };
}

/** Capture the owner now; subsequent reads can occur in events and deferred callbacks. */
export function contextValue<T>(
  context: Context<T> | SolidContext<T>,
): Accessor<T> {
  if (liveContext in context) return solidUseContext(context[liveContext]);
  const value = solidUseContext(context);
  return () => value;
}
export function useContext<T>(context: Context<T> | SolidContext<T>): T {
  return contextValue(context)();
}
