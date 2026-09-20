import { lazy as solidLazy, type Component } from 'solid-js';
import { interactionComponent, type InteractionOptions } from './lazy/interaction.js';

export interface LazyOptions<P extends object> { interaction?: InteractionOptions<P> }

/** Ordinary lazy rendering, or an explicit light shell activated by user interaction. */
export function lazy<T extends Component<never>>(load: () => Promise<{ default: T }>): T & { preload(): Promise<{ default: T }> };
export function lazy<P extends object>(load: () => Promise<{ default: Component<P> }>, options: LazyOptions<P>): Component<P> & { preload(): Promise<{ default: Component<P> }> };
export function lazy<P extends object>(load: () => Promise<{ default: Component<P> }>, options?: LazyOptions<P>): Component<P> & { preload(): Promise<{ default: Component<P> }> } {
  if (!options?.interaction) return solidLazy(load);
  let pending: Promise<{ default: Component<P> }> | undefined;
  const preload = () => pending ??= Promise.resolve().then(load).then(module => {
    if (typeof module.default !== 'function') throw new Error('KANSO_LAZY_MODULE: expected a default component export.');
    return module;
  }).catch(error => { pending = undefined; throw error; });
  return Object.assign(interactionComponent(preload, options.interaction), { preload });
}
