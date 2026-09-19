/** Private message envelope leaves unrelated worker messages untouched. */
export const protocol = 'kanso:worker:1';

export interface WorkerContext {
  /** Cancellation is cooperative: yield periodically during long computations. */
  signal: AbortSignal;
  /** Transfer ownership of these objects with the returned result. */
  transfer(...objects: Transferable[]): void;
}

export type WorkerHandlers<T> = { [K in keyof T]: (input: never, context: WorkerContext) => unknown };
export type WorkerInput<F> = F extends (input: infer I, ...rest: never[]) => unknown ? I : never;
export type WorkerOutput<F> = F extends (...args: never[]) => infer O ? Awaited<O> : never;

export interface SerializedError { name: string; message: string; stack?: string }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function serializeError(error: unknown): SerializedError {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { name: 'Error', message: typeof error === 'string' ? error : 'Worker task failed' };
}

export function deserializeError(value: unknown): Error {
  if (!isRecord(value) || typeof value.message !== 'string') return new Error('Invalid worker error response');
  const error = new Error(value.message);
  if (typeof value.name === 'string') error.name = value.name;
  if (typeof value.stack === 'string') error.stack = value.stack;
  return error;
}
