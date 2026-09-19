import type { JSX as SolidJSX } from 'solid-js';

export type StateAction<T> = T | ((previous: T) => T);
export type SetStateAction<T> = StateAction<T>;
export type Dispatch<A> = (value: A) => void;
export type StateSetter<T> = Dispatch<StateAction<T>>;
export type Effect = () => void | (() => void);
export type DependencyList = readonly unknown[];
export interface Ref<T> { current: T }
export type ReactNode = SolidJSX.Element;
export type ComponentType<P = Record<string, never>> = (props: P) => SolidJSX.Element;
export type FC<P = Record<string, never>> = ComponentType<P>;
export type PropsWithChildren<P = unknown> = P & { children?: SolidJSX.Element };

/** JSX surface accepts React-style labels, styles and object refs. */
export namespace JSX {
  export type Element = SolidJSX.Element;
  export interface ElementChildrenAttribute { children: unknown }
  export interface IntrinsicAttributes { key?: string | number }
  type Props<K extends keyof SolidJSX.IntrinsicElements> =
    Omit<SolidJSX.IntrinsicElements[K], 'style' | 'ref'> & {
      key?: string | number;
      className?: string;
      htmlFor?: string;
      ref?: Ref<unknown> | ((element: HTMLElement) => void);
      style?: SolidJSX.CSSProperties | Record<string, string | number | undefined> | string;
    };
  export type IntrinsicElements = { [K in keyof SolidJSX.IntrinsicElements]: Props<K> };
}
