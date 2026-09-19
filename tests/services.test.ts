import { describe, expect, it } from 'vitest';
import {
  createServiceScope,
  defineService,
  type ServiceDefinition,
} from '@kanso/core';

describe('service scopes', () => {
  it('owns independent instances and transfers only explicit JSON snapshots', () => {
    let created = 0;
    const settings = defineService<{ name: string }, { name: string }>({
      id: 'settings',
      create: ({ snapshot }) => {
        created++;
        return snapshot ?? { name: 'initial' };
      },
      snapshot: value => ({ ...value }),
      restore: (value, next) => {
        value.name = next.name;
      },
    });
    const privateService = defineService({
      id: 'private',
      create: () => ({ secret: 'not-for-html' }),
    });
    const first = createServiceScope();
    const second = createServiceScope();
    first.get(settings).name = 'A';
    first.get(privateService);
    expect(first.get(settings)).not.toBe(second.get(settings));
    expect(second.get(settings).name).toBe('initial');
    expect(created).toBe(2);
    expect(first.snapshot()).toEqual({ settings: { name: 'A' } });
    const restored = createServiceScope({ snapshots: first.snapshot() });
    expect(restored.get(settings).name).toBe('A');
    const instance = restored.get(settings);
    restored.restore({ settings: { name: 'B' } });
    expect(restored.get(settings)).toBe(instance);
    expect(instance.name).toBe('B');
    first.dispose();
    second.dispose();
    restored.dispose();
  });

  it('aborts pending work and cleans dependent services once in reverse order', () => {
    const log: string[] = [];
    let later: () => void = () => {};
    const dependency = defineService({
      id: 'dependency',
      create: ({ onCleanup }) => {
        onCleanup(() => log.push('dependency'));
        return {};
      },
    });
    const service = defineService({
      id: 'service',
      create: ({ get, onCleanup, signal }) => {
        get(dependency);
        onCleanup(() => log.push('service'));
        later = () => onCleanup(() => log.push('later'));
        return { signal };
      },
    });
    const abort = new AbortController();
    const scope = createServiceScope({ signal: abort.signal });
    const value = scope.get(service);
    later();
    abort.abort();
    scope.dispose();
    expect(value.signal.aborted).toBe(true);
    expect(log).toEqual(['later', 'service', 'dependency']);
    expect(() => scope.get(service)).toThrow('KANSO_SERVICE_DISPOSED');
  });

  it('detects identity collisions and factory cycles, and releases failed setup', () => {
    const scope = createServiceScope();
    const first = defineService({ id: 'same', create: () => ({}) });
    scope.get(first);
    expect(() =>
      scope.get(defineService({ id: 'same', create: () => ({}) })),
    ).toThrow('KANSO_SERVICE_ID');
    let circular: ServiceDefinition<object>;
    circular = defineService({
      id: 'cycle',
      create: ({ get }) => get(circular),
    });
    expect(() => scope.get(circular)).toThrow('KANSO_SERVICE_CYCLE');
    let cleaned = 0;
    const broken = defineService({
      id: 'broken',
      create: ({ onCleanup }) => {
        onCleanup(() => {
          cleaned++;
        });
        throw new Error('factory failed');
      },
    });
    expect(() => scope.get(broken)).toThrow('factory failed');
    expect(cleaned).toBe(1);
    scope.dispose();
    expect(cleaned).toBe(1);
  });

  it('rejects accidental private methods, cyclic state and unsupported JSON types', () => {
    expect(() =>
      defineService({
        id: 'incomplete',
        create: () => 0,
        snapshot: value => value,
      }),
    ).toThrow('KANSO_SERVICE_TRANSFER');
    for (const value of [new Date(), { method() {} }, NaN, undefined, 1n]) {
      const service = defineService({
        id: 'invalid',
        create: () => value,
        snapshot: state => state,
        restore: () => {},
      });
      const scope = createServiceScope();
      scope.get(service);
      expect(() => scope.snapshot()).toThrow('KANSO_SERVICE_SNAPSHOT');
      scope.dispose();
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => createServiceScope({ snapshots: cyclic })).toThrow(
      'KANSO_SERVICE_SNAPSHOT',
    );
  });

  it('finishes every cleanup even if one fails', () => {
    const cleaned: string[] = [];
    const scope = createServiceScope();
    scope.get(
      defineService({
        id: 'failing',
        create: ({ onCleanup }) => {
          onCleanup(() => cleaned.push('first'));
          onCleanup(() => {
            throw new Error('cleanup failed');
          });
          return null;
        },
      }),
    );
    expect(() => scope.dispose()).toThrow('Kanso service cleanup failed');
    expect(cleaned).toEqual(['first']);
    expect(scope.disposed).toBe(true);
    scope.dispose();
  });
});
