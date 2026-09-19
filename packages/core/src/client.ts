import { hydrate, render } from 'solid-js/web';
import type { JSX } from 'solid-js';

/** Mount a compiled component factory and return its disposer. */
export function mount(factory: () => JSX.Element, element: HTMLElement): () => void {
  return render(factory, element);
}
export function hydrateRoot(factory: () => JSX.Element, element: HTMLElement): () => void {
  const fields = [...element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')]
    .filter(field => field.value !== field.defaultValue || 'checked' in field && field.checked !== field.defaultChecked)
    .map(field => ({ field, value: field.value, checked: 'checked' in field ? field.checked : undefined,
      start: field.selectionStart, end: field.selectionEnd }));
  const focused = element.ownerDocument.activeElement;
  const dispose = hydrate(factory, element);
  for (const { field, value, checked, start, end } of fields) {
    if (!field.isConnected) continue;
    field.value = value;
    if (checked !== undefined && 'checked' in field) field.checked = checked;
    if (start !== null && end !== null) field.setSelectionRange(start, end);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    if (checked !== undefined) field.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true });
  return dispose;
}

/** Familiar root lifecycle; render takes a factory so ownership starts before JSX. */
export function createRoot(element: HTMLElement) {
  let dispose: (() => void) | undefined;
  return {
    render(factory: () => JSX.Element) { dispose?.(); dispose = mount(factory, element); },
    unmount() { dispose?.(); dispose = undefined; },
  };
}

/** Keep server HTML intact if the client entry cannot be loaded. */
export async function hydrateWhenReady(
  load: () => Promise<{ default: () => JSX.Element }>, element: HTMLElement,
): Promise<{ status: 'hydrated'; dispose: () => void } | { status: 'retained'; error: unknown }> {
  let entry: { default: () => JSX.Element };
  try {
    entry = await load();
  } catch (error) {
    element.dataset.kansoHydration = 'failed';
    return { status: 'retained', error };
  }
  const dispose = hydrateRoot(entry.default, element);
  element.dataset.kansoHydration = 'hydrated';
  return { status: 'hydrated', dispose };
}
