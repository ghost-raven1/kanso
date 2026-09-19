import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkMicrofrontends, syncMicrofrontends } from '../packages/cli/src/microfrontends.js';
import { RUNTIME_VERSIONS, type RemoteManifest } from '@kanso/microfrontends/manifest';

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture(names = ['catalog']) {
  const root = await mkdtemp(join(tmpdir(), 'kanso-mf-cli-')); roots.push(root);
  const resources = new Map<string, { body: string; status?: number; head?: number }>();
  const requests: { method: string; path: string }[] = [];
  const server = createServer((request, response) => {
    const path = request.url!;
    requests.push({ method: request.method!, path });
    const resource = resources.get(path);
    response.writeHead(resource ? (request.method === 'HEAD' ? resource.head ?? resource.status ?? 200 : resource.status ?? 200) : 404);
    response.end(resource?.body ?? 'Not found');
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const definitions = names.map(name => ({ name, contract: '^1.0.0', manifest: `${origin}/${name}/kanso-remote.json`, serverManifest: `${origin}/private/${name}/{buildId}/kanso-remote.json` }));
  const put = (path: string, value: unknown) => resources.set(path, { body: typeof value === 'string' ? value : JSON.stringify(value) });
  function release(name: string, buildId = 'A') {
    const prefix = `/${name}/releases/${buildId}`;
    const manifest: RemoteManifest = {
      schema: 1, name, buildId, contract: '1.0.0', runtime: { ...RUNTIME_VERSIONS }, exports: ['Card'], routes: true,
      entry: `${origin}${prefix}/entry.js`, styles: [`${origin}${prefix}/style.css`], preloads: [`${origin}${prefix}/dependency.js`], types: `${origin}${prefix}/types.json`,
    };
    const types = { schema: 1, files: { 'index.d.ts': `export type Contract = { Card: (props: { release: '${buildId}' }) => unknown };\n`, 'models/product.d.ts': 'export interface Product { id: string }\n' } };
    const serverManifest = { ...manifest, server: true, entry: `${origin}/private/${name}/${buildId}/entry.js` };
    put(`/${name}/kanso-remote.json`, manifest);
    put(`${prefix}/kanso-remote.json`, manifest);
    put(`${prefix}/types.json`, types);
    put(`${prefix}/entry.js`, 'throw new Error("The checker must never execute entry code");');
    put(`${prefix}/dependency.js`, 'export {};');
    put(`${prefix}/style.css`, 'body { color: black; }');
    put(`/private/${name}/${buildId}/kanso-remote.json`, serverManifest);
    put(`/private/${name}/${buildId}/entry.js`, 'throw new Error("Server handlers must not execute during checks");');
    return { manifest, types, serverManifest, prefix };
  }
  const releases = Object.fromEntries(names.map(name => [name, release(name)]));
  await writeFile(join(root, 'kanso.microfrontends.json'), JSON.stringify({ remotes: definitions }, null, 2));
  return { root, resources, requests, definitions, releases, release, put, origin };
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const files = await readdir(root, { recursive: true, withFileTypes: true });
  const values: Record<string, string> = {};
  for (const file of files) if (file.isFile()) {
    const path = join(file.parentPath, file.name);
    values[path.slice(root.length + 1)] = await readFile(path, 'utf8');
  }
  return values;
}

describe('microfrontend CLI', () => {
  it('checks export resources before writing declarations', async () => {
    const test = await fixture();
    const manifest = { ...test.releases.catalog.manifest, resources: { Card: [`${test.origin}/catalog/releases/A/Card.js`] } };
    test.put('/catalog/kanso-remote.json', manifest);
    test.put('/catalog/releases/A/kanso-remote.json', manifest);
    const before = await snapshot(test.root);
    const failed = await syncMicrofrontends({ root: test.root });
    expect(failed.diagnostics).toContainEqual(expect.objectContaining({ code: 'MF_RESOURCE_UNAVAILABLE' }));
    expect(await snapshot(test.root)).toEqual(before);
    test.put('/catalog/releases/A/Card.js', 'export default {};');
    expect((await syncMicrofrontends({ root: test.root })).diagnostics).toEqual([]);
    expect(test.requests).toContainEqual({ method: 'HEAD', path: '/catalog/releases/A/Card.js' });
  });
  it('syncs declarations and immutable locks, checks read-only, and is content-idempotent', async () => {
    const test = await fixture();
    const synced = await syncMicrofrontends({ root: test.root });
    expect(synced.diagnostics).toEqual([]);
    expect(synced.written).toContain('remote-types/catalog/models/product.d.ts');
    expect(synced.remotes.catalog).toMatchObject({ buildId: 'A', contract: '1.0.0', manifest: `${test.origin}/catalog/releases/A/kanso-remote.json` });
    const before = await snapshot(test.root);
    const checked = await checkMicrofrontends({ root: test.root });
    expect(checked.diagnostics).toEqual([]);
    expect(checked.written).toEqual([]);
    expect(await snapshot(test.root)).toEqual(before);
    expect((await syncMicrofrontends({ root: test.root })).diagnostics).toEqual([]);
    expect(await snapshot(test.root)).toEqual(before);
    expect(test.requests.filter(request => request.path.endsWith('.js')).every(request => request.method === 'HEAD')).toBe(true);
  });

  it('continues checking the pinned release after an independent update, then syncs explicitly', async () => {
    const test = await fixture();
    await syncMicrofrontends({ root: test.root });
    const before = await snapshot(test.root);
    test.release('catalog', 'B');
    const checked = await checkMicrofrontends({ root: test.root });
    expect(checked.diagnostics).toEqual([]);
    expect(checked.remotes.catalog.buildId).toBe('A');
    expect(await snapshot(test.root)).toEqual(before);
    expect((await syncMicrofrontends({ root: test.root })).remotes.catalog.buildId).toBe('B');
    expect(await readFile(join(test.root, 'remote-types/catalog/index.d.ts'), 'utf8')).toContain("release: 'B'");
  });

  it('preflights all remotes before writing when a later remote is unavailable', async () => {
    const test = await fixture(['catalog', 'reviews']);
    const before = await snapshot(test.root);
    test.resources.delete('/reviews/releases/A/style.css');
    const result = await syncMicrofrontends({ root: test.root });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ remote: 'reviews', code: 'MF_RESOURCE_UNAVAILABLE', severity: 'error' }));
    expect(result.written).toEqual([]);
    expect(await snapshot(test.root)).toEqual(before);
  });

  it.each(['../outside.d.ts', '/outside.d.ts', 'nested/../outside.d.ts', 'nested\\outside.d.ts', 'execute.js'])('rejects unsafe declaration path %s before any write', async path => {
    const test = await fixture();
    await syncMicrofrontends({ root: test.root });
    const before = await snapshot(test.root);
    test.put('/catalog/releases/A/types.json', { schema: 1, files: { 'index.d.ts': 'export type Contract = {};', [path]: 'malicious' } });
    const result = await syncMicrofrontends({ root: test.root });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'MF_INVALID_TYPE_PATH' }));
    expect(await snapshot(test.root)).toEqual(before);
  });

  it('rejects output symlinks and does not alter their targets', async () => {
    const test = await fixture();
    const outside = await mkdtemp(join(tmpdir(), 'kanso-mf-outside-')); roots.push(outside);
    await writeFile(join(outside, 'keep.txt'), 'Keep this');
    await symlink(outside, join(test.root, 'remote-types'), 'dir');
    const result = await syncMicrofrontends({ root: test.root });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'MF_UNSAFE_OUTPUT' }));
    expect(await readdir(outside)).toEqual(['keep.txt']);
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('Keep this');
  });

  it.each([
    ['MF_RUNTIME_MISMATCH', { runtime: { ...RUNTIME_VERSIONS, 'solid-js': '1.0.0' } }],
    ['MF_CONTRACT_MISMATCH', { contract: '2.0.0' }],
    ['MF_INVALID_EXPORTS', { exports: ['Card', 'Card'] }],
    ['MF_PRIVATE_MANIFEST', { server: true }],
  ])('reports %s without importing code', async (code, patch) => {
    const test = await fixture();
    test.put('/catalog/kanso-remote.json', { ...test.releases.catalog.manifest, ...patch });
    const result = await syncMicrofrontends({ root: test.root });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code }));
    expect(result.written).toEqual([]);
  });

  it('checks the private server manifest and resources against the same release', async () => {
    const test = await fixture();
    test.put('/private/catalog/A/kanso-remote.json', { ...test.releases.catalog.serverManifest, server: false });
    expect((await syncMicrofrontends({ root: test.root })).diagnostics).toContainEqual(expect.objectContaining({ code: 'MF_SERVER_MISMATCH' }));
    test.put('/private/catalog/A/kanso-remote.json', { ...test.releases.catalog.serverManifest, buildId: 'B' });
    expect((await syncMicrofrontends({ root: test.root })).diagnostics).toContainEqual(expect.objectContaining({ code: 'MF_RELEASE_MISMATCH' }));
  });

  it('uses GET when a resource server does not implement HEAD', async () => {
    const test = await fixture();
    test.resources.get('/catalog/releases/A/entry.js')!.head = 405;
    expect((await syncMicrofrontends({ root: test.root })).diagnostics).toEqual([]);
    expect(test.requests).toContainEqual({ path: '/catalog/releases/A/entry.js', method: 'GET' });
  });

  it('detects changed declarations, missing locks and paths outside the configured release', async () => {
    const test = await fixture();
    expect((await checkMicrofrontends({ root: test.root })).diagnostics).toContainEqual(expect.objectContaining({ code: 'MF_LOCK_MISSING' }));
    await syncMicrofrontends({ root: test.root });
    await writeFile(join(test.root, 'remote-types/catalog/index.d.ts'), 'export type Contract = {};');
    expect((await checkMicrofrontends({ root: test.root })).diagnostics).toContainEqual(expect.objectContaining({ code: 'MF_TYPES_CHANGED' }));
    await syncMicrofrontends({ root: test.root });
    const lock = JSON.parse(await readFile(join(test.root, 'kanso-remotes.lock.json'), 'utf8'));
    lock.remotes.catalog.manifest = `${test.origin}/other/kanso-remote.json`;
    await writeFile(join(test.root, 'kanso-remotes.lock.json'), JSON.stringify(lock));
    expect((await checkMicrofrontends({ root: test.root })).diagnostics).toContainEqual(expect.objectContaining({ code: 'MF_LOCK_MISMATCH' }));
  });

  it('does not execute config files or accept duplicate definitions and commented-out contracts', async () => {
    const test = await fixture();
    await writeFile(join(test.root, 'kanso.microfrontends.js'), 'throw new Error("Do not execute application configuration");');
    test.put('/catalog/releases/A/types.json', { schema: 1, files: { 'index.d.ts': '// export type Contract = {};\nexport type Other = {};\n' } });
    expect((await syncMicrofrontends({ root: test.root })).diagnostics).toContainEqual(expect.objectContaining({ code: 'MF_INVALID_TYPES' }));
    await writeFile(join(test.root, 'kanso.microfrontends.json'), JSON.stringify({ remotes: [test.definitions[0], test.definitions[0]] }));
    expect((await syncMicrofrontends({ root: test.root })).diagnostics).toContainEqual(expect.objectContaining({ code: 'MF_DUPLICATE_REMOTE' }));
  });
});
