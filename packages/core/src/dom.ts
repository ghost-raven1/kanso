import { batch, onCleanup } from 'solid-js';
import type { Ref } from './types.js';

/** Preserve native currentTarget and batch all writes within a DOM event. */
export function eventHandler<E extends Event>(read: () => ((event: E) => unknown) | undefined | null): (event: E) => void {
  return event => { batch(() => read()?.(event)); };
}

const unitless = new Set(['animationIterationCount', 'borderImageOutset', 'borderImageSlice', 'borderImageWidth',
  'columnCount', 'fillOpacity', 'flex', 'flexGrow', 'flexShrink', 'fontWeight', 'gridArea', 'gridColumn',
  'gridColumnEnd', 'gridColumnStart', 'gridRow', 'gridRowEnd', 'gridRowStart', 'lineHeight', 'opacity',
  'order', 'orphans', 'scale', 'strokeOpacity', 'strokeWidth', 'tabSize', 'widows', 'zIndex', 'zoom']);

/** React-style camelCase and numeric CSS values become Solid style properties. */
export function styleObject(value: Record<string, unknown> | string | undefined): Record<string, string> | string | undefined {
  if (!value || typeof value === 'string') return value;
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry != null).map(([key, entry]) => {
    const name = key.startsWith('--') ? key : key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`).replace(/^ms-/, '-ms-');
    const unit = typeof entry === 'number' && entry !== 0 && !key.startsWith('--') && !unitless.has(key) ? 'px' : '';
    return [name, `${String(entry)}${unit}`];
  }));
}

export function assignRef<T>(ref: Ref<T | null> | ((element: T) => void)): (element: T) => void {
  return element => {
    if (typeof ref === 'function') ref(element);
    else { ref.current = element; onCleanup(() => { if (ref.current === element) ref.current = null; }); }
  };
}

/** Keep spread getters live while translating native DOM conventions. */
export function normalizeProps(value: Record<string, unknown> | undefined, tag: string): Record<string, unknown> {
  const source = value ?? {};
  const rename = (key: string) => key === 'className' ? 'class' : key === 'htmlFor' ? 'for'
    : key === 'onChange' && ['input', 'textarea'].includes(tag) ? 'onInput' : key;
  const keys = new Map(Object.keys(source).filter(key => key !== 'key').map(key => [rename(key), key]));
  return new Proxy({}, {
    ownKeys: () => [...keys.keys()],
    getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }),
    get(_target, key) {
      if (typeof key !== 'string') return undefined;
      const original = keys.get(key) ?? key;
      const entry = source[original];
      if (original === 'style') return styleObject(entry as Parameters<typeof styleObject>[0]);
      if (original === 'ref' && entry) return assignRef(entry as Parameters<typeof assignRef>[0]);
      if (/^on[A-Z]/.test(original)) return eventHandler(() => source[original] as ReturnType<Parameters<typeof eventHandler>[0]>);
      return entry;
    },
  });
}
