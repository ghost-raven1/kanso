export { useState, useReducer, useEffect, useMemo, useCallback, useRef } from './hooks.js';
export {
  createContext, useContext, lazy, Suspense, ErrorBoundary, createRoot, batch,
  onCleanup, onMount, untrack,
} from 'solid-js';
export { createStore, produce, reconcile } from 'solid-js/store';
export type { JSX, ReactNode, ComponentType, FC, PropsWithChildren, Dispatch, SetStateAction, Ref } from './types.js';
import type { JSX } from 'solid-js';

/** Fragments retain Solid's lazy children evaluation. */
export function Fragment(props: { children?: JSX.Element }): JSX.Element { return props.children; }
