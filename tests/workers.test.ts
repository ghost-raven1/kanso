import { describe, expect, it, vi } from 'vitest';
import { createWorker } from '../packages/workers/src/index.js';
import { exposeWorker } from '../packages/workers/src/worker.js';
import type { WorkerContext, WorkerHandlers } from '../packages/workers/src/worker.js';

class Port extends EventTarget {
  peer!: Port;
  terminated = false;
  dispose?: () => void;
  postMessage(message: unknown, transfer: Transferable[] = []) {
    const data = structuredClone(message, { transfer });
    queueMicrotask(() => { if (!this.terminated && !this.peer.terminated) this.peer.dispatchEvent(new MessageEvent('message', { data })); });
  }
  terminate() { this.terminated = true; this.dispose?.(); }
}

function connect<T extends WorkerHandlers<T>>(handlers: T) {
  const main = new Port();
  const remote = new Port();
  main.peer = remote; remote.peer = main;
  main.dispose = exposeWorker(handlers, remote);
  const factory = vi.fn(() => main as unknown as Worker);
  return { client: createWorker<T>(factory), factory, main, remote };
}

describe('module workers', () => {
  it('is lazy on the server and infers task inputs and awaited results', async () => {
    const { client, factory } = connect({ double: (value: number) => value * 2 });
    expect(factory).not.toHaveBeenCalled();
    const result: number = await client.call('double', 4);
    expect(result).toBe(8);
    expect(factory).toHaveBeenCalledOnce();
    if (false) {
      // @ts-expect-error Task inputs are inferred from the worker handler.
      client.call('double', 'four');
      // @ts-expect-error Unknown exports do not become untyped calls.
      client.call('unknown', 4);
    }
    client.terminate();
  });

  it('matches concurrent calls even when responses arrive out of order', async () => {
    const resolvers = new Map<number, (value: number) => void>();
    const { client } = connect({ wait: (input: number) => new Promise<number>(resolve => { resolvers.set(input, resolve); }) });
    const first = client.call('wait', 1);
    const second = client.call('wait', 2);
    await vi.waitFor(() => expect(resolvers.size).toBe(2));
    resolvers.get(2)!(20);
    expect(await second).toBe(20);
    resolvers.get(1)!(10);
    expect(await first).toBe(10);
    client.terminate();
  });

  it('serializes task failures without closing the worker or calling inherited methods', async () => {
    const { client, main, remote } = connect({ task: (fail: boolean) => { if (fail) throw new TypeError('Bad input'); return 3; } });
    await expect(client.call('task', true)).rejects.toMatchObject({ name: 'TypeError', message: 'Bad input' });
    expect(await client.call('task', false)).toBe(3);
    const messages: unknown[] = [];
    main.addEventListener('message', event => messages.push((event as MessageEvent).data));
    remote.dispatchEvent(new MessageEvent('message', { data: { protocol: 'kanso:worker:1', type: 'call', id: 99, method: 'toString' } }));
    await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ id: 99, type: 'error', error: expect.objectContaining({ message: 'Unknown worker task: toString' }) })));
    client.terminate();
  });

  it('rejects aborted calls immediately and delivers cooperative cancellation', async () => {
    let cancelled = false;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const { client, factory } = connect({
      wait: (_input: null, { signal }: WorkerContext) => new Promise<void>(resolve => {
        started(); signal.addEventListener('abort', () => { cancelled = true; resolve(); }, { once: true });
      }),
      ping: () => 'pong',
    });
    const aborted = AbortSignal.abort(new Error('Before starting'));
    await expect(client.call('wait', null, { signal: aborted })).rejects.toThrow('Before starting');
    expect(factory).not.toHaveBeenCalled();
    const controller = new AbortController();
    const pending = client.call('wait', null, { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await ready;
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(cancelled).toBe(true));
    expect(await client.call('ping', undefined)).toBe('pong');
    client.terminate();
  });

  it('moves ArrayBuffers in both directions and keeps call errors isolated', async () => {
    const { client } = connect({
      increment: (input: Uint8Array, context: WorkerContext) => {
        input[0] += 1;
        context.transfer(input.buffer as ArrayBuffer);
        return input;
      },
      echo: (input: unknown) => input,
    });
    const input = new Uint8Array([7]);
    const result = client.call('increment', input, { transfer: [input.buffer] });
    expect(input.byteLength).toBe(0);
    expect(Array.from(await result)).toEqual([8]);
    await expect(client.call('echo', () => 1)).rejects.toMatchObject({ name: 'DataCloneError' });
    expect(await client.call('echo', 'still usable')).toBe('still usable');
    client.terminate();
  });

  it('turns non-cloneable results into task errors', async () => {
    const { client } = connect({ invalid: () => () => 'not cloneable' });
    await expect(client.call('invalid', undefined)).rejects.toMatchObject({ name: 'DataCloneError' });
    client.terminate();
  });

  it('terminates all pending calls, runs cleanup and rejects later work', async () => {
    const { client, main } = connect({ wait: () => new Promise<void>(() => {}) });
    const remove = vi.spyOn(main, 'removeEventListener');
    const first = expect(client.call('wait', undefined)).rejects.toThrow('terminated');
    const second = expect(client.call('wait', undefined)).rejects.toThrow('terminated');
    client.terminate(); client.terminate();
    await Promise.all([first, second]);
    expect(main.terminated).toBe(true);
    expect(remove).toHaveBeenCalledTimes(3);
    await expect(client.call('wait', undefined)).rejects.toThrow('terminated');
  });

  it.each(['error', 'messageerror'])('closes on native %s and never retries work', async type => {
    const { client, main, factory } = connect({ wait: () => new Promise<void>(() => {}) });
    const pending = expect(client.call('wait', undefined)).rejects.toThrow(type === 'error' ? 'failed' : 'deserialized');
    main.dispatchEvent(new Event(type));
    await pending;
    await expect(client.call('wait', undefined)).rejects.toThrow();
    expect(factory).toHaveBeenCalledOnce();
  });

  it('returns constructor failures as rejected calls and can be disposed without starting', async () => {
    const factory = vi.fn(() => { throw new Error('Worker blocked'); });
    const client = createWorker<{ ping: () => string }>(factory);
    await expect(client.call('ping', undefined)).rejects.toThrow('Worker blocked');
    const untouched = createWorker<{ ping: () => string }>(factory);
    untouched.terminate();
    await expect(untouched.call('ping', undefined)).rejects.toThrow('terminated');
    expect(factory).toHaveBeenCalledOnce();
  });

  it('observes cancellation that occurs while the factory starts the worker', async () => {
    const { main } = connect({ ping: () => 'pong' });
    const controller = new AbortController();
    const client = createWorker<{ ping: () => string }>(() => {
      controller.abort(new Error('Cancelled while starting'));
      return main as unknown as Worker;
    });
    await expect(client.call('ping', undefined, { signal: controller.signal })).rejects.toThrow('Cancelled while starting');
    client.terminate();
  });
});
