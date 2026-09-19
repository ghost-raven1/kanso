import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { satisfies, valid, validRange } from 'semver';
import type { Plugin } from 'vite';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error(`MF_TYPES_UNLOCKED: ${path.basename(file)} must contain valid JSON. Run kanso microfrontends sync.`); }
}

/** Production reads an explicit local contract lock; it never downloads mutable types. */
export function remoteContractsPlugin(): Plugin {
  return {
    name: 'kanso:remote-contracts',
    configResolved(config) {
      if (config.command !== 'build') return;
      const file = path.join(config.root, 'kanso.microfrontends.json');
      if (!existsSync(file)) return;
      const source = readJson(file);
      const lockPath = path.join(config.root, 'kanso-remotes.lock.json');
      if (!existsSync(lockPath)) throw new Error('MF_TYPES_UNLOCKED: run kanso microfrontends sync before building.');
      const lock = readJson(lockPath);
      if (!record(lock) || lock.schema !== 1 || !record(lock.remotes) || !record(source) || !Array.isArray(source.remotes)) throw new Error('MF_TYPES_UNLOCKED: invalid remote contract configuration or lock.');
      const names = new Set<string>();
      for (const remote of source.remotes) {
        if (!record(remote) || typeof remote.name !== 'string' || !/^[a-zA-Z][\w-]*$/.test(remote.name) || !Object.hasOwn(lock.remotes, remote.name)) throw new Error('MF_TYPES_UNLOCKED: a configured remote has no locked contract. Run kanso microfrontends sync.');
        if (names.has(remote.name)) throw new Error(`MF_DUPLICATE_REMOTE: ${remote.name} is configured more than once.`);
        names.add(remote.name);
        const pinned = lock.remotes[remote.name];
        if (!record(pinned) || typeof pinned.contract !== 'string' || !valid(pinned.contract) || typeof remote.contract !== 'string' || !validRange(remote.contract)) throw new Error(`MF_TYPES_UNLOCKED: ${remote.name} needs a valid contract range and locked version. Run kanso microfrontends sync.`);
        if (!satisfies(pinned.contract, remote.contract)) throw new Error(`MF_CONTRACT_MISMATCH: ${remote.name} locked contract ${pinned.contract} does not satisfy ${remote.contract}. Run kanso microfrontends sync.`);
        const declaration = path.join(config.root, 'remote-types', remote.name, 'index.d.ts');
        if (!existsSync(declaration) || !statSync(declaration).isFile()) throw new Error(`MF_TYPES_MISSING: run kanso microfrontends sync for ${remote.name}.`);
      }
    },
  };
}
