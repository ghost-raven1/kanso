import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { releaseManifest, RemoteError, validateManifest, validBuildId, type RemoteManifest } from '@kanso/microfrontends/manifest';

export interface MicrofrontendDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  file?: string;
  remote?: string;
  hint?: string;
}
export interface RemoteLockEntry { buildId: string; contract: string; manifest: string; types: string }
export interface MicrofrontendsReport {
  root: string;
  diagnostics: MicrofrontendDiagnostic[];
  remotes: Record<string, RemoteLockEntry>;
  written: string[];
}
interface Definition { name: string; manifest: string; contract: string; serverManifest?: string; shared?: Record<string, { version: string }> }
interface Artifact { schema: 1; files: Record<string, string> }
interface Inspected { definition: Definition; manifest: RemoteManifest; artifact: Artifact; lock: RemoteLockEntry }
const configFile = 'kanso.microfrontends.json';
const lockFile = 'kanso-remotes.lock.json';
const declaration = /\.d\.(?:ts|mts|cts)$/;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function diagnostic(report: MicrofrontendsReport, error: unknown, remote?: string) {
  report.diagnostics.push({
    code: error instanceof RemoteError ? error.code : 'MF_INVALID_CONFIGURATION',
    severity: 'error', remote, file: configFile,
    message: error instanceof Error ? error.message : String(error),
    hint: 'Correct the reported remote configuration or publish the missing release, then run kanso microfrontends sync.',
  });
}

function httpUrl(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new RemoteError('MF_INVALID_URL', `${label} must be an absolute HTTP(S) URL.`);
  let url: URL;
  try { url = new URL(value); } catch { throw new RemoteError('MF_INVALID_URL', `Invalid ${label}: ${value}`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new RemoteError('MF_INVALID_URL', `Invalid ${label}: ${value}`);
  return url.href;
}

async function readJson(file: string): Promise<unknown> { return JSON.parse(await readFile(file, 'utf8')); }

/** Inspect the static remote list without network requests or configuration execution. */
export async function readMicrofrontendsConfig(root: string): Promise<Definition[]> {
  let value: unknown;
  try { value = await readJson(join(root, configFile)); }
  catch { throw new RemoteError('MF_CONFIG_INVALID', `Create a valid ${configFile} with a remotes array.`); }
  if (!record(value) || !Array.isArray(value.remotes)) throw new RemoteError('MF_CONFIG_INVALID', `${configFile} must contain a remotes array.`);
  const names = new Set<string>();
  return value.remotes.map(item => {
    if (!record(item) || typeof item.name !== 'string' || !/^[A-Za-z][\w-]*$/.test(item.name) || typeof item.contract !== 'string' || !item.contract) throw new RemoteError('MF_CONFIG_INVALID', 'Each remote needs a unique name, manifest URL and contract range.');
    if (names.has(item.name)) throw new RemoteError('MF_DUPLICATE_REMOTE', `Remote ${item.name} is configured more than once.`);
    names.add(item.name);
    if (item.shared !== undefined && (!record(item.shared) || Object.values(item.shared).some(version => typeof version !== 'string'))) throw new RemoteError('MF_CONFIG_INVALID', 'shared must map package names to exact runtime versions.');
    if (item.serverManifest !== undefined) httpUrl(typeof item.serverManifest === 'string' ? item.serverManifest.replaceAll('{buildId}', 'release') : item.serverManifest, 'serverManifest');
    return { name: item.name, manifest: httpUrl(item.manifest, 'manifest'), contract: item.contract, ...(typeof item.serverManifest === 'string' ? { serverManifest: item.serverManifest } : {}), ...(record(item.shared) ? { shared: Object.fromEntries(Object.entries(item.shared).map(([name, version]) => [name, { version: version as string }])) } : {}) };
  });
}

async function response(url: string, method: 'GET' | 'HEAD' = 'GET'): Promise<Response> {
  let result: Response;
  try { result = await fetch(url, { method, signal: AbortSignal.timeout(10_000), redirect: 'follow' }); }
  catch (error) { throw new RemoteError('MF_RESOURCE_UNAVAILABLE', `Cannot fetch ${url}: ${error instanceof Error ? error.message : String(error)}`); }
  if (method === 'HEAD' && [405, 501].includes(result.status)) return response(url);
  if (!result.ok) throw new RemoteError('MF_RESOURCE_UNAVAILABLE', `${url} returned HTTP ${result.status}.`);
  return result;
}

async function jsonResource(url: string): Promise<unknown> {
  const result = await response(url);
  try { return await result.json(); } catch { throw new RemoteError('MF_INVALID_JSON', `${url} does not contain valid JSON.`); }
}

function typeArtifact(value: unknown, remote: string): Artifact {
  if (!record(value) || value.schema !== 1 || !record(value.files) || !Object.hasOwn(value.files, 'index.d.ts')) throw new RemoteError('MF_INVALID_TYPES', `${remote}: type artifact must contain schema 1 and files including index.d.ts.`);
  const files: Record<string, string> = {};
  for (const [path, contents] of Object.entries(value.files)) {
    if (path.includes('\\') || path.includes('\0') || path.includes(':') || path.split('/').some(part => !part || part === '.' || part === '..') || !declaration.test(path) || typeof contents !== 'string') throw new RemoteError('MF_INVALID_TYPE_PATH', `${remote}: invalid declaration path ${path}.`);
    files[path] = contents;
  }
  const index = ts.createSourceFile('index.d.ts', files['index.d.ts'], ts.ScriptTarget.Latest, false);
  if (!index.statements.some(statement => (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && statement.name.text === 'Contract' && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))) throw new RemoteError('MF_INVALID_TYPES', `${remote}: index.d.ts must export a named Contract type.`);
  return { schema: 1, files };
}

async function manifestAt(url: string, definition: Definition, buildId?: string): Promise<RemoteManifest> {
  const manifest = validateManifest(await jsonResource(url), definition, url, buildId);
  if (new Set(manifest.exports).size !== manifest.exports.length || (!manifest.exports.length && !manifest.routes)) throw new RemoteError('MF_INVALID_EXPORTS', `${definition.name}: expose at least one component or route group and remove duplicate exports.`);
  return manifest;
}

async function inspect(definition: Definition, lock?: RemoteLockEntry): Promise<Inspected> {
  const current = await manifestAt(definition.manifest, definition);
  if (current.server) throw new RemoteError('MF_PRIVATE_MANIFEST', `${definition.name}: the public manifest points to a server build.`);
  const buildId = lock?.buildId ?? current.buildId;
  const manifestUrl = releaseManifest(definition.manifest, buildId);
  if (lock && (lock.manifest !== manifestUrl || lock.buildId !== buildId)) throw new RemoteError('MF_LOCK_MISMATCH', `${definition.name}: lock manifest is outside the configured immutable release location.`);
  const manifest = await manifestAt(manifestUrl, definition, buildId);
  if (manifest.server) throw new RemoteError('MF_PRIVATE_MANIFEST', `${definition.name}: a client release is marked as server-only.`);
  if (current.buildId === buildId && (current.contract !== manifest.contract || current.exports.slice().sort().join() !== manifest.exports.slice().sort().join() || Boolean(current.routes) !== Boolean(manifest.routes))) throw new RemoteError('MF_RELEASE_MISMATCH', `${definition.name}: the current pointer disagrees with its immutable release.`);
  if (!manifest.types) throw new RemoteError('MF_TYPES_MISSING', `${definition.name}: publish a type artifact before syncing the remote.`);
  if (lock && (lock.contract !== manifest.contract || lock.types !== manifest.types)) throw new RemoteError('MF_LOCK_MISMATCH', `${definition.name}: locked contract or type artifact differs from the immutable release.`);
  const resources = [...new Set([manifest.entry, ...manifest.styles, ...manifest.preloads, ...Object.values(manifest.resources ?? {}).flat()])];
  for (const url of resources) {
    const result = await response(url, 'HEAD');
    await result.body?.cancel();
  }
  const artifact = typeArtifact(await jsonResource(manifest.types), definition.name);
  if (definition.serverManifest) {
    const serverUrl = httpUrl(definition.serverManifest.replaceAll('{buildId}', buildId), 'serverManifest');
    const server = await manifestAt(serverUrl, definition, buildId);
    if (server.server !== true || server.contract !== manifest.contract || server.exports.slice().sort().join() !== manifest.exports.slice().sort().join() || Boolean(server.routes) !== Boolean(manifest.routes)) throw new RemoteError('MF_SERVER_MISMATCH', `${definition.name}: server and client releases must share build ID, contract, routes and exports; server must be true.`);
    for (const url of new Set([server.entry, ...server.styles, ...server.preloads, ...Object.values(server.resources ?? {}).flat()])) {
      const result = await response(url, 'HEAD');
      await result.body?.cancel();
    }
  }
  return { definition, manifest, artifact, lock: { buildId, contract: manifest.contract, manifest: manifestUrl, types: manifest.types } };
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

async function safeOutput(root: string, relative: string): Promise<void> {
  let current = root;
  const parts = relative.split('/');
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new RemoteError('MF_UNSAFE_OUTPUT', `Refusing to access symlink output: ${relative}.`);
      const file = index === parts.length - 1 && (relative === lockFile || declaration.test(relative));
      if (file ? !stat.isFile() : !stat.isDirectory()) throw new RemoteError('MF_UNSAFE_OUTPUT', `Unexpected file or directory at output path: ${relative}.`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error; }
  }
}

async function initial(options: { root?: string }): Promise<{ report: MicrofrontendsReport; definitions: Definition[] }> {
  const root = await realpath(resolve(options.root ?? process.cwd()));
  const report: MicrofrontendsReport = { root, diagnostics: [], remotes: {}, written: [] };
  try { return { report, definitions: await readMicrofrontendsConfig(root) }; }
  catch (error) { diagnostic(report, error); return { report, definitions: [] }; }
}

/** Fetch declarations and lock compatible immutable releases without executing configuration or modules. */
export async function syncMicrofrontends(options: { root?: string } = {}): Promise<MicrofrontendsReport> {
  const { report, definitions } = await initial(options);
  const inspected: Inspected[] = [];
  for (const definition of definitions) {
    try {
      const item = await inspect(definition);
      await safeOutput(report.root, `remote-types/${definition.name}`);
      inspected.push(item);
      report.remotes[definition.name] = item.lock;
    } catch (error) { diagnostic(report, error, definition.name); }
  }
  try { await safeOutput(report.root, lockFile); } catch (error) { diagnostic(report, error); }
  if (report.diagnostics.some(item => item.severity === 'error')) return report;
  await commit(report, inspected);
  return report;
}

/** Check current releases, pinned contracts and installed declarations without changing project files. */
export async function checkMicrofrontends(options: { root?: string } = {}): Promise<MicrofrontendsReport> {
  const { report, definitions } = await initial(options);
  let locks: Record<string, unknown> = {};
  try {
    await safeOutput(report.root, lockFile);
    const value = await readJson(join(report.root, lockFile));
    if (!record(value) || value.schema !== 1 || !record(value.remotes)) throw new Error('Invalid lockfile schema.');
    locks = value.remotes;
  } catch { diagnostic(report, new RemoteError('MF_LOCK_MISSING', `Create a valid ${lockFile} using kanso microfrontends sync.`)); }
  for (const definition of definitions) {
    try {
      const raw = locks[definition.name];
      if (!record(raw) || !validBuildId(raw.buildId) || typeof raw.contract !== 'string' || typeof raw.manifest !== 'string' || typeof raw.types !== 'string') throw new RemoteError('MF_LOCK_MISSING', `${definition.name}: no valid pinned release; run kanso microfrontends sync.`);
      const item = await inspect(definition, raw as unknown as RemoteLockEntry);
      report.remotes[definition.name] = item.lock;
      for (const [file, expected] of Object.entries(item.artifact.files)) {
        const path = `remote-types/${definition.name}/${file}`;
        await safeOutput(report.root, path);
        let actual: string;
        try { actual = await readFile(join(report.root, path), 'utf8'); }
        catch { throw new RemoteError('MF_TYPES_MISSING', `${definition.name}: missing ${path}; run kanso microfrontends sync.`); }
        if (actual !== expected) throw new RemoteError('MF_TYPES_CHANGED', `${definition.name}: ${path} differs from the pinned declarations; sync the remote.`);
      }
    } catch (error) { diagnostic(report, error, definition.name); }
  }
  for (const name of Object.keys(locks)) if (!definitions.some(item => item.name === name)) report.diagnostics.push({ code: 'MF_UNUSED_LOCK', severity: 'warning', remote: name, file: lockFile, message: `${name} is locked but no longer configured.`, hint: 'Run kanso microfrontends sync to refresh the lockfile.' });
  return report;
}

async function commit(report: MicrofrontendsReport, inspected: Inspected[]) {
  const stage = await mkdtemp(join(report.root, '.kanso-remotes-'));
  const journal: { target: string; backup: string; moved: boolean; installed: boolean }[] = [];
  let preserveBackup = false;
  try {
    const targets: { relative: string; staged: string }[] = [];
    for (const item of inspected) {
      const staged = join(stage, 'next', item.definition.name);
      for (const [file, content] of Object.entries(item.artifact.files)) {
        const target = join(staged, file);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
        report.written.push(`remote-types/${item.definition.name}/${file}`);
      }
      targets.push({ relative: `remote-types/${item.definition.name}`, staged });
    }
    const stagedLock = join(stage, lockFile);
    await writeFile(stagedLock, JSON.stringify({ schema: 1, remotes: report.remotes }, null, 2) + '\n');
    targets.push({ relative: lockFile, staged: stagedLock });
    await mkdir(join(stage, 'backup'));
    try {
      for (const [index, item] of targets.entries()) {
        await safeOutput(report.root, item.relative);
        const target = join(report.root, item.relative);
        await mkdir(dirname(target), { recursive: true });
        const entry = { target, backup: join(stage, 'backup', String(index)), moved: false, installed: false };
        journal.push(entry);
        if (await exists(target)) { await rename(target, entry.backup); entry.moved = true; }
        await rename(item.staged, target); entry.installed = true;
      }
      report.written.push(lockFile);
    } catch (error) {
      for (const entry of journal.reverse()) {
        try {
          if (entry.installed) await rm(entry.target, { recursive: true, force: true });
          if (entry.moved) await rename(entry.backup, entry.target);
        } catch (rollbackError) {
          preserveBackup = true;
          throw new AggregateError([error, rollbackError], `Cannot restore the sync transaction; original files remain in ${stage}.`);
        }
      }
      throw error;
    }
  } finally { if (!preserveBackup) await rm(stage, { recursive: true, force: true }); }
}
