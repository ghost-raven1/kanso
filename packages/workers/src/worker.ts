import { isRecord, protocol, serializeError } from './web-protocol.js';
import type { WorkerContext, WorkerHandlers } from './web-protocol.js';

export type { WorkerContext, WorkerHandlers } from './web-protocol.js';

/** Structural worker scope avoids requiring DOM and WebWorker libs together. */
export interface WorkerScope extends Pick<EventTarget, 'addEventListener' | 'removeEventListener'> {
  postMessage(message: unknown, transfer: Transferable[]): void;
}

/** Expose tasks inside a module worker; return a disposer for explicit ownership. */
export function exposeWorker<T extends WorkerHandlers<T>>(handlers: T, scope: WorkerScope = globalThis as unknown as WorkerScope): () => void {
  const running = new Map<number, AbortController>();
  let disposed = false;

  function sendError(id: number, error: unknown) {
    scope.postMessage({ protocol, type: 'error', id, error: serializeError(error) }, []);
  }

  function onMessage(event: Event) {
    const message = (event as MessageEvent<unknown>).data;
    if (disposed || !isRecord(message) || message.protocol !== protocol || typeof message.id !== 'number') return;
    const id = message.id;
    if (message.type === 'cancel') {
      running.get(id)?.abort();
      running.delete(id);
      return;
    }
    if (message.type !== 'call' || typeof message.method !== 'string') return;
    if (running.has(id)) return;
    if (!Object.hasOwn(handlers, message.method) || typeof handlers[message.method as keyof T] !== 'function') {
      sendError(id, new Error(`Unknown worker task: ${message.method}`));
      return;
    }
    const controller = new AbortController();
    const transfers: Transferable[] = [];
    const context: WorkerContext = {
      signal: controller.signal,
      transfer(...objects) { for (const object of objects) if (!transfers.includes(object)) transfers.push(object); },
    };
    running.set(id, controller);
    const handler = handlers[message.method as keyof T];
    Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return handler(message.input as never, context);
    }).then(value => {
      if (running.get(id) !== controller || disposed) return;
      try { scope.postMessage({ protocol, type: 'result', id, value }, transfers); }
      catch (error) { sendError(id, error); }
    }, error => {
      if (running.get(id) === controller && !disposed) sendError(id, error);
    }).finally(() => { if (running.get(id) === controller) running.delete(id); });
  }

  scope.addEventListener('message', onMessage);
  return () => {
    if (disposed) return;
    disposed = true;
    scope.removeEventListener('message', onMessage);
    for (const controller of running.values()) controller.abort();
    running.clear();
  };
}
