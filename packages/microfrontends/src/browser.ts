import { createInstance } from '@module-federation/runtime';
import { RemoteError, type RemoteManifest } from './manifest.js';
import type { SharedModules } from './shared.js';

const instances = new Map<string, ReturnType<typeof createInstance>>();
const attempts = new Map<string, number>();
const resources = new Map<string, Promise<void>>();
let nextInstance = 0;

/** Download before import: failed fetches can retry without poisoning the browser's ESM cache. */
function prepareResource(url: string): Promise<void> {
  let pending = resources.get(url);
  if (pending) return pending;
  pending = Promise.resolve().then(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, { cache: 'force-cache', mode: 'cors', credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await response.arrayBuffer();
    } catch (error) {
      resources.delete(url);
      throw new RemoteError('MF_RESOURCE_UNAVAILABLE', `Cannot load ${url}: ${error instanceof Error ? error.message : String(error)}. Retry when the resource is available.`, controller.signal.aborted ? 504 : 503);
    } finally { clearTimeout(timeout); }
  });
  resources.set(url, pending);
  return pending;
}

/** Only immutable module definitions are cached; providers and app data are never cached here. */
export async function loadModule(manifest: RemoteManifest, name: string, shared: SharedModules): Promise<unknown> {
  await Promise.all((manifest.resources?.[name] ?? []).map(prepareResource));
  if (import.meta.env.DEV) {
    const hmr = await import('@kanso/core/hmr');
    shared['@kanso/core/hmr'] = { version: manifest.runtime['@kanso/core'], lib: () => hmr, shareConfig: { singleton: true, requiredVersion: manifest.runtime['@kanso/core'], strictVersion: true } };
  }
  let instance = instances.get(manifest.entry);
  const id = `${manifest.name}_${manifest.buildId}`;
  if (!instance) {
    const entry = new URL(manifest.entry);
    const attempt = attempts.get(manifest.entry) ?? 0;
    if (attempt) entry.searchParams.set('kanso_retry', String(attempt));
    instance = createInstance({ name: `kanso_browser_${nextInstance++}`, shared, remotes: [{ name: id, entry: entry.href, type: 'module' }] });
    instances.set(manifest.entry, instance);
  }
  try { return await instance.loadRemote(`${id}/${name}`); }
  catch (error) {
    if (instances.get(manifest.entry) === instance) {
      instances.delete(manifest.entry);
      attempts.set(manifest.entry, (attempts.get(manifest.entry) ?? 0) + 1);
    }
    throw error;
  }
}
