export { useState, useReducer, useEffect, useMemo, useCallback, useRef, useId, useLayoutEffect } from './hooks.js';
export {
  lazy, Suspense, ErrorBoundary, createRoot, batch,
  onCleanup, onMount, untrack,
} from 'solid-js';
export { createStore, produce, reconcile } from 'solid-js/store';
export type { JSX, ReactNode, ComponentType, FC, PropsWithChildren, Dispatch, SetStateAction, Ref, RefObject, MutableRefObject, ForwardedRef, RefTarget, RefCallback, ComponentProps, CSSProperties } from './types.js';
import type { JSX } from 'solid-js';

/** Fragments retain Solid's lazy children evaluation. */
export function Fragment(props: { children?: JSX.Element }): JSX.Element { return props.children; }

export { createContext, useContext, type Context } from './context.js';
export { useStore, type ExternalStore, type StoreSelector, type StoreEquality } from './external-store.js';
export { defineService, createServiceScope, ServiceProvider, useService, type ServiceScope, type ServiceDefinition, type ServiceFactoryContext, type ServiceSnapshots } from './services.js';

export { forwardRef, useImperativeHandle } from './refs.js';
export type {
  ChangeEvent, FormEvent, MouseEvent, KeyboardEvent, FocusEvent, PointerEvent, TouchEvent, ClipboardEvent, DragEvent, WheelEvent,
  ChangeEventHandler, FormEventHandler, MouseEventHandler, KeyboardEventHandler, FocusEventHandler,
  PointerEventHandler, TouchEventHandler, ClipboardEventHandler, DragEventHandler, WheelEventHandler,
} from './events.js';
