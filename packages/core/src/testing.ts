import { createComponent, createRoot, createSignal, mergeProps, type JSX } from 'solid-js';
import { insert, isServer } from 'solid-js/web';

export interface RenderOptions {
  /** An empty container owned by the caller; otherwise one is appended to document.body. */
  container?: HTMLElement;
  wrapper?: (props: { children?: JSX.Element }) => JSX.Element;
}
export interface RenderResult {
  readonly container: HTMLElement;
  /** Includes portals mounted outside the component's container. */
  readonly baseElement: HTMLElement;
  readonly unmounted: boolean;
  unmount(): void;
}
export interface ComponentRenderResult<P extends object> extends RenderResult {
  /** Merge props into the existing instance. Undefined activates component defaults. */
  setProps(patch: Partial<P>): void;
}

/** Render compiled JSX inside a fresh owner; pair with unmount or a test scope. */
export function render(factory: () => JSX.Element, options: RenderOptions = {}): RenderResult {
  if (isServer || typeof document === 'undefined')
    throw new Error('KANSO_TEST_ENVIRONMENT: use a browser or jsdom with Solid browser conditions.');
  const container = options.container ?? document.createElement('div');
  if (container.hasChildNodes())
    throw new Error('KANSO_TEST_CONTAINER: provide an empty container. Use hydrateRoot to test SSR adoption.');
  const owned = !options.container;
  if (owned) document.body.appendChild(container);
  let disposed = false;
  let disposeRoot: (() => void) | undefined;
  const result: RenderResult = {
    container,
    baseElement: container.ownerDocument.body,
    get unmounted() { return disposed; },
    unmount() {
      if (disposed) return;
      disposed = true;
      try { disposeRoot?.(); }
      finally {
        container.replaceChildren();
        if (owned) container.remove();
      }
    },
  };
  try {
    createRoot(dispose => {
      disposeRoot = dispose;
      insert(container, options.wrapper
        ? createComponent(options.wrapper, { get children() { return factory(); } })
        : factory());
    });
  } catch (error) {
    try { result.unmount(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Render and cleanup failed.'); }
    throw error;
  }
  return result;
}

/** Mount once and drive live component props without emulating React rerenders. */
export function renderComponent<P extends object>(
  component: (props: P) => JSX.Element,
  options: RenderOptions & { props: NoInfer<P> },
): ComponentRenderResult<P> {
  const [props, setProps] = createSignal(options.props);
  const result = render(() => createComponent(component, mergeProps(props) as P), options);
  return Object.assign(result, {
    setProps(patch: Partial<P>) {
      if (result.unmounted) throw new Error('KANSO_TEST_UNMOUNTED: cannot update an unmounted component.');
      setProps(previous => ({ ...previous, ...patch }));
    },
  });
}

/** Explicit per-test ownership; independent scopes never clean up each other's roots. */
export function createTestScope() {
  const roots = new Set<RenderResult>();
  function track<T extends RenderResult>(result: T): T {
    const unmount = result.unmount;
    result.unmount = () => {
      try { unmount(); }
      finally { roots.delete(result); }
    };
    roots.add(result);
    return result;
  }
  return {
    render(factory: () => JSX.Element, options?: RenderOptions) {
      return track(render(factory, options));
    },
    renderComponent<P extends object>(component: (props: P) => JSX.Element, options: RenderOptions & { props: NoInfer<P> }) {
      return track(renderComponent(component, options));
    },
    cleanup() {
      const errors: unknown[] = [];
      for (const root of roots) {
        try { root.unmount(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'Test cleanup failed.');
    },
  };
}
