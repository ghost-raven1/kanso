import { deserializeError, isRecord, protocol } from './web-protocol.js';
import type { WorkerHandlers, WorkerInput, WorkerOutput } from './web-protocol.js';

export type { WorkerContext, WorkerHandlers } from './web-protocol.js';

export interface WorkerCallOptions {
  signal?: AbortSignal;
  /** Objects must also occur in the input; ownership moves to the worker. */
  transfer?: Transferable[];
}

export interface WorkerClient<T extends WorkerHandlers<T>> {
  call<K extends keyof T & string>(method: K, input: WorkerInput<T[K]>, options?: WorkerCallOptions): Promise<WorkerOutput<T[K]>>;
  /** Reject pending work, remove listeners and terminate the native worker. */
  terminate(): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  cleanup(): void;
}

/** Create a lazy, explicitly owned native worker with typed concurrent calls. */
export function createWorker<T extends WorkerHandlers<T>>(factory: () => Worker): WorkerClient<T> {
  let worker: Worker | undefined;
  let closed: Error | undefined;
  let sequence = 0;
  const pending = new Map<number, Pending>();

  function settle(id: number, action: (request: Pending) => void) {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    request.cleanup();
    action(request);
  }

  function close(error: Error) {
    if (closed) return;
    closed = error;
    if (worker) {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
      worker.terminate();
      worker = undefined;
    }
    for (const id of pending.keys()) settle(id, request => request.reject(error));
  }

  function onMessage(event: MessageEvent<unknown>) {
    const message = event.data;
    if (!isRecord(message) || message.protocol !== protocol || typeof message.id !== 'number') return;
    if (message.type === 'result') settle(message.id, request => request.resolve(message.value));
    else if (message.type === 'error') settle(message.id, request => request.reject(deserializeError(message.error)));
  }

  function onError(event: ErrorEvent) {
    close(new Error(event.message || 'Worker failed to load or execute'));
  }

  function onMessageError() {
    close(new Error('Worker response could not be deserialized'));
  }

  function connect(): Worker {
    if (!worker) {
      worker = factory();
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.addEventListener('messageerror', onMessageError);
    }
    return worker;
  }

  return {
    call(method, input, options = {}) {
      if (closed) return Promise.reject(closed);
      if (options.signal?.aborted) return Promise.reject(options.signal.reason);
      return new Promise((resolve, reject) => {
        let target: Worker;
        try { target = connect(); } catch (error) { reject(error); return; }
        const id = ++sequence;
        const abort = () => {
          settle(id, request => request.reject(options.signal?.reason));
          try { target.postMessage({ protocol, type: 'cancel', id }); } catch { /* Already disposed. */ }
        };
        pending.set(id, {
          resolve: value => resolve(value as WorkerOutput<T[typeof method]>),
          reject,
          cleanup: () => options.signal?.removeEventListener('abort', abort),
        });
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) { abort(); return; }
        try { target.postMessage({ protocol, type: 'call', id, method, input }, options.transfer ?? []); }
        catch (error) { settle(id, request => request.reject(error)); }
      });
    },
    terminate() { close(new Error('Worker has been terminated')); },
  };
}
