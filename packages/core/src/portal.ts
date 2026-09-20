import { createComponent, createMemo, Show, type JSX } from 'solid-js';
import { isServer, Portal as SolidPortal } from 'solid-js/web';

export interface PortalProps {
  /** Omitted: document.body. Null: wait until a target becomes available. */
  mount?: HTMLElement | null | (() => HTMLElement | null);
  children?: JSX.Element;
}

/** Client-only DOM placement with the original component's Context and cleanup owner. */
export function Portal(props: PortalProps): JSX.Element {
  // Do not evaluate browser-only targets or children during SSR.
  if (isServer) return null;
  const target = createMemo(() => {
    const mount = props.mount;
    return typeof mount === 'function' ? mount() : mount === undefined ? document.body : mount;
  });
  return Show({
    keyed: false,
    get when() { return target(); },
    children: (mount: () => HTMLElement) => createComponent(SolidPortal, {
      get mount() { return mount(); },
      get children() { return props.children; },
    }),
  });
}
