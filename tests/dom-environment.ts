import { JSDOM } from 'jsdom';
import { beforeAll, afterAll } from 'vitest';

/** Keep Node's typed-array realm for the compiler while providing a real DOM realm. */
export function installDOM(): void {
  const original = new Map<string, PropertyDescriptor | undefined>();
  let dom: JSDOM;
  beforeAll(() => {
    dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost' });
    for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLHeadElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'MutationObserver']) {
      original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { value: Reflect.get(dom.window, key), configurable: true, writable: true });
    }
  });
  afterAll(() => {
    dom.window.close();
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
}
