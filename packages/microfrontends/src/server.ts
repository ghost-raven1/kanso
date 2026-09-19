import { fileURLToPath } from 'node:url';
import { createInstance } from '@module-federation/runtime';
import ssrEntryLoader from '@module-federation/vite/ssrEntryLoader';
import type { RemoteManifest } from './manifest.js';
import type { SharedModules } from './shared.js';

const instances = new Map<string, ReturnType<typeof createInstance>>();
/** Node resolves every shared specifier through the host, never through downloaded artifacts. */
export async function loadModule(manifest: RemoteManifest, name: string, shared: SharedModules): Promise<unknown> {
  let instance = instances.get(manifest.entry);
  const id = `${manifest.name}_${manifest.buildId}`;
  if (!instance) {
    const resolvedShared = Object.fromEntries([...Object.keys(shared), '@module-federation/runtime', '@module-federation/runtime-core'].map(specifier => [specifier, fileURLToPath(import.meta.resolve(specifier === '@solidjs/router' ? '@kanso/app/solid-router' : specifier))]));
    instance = createInstance({ name: `kanso_server_${instances.size}`, shared, remotes: [{ name: id, entry: manifest.entry, type: 'module' }], plugins: [ssrEntryLoader({ resolvedShared }) as NonNullable<Parameters<typeof createInstance>[0]['plugins']>[number]] });
    instances.set(manifest.entry, instance);
  }
  return instance.loadRemote(`${id}/${name}`);
}
