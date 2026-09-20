import { createComponent, createMemo, createSignal, onCleanup, type Component, type JSX } from 'solid-js';
import { Dynamic, isServer } from 'solid-js/web';

export interface InteractionOptions<P extends object> {
  /** Light SSR/client shell. Give replayable controls matching id or name in both components. */
  fallback: Component<P>;
  /** Optional loading indicator, rendered alongside the shell so input remains usable. */
  pending?: Component;
  error?: Component<{ error: Error; retry(): void }>;
}

interface Target { tag: string; attribute: 'id' | 'name'; value: string }
function target(element: Element | null, boundary: HTMLElement): Target | undefined {
  for (let current = element; current && current !== boundary; current = current.parentElement) {
    for (const attribute of ['id', 'name'] as const) {
      const value = current.getAttribute(attribute);
      if (value) return { tag: current.tagName, attribute, value };
    }
  }
}
function find(boundary: HTMLElement, key?: Target): HTMLElement | undefined {
  if (!key) return;
  const matches = [...boundary.querySelectorAll<HTMLElement>(`[${key.attribute}]`)]
    .filter(element => element.tagName === key.tag && element.getAttribute(key.attribute) === key.value);
  return matches.length === 1 ? matches[0] : undefined;
}

/** A normal Solid subtree: no extra hydration root and no independently owned runtime. */
export function interactionComponent<P extends object>(load: () => Promise<{ default: Component<P> }>, options: InteractionOptions<P>): Component<P> {
  return props => {
    const [component, setComponent] = createSignal<Component<P>>();
    const [pending, setPending] = createSignal(false);
    const [error, setError] = createSignal<Error>();
    let boundary!: HTMLDivElement;
    let disposed = false, pressed = false, requested = false;
    let loaded: Component<P> | undefined;
    let activation: { key: Target; event: MouseEvent } | undefined;
    let frame: number | undefined;
    onCleanup(() => { disposed = true; if (frame !== undefined) cancelAnimationFrame(frame); });

    const commit = () => {
      if (!loaded || disposed || pressed || component()) return;
      const active = boundary.ownerDocument.activeElement;
      const focus = active instanceof Element && boundary.contains(active) ? target(active, boundary) : undefined;
      const fields = [...boundary.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')].map(field => ({
        key: target(field, boundary), value: field.value,
        checked: field instanceof HTMLInputElement ? field.checked : undefined,
        start: field.selectionStart, end: field.selectionEnd,
      }));
      setComponent(() => loaded!);
      setPending(false);
      for (const field of fields) {
        const next = find(boundary, field.key);
        if (!(next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) || next instanceof HTMLInputElement && next.type === 'file') continue;
        const changed = next.value !== field.value || next instanceof HTMLInputElement && next.checked !== field.checked;
        next.value = field.value;
        if (next instanceof HTMLInputElement && field.checked !== undefined) next.checked = field.checked;
        if (field.start !== null && field.end !== null) next.setSelectionRange(field.start, field.end);
        if (changed) { next.dispatchEvent(new Event('input', { bubbles: true })); next.dispatchEvent(new Event('change', { bubbles: true })); }
      }
      find(boundary, focus)?.focus({ preventScroll: true });
      const queued = activation;
      activation = undefined;
      if (queued) {
        const element = find(boundary, queued.key);
        if (element) element.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true, composed: true, button: queued.event.button,
          ctrlKey: queued.event.ctrlKey, shiftKey: queued.event.shiftKey, altKey: queued.event.altKey, metaKey: queued.event.metaKey,
        }));
        else setError(new Error('KANSO_LAZY_TARGET: give the activated control one matching id or name in the shell and loaded component.'));
      }
    };
    const schedule = () => {
      if (isServer || disposed || frame !== undefined) return;
      frame = requestAnimationFrame(() => { frame = undefined; commit(); });
    };
    const activate = () => {
      if (isServer || disposed || requested || component()) return;
      requested = true; setPending(true); setError(undefined);
      void load().then(module => { if (!disposed) { loaded = module.default; schedule(); } }, caught => {
        if (!disposed) { requested = false; setPending(false); setError(caught instanceof Error ? caught : new Error(String(caught))); }
      });
    };
    const click = (event: MouseEvent) => {
      if (component() || event.defaultPrevented) return;
      const key = target(event.target instanceof Element ? event.target : null, boundary);
      // Only stable identities can safely replay actions. Unnamed shells may still load on hover/focus.
      if (key) {
        event.preventDefault(); event.stopPropagation();
        activation ??= { key, event };
      }
      pressed = false; activate(); schedule();
    };
    const retry = () => { requested = false; activate(); };
    const view = createMemo(() => createComponent(component() ?? options.fallback, props));
    const status = createMemo(() => pending() && options.pending ? createComponent(options.pending, {}) : null);
    const failure = createMemo(() => error() ? options.error
      ? createComponent(options.error, { get error() { return error()!; }, retry })
      : createComponent(Dynamic, { component: 'button', type: 'button', onClick: retry, children: 'Retry loading' }) : null);
    return createComponent(Dynamic, {
      component: 'div', style: { display: 'contents' }, ref: (element: HTMLDivElement) => {
        boundary = element;
        if (isServer) return;
        const over = (event: PointerEvent) => { if (event.pointerType !== 'touch') activate(); };
        const down = () => { pressed = true; activate(); };
        const up = () => { pressed = false; schedule(); };
        element.addEventListener('pointerover', over, true);
        element.addEventListener('pointerdown', down, true);
        element.addEventListener('focusin', activate, true);
        element.addEventListener('keydown', activate, true);
        element.addEventListener('click', click, true);
        window.addEventListener('pointerup', up, true);
        window.addEventListener('pointercancel', up, true);
        onCleanup(() => {
          element.removeEventListener('pointerover', over, true); element.removeEventListener('pointerdown', down, true);
          element.removeEventListener('focusin', activate, true); element.removeEventListener('keydown', activate, true);
          element.removeEventListener('click', click, true);
          window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true);
        });
      },
      get children(): JSX.Element {
        return [view(), status(), failure()];
      },
    });
  };
}
