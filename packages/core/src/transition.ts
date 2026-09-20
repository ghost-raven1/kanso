import { createSignal, getOwner, onCleanup, runWithOwner, startTransition as startSolidTransition, type Accessor } from 'solid-js';
import { isServer } from 'solid-js/web';

export interface TransitionAnimation {
  target: () => Element | null | undefined;
  enter?: Keyframe[] | PropertyIndexedKeyframes;
  exit?: Keyframe[] | PropertyIndexedKeyframes;
  /** Finite timing only: a transition must be able to finish. Defaults to 180ms. */
  timing?: Omit<KeyframeAnimationOptions, 'iterations'> & { iterations?: number };
}
export interface TransitionOptions { animation?: TransitionAnimation }
export type StartTransition = (update: () => void) => Promise<void>;

/** Authoring signature; the compiler makes isPending a reactive ordinary value. */
export function useTransition(_options?: TransitionOptions): [boolean, StartTransition] {
  throw new Error('Kanso compiler is required for useTransition.');
}

/** Wait for a committed Solid transition, optionally animating its owned DOM region. */
export function transition(options: TransitionOptions = {}): [Accessor<boolean>, StartTransition] {
  const owner = getOwner();
  if (!owner) throw new Error('useTransition requires a component or hook owner.');
  if (isServer) return [() => false, update => { update(); return Promise.resolve(); }];
  const [pending, setPending] = createSignal(false);
  let current: AbortController | undefined;
  let disposed = false;
  onCleanup(() => { disposed = true; current?.abort(); });

  const start: StartTransition = update => {
    if (disposed) return Promise.resolve();
    current?.abort();
    const controller = current = new AbortController();
    const { signal } = controller;
    setPending(true);
    const animations = new Set<Animation>();
    const cancelAnimations = () => { for (const animation of animations) animation.cancel(); animations.clear(); };
    signal.addEventListener('abort', cancelAnimations, { once: true });
    let stopWaiting!: () => void;
    const cancelled = new Promise<void>(resolve => { stopWaiting = resolve; signal.addEventListener('abort', stopWaiting, { once: true }); });
    const animate = async (phase: 'exit' | 'enter') => {
      const definition = options.animation;
      if (!definition?.[phase] || signal.aborted || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      const element = definition.target();
      if (!element?.isConnected || typeof element.animate !== 'function') return;
      const timing = { duration: 180, ...definition.timing };
      if (timing.iterations !== undefined && (!Number.isFinite(timing.iterations) || timing.iterations < 0)
        || typeof timing.duration === 'number' && !Number.isFinite(timing.duration)
        || timing.delay !== undefined && !Number.isFinite(timing.delay)
        || timing.endDelay !== undefined && !Number.isFinite(timing.endDelay)) throw new Error('Transition animation timing must be finite.');
      const animation = element.animate(definition[phase]!, { ...timing, fill: 'both' });
      animations.add(animation);
      try { await animation.finished; }
      catch (error) { if (!signal.aborted) throw error; }
    };
    const perform = async () => {
      await animate('exit');
      if (signal.aborted) return;
      let failed = false, failure: unknown;
      // Keep Solid's transition bookkeeping intact when the application callback throws.
      await runWithOwner(owner, () => startSolidTransition(() => {
        if (signal.aborted) return;
        try { update(); } catch (error) { failed = true; failure = error; }
      }));
      if (failed) throw failure;
      if (signal.aborted) return;
      cancelAnimations();
      await animate('enter');
    };
    return Promise.race([perform(), cancelled]).finally(() => {
      cancelAnimations();
      signal.removeEventListener('abort', cancelAnimations);
      signal.removeEventListener('abort', stopWaiting);
      if (current === controller && !disposed) { current = undefined; setPending(false); }
    });
  };
  return [pending, start];
}
