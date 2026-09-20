import satisfies from 'semver/functions/satisfies.js';

export const RUNTIME_VERSIONS = { '@kanso/core': '0.7.2', '@kanso/app': '0.7.2', '@kanso/microfrontends': '0.7.2', 'solid-js': '1.9.15', '@solidjs/router': '0.16.3' } as const;
export interface RemoteManifest {
  schema: 1;
  name: string;
  buildId: string;
  contract: string;
  runtime: Record<string, string>;
  entry: string;
  exports: string[];
  routes?: boolean;
  styles: string[];
  preloads: string[];
  /** Immutable JavaScript needed before executing each public export. */
  resources?: Record<string, string[]>;
  types?: string;
  server?: boolean;
}
/** A load failure is recoverable; an action must never silently switch releases. */
export class RemoteError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) { super(message); this.name = 'RemoteError'; }
}
export function validBuildId(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value); }
export function releaseManifest(current: string, buildId: string): string {
  if (!validBuildId(buildId)) throw new RemoteError('MF_INVALID_BUILD', 'Invalid remote release identity.', 400);
  return new URL(`releases/${buildId}/kanso-remote.json`, new URL('.', current)).href;
}
/** Validate metadata before asking federation to execute any remote module. */
export function validateManifest(value: unknown, definition: { name: string; contract: string; shared?: Record<string, { version: string }> }, base: string, expectedBuild?: string): RemoteManifest {
  const m = value as Partial<RemoteManifest> | null;
  if (!m || m.schema !== 1 || m.name !== definition.name || !validBuildId(m.buildId) || !m.runtime || !Array.isArray(m.exports) || !m.exports.every(x => typeof x === 'string' && /^[a-zA-Z][\w-]*$/.test(x)) || !Array.isArray(m.styles) || !Array.isArray(m.preloads)) throw new RemoteError('MF_INVALID_MANIFEST', `Invalid manifest for ${definition.name}.`);
  if (expectedBuild && m.buildId !== expectedBuild) throw new RemoteError('MF_RELEASE_MISMATCH', `${definition.name}: the pinned release is unavailable. Refresh the page.`, 409);
  if (typeof m.contract !== 'string' || !satisfies(m.contract, definition.contract)) throw new RemoteError('MF_CONTRACT_MISMATCH', `${definition.name}: contract ${m.contract} does not satisfy ${definition.contract}.`);
  for (const [name, version] of Object.entries(RUNTIME_VERSIONS)) if (m.runtime[name] !== version) throw new RemoteError('MF_RUNTIME_MISMATCH', `${definition.name}: ${name} must be ${version}, received ${m.runtime[name]}.`);
  for (const [name, version] of Object.entries(m.runtime)) {
    if (Object.hasOwn(RUNTIME_VERSIONS, name)) continue;
    if (definition.shared?.[name]?.version !== version) throw new RemoteError('MF_SHARED_MISMATCH', `${definition.name}: explicitly provide shared ${name} at ${version}.`);
  }
  const url = (raw: unknown): string => {
    if (typeof raw !== 'string') throw new RemoteError('MF_INVALID_URL', `Missing asset URL for ${definition.name}.`);
    let parsed: URL;
    try { parsed = new URL(raw, base); } catch { throw new RemoteError('MF_INVALID_URL', `Invalid remote URL: ${raw}.`); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new RemoteError('MF_INVALID_URL', `Unsupported remote URL: ${raw}.`);
    return parsed.href;
  };
  let resources: Record<string, string[]> | undefined;
  if (m.resources !== undefined) {
    if (!m.resources || typeof m.resources !== 'object' || Array.isArray(m.resources)) throw new RemoteError('MF_INVALID_MANIFEST', `${definition.name}: resources must map exports to asset URLs.`);
    resources = Object.fromEntries(Object.entries(m.resources).map(([name, files]) => {
      if (!m.exports!.includes(name) || !Array.isArray(files)) throw new RemoteError('MF_INVALID_MANIFEST', `${definition.name}: invalid resources for ${name}.`);
      return [name, [...new Set(files.map(url))]];
    }));
  }
  return { ...m, entry: url(m.entry), styles: m.styles.map(url), preloads: m.preloads.map(url), ...(resources ? { resources } : {}), ...(m.types ? { types: url(m.types) } : {}) } as RemoteManifest;
}
