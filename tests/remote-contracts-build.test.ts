import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedConfig } from 'vite';
import { remoteContractsPlugin } from '../packages/vite/src/remote-contracts.js';

let root: string;
const source = { remotes: [{ name: 'catalog', manifest: 'https://cdn.example.test/catalog/kanso-remote.json', contract: '^1.0.0' }] };
const locked = { schema: 1, remotes: { catalog: { buildId: 'release-a', contract: '1.2.0', manifest: 'https://cdn.example.test/catalog/releases/release-a/kanso-remote.json', types: 'https://cdn.example.test/catalog/releases/release-a/types.json' } } };
const fetcher = vi.fn();
const declaration = 'export type Contract = { components: { Card: (props: { id: string }) => string } };\n';

async function writeJson(file: string, data: unknown) {
  await writeFile(path.join(root, file), JSON.stringify(data));
}

async function check(command: 'serve' | 'build' = 'build') {
  const hook = remoteContractsPlugin().configResolved!;
  const run = typeof hook === 'function' ? hook : hook.handler;
  await run.call({} as never, { command, root } as ResolvedConfig);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'kanso-contract-build-'));
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
  await writeJson('kanso.microfrontends.json', source);
  await writeJson('kanso-remotes.lock.json', locked);
  await mkdir(path.join(root, 'remote-types/catalog'), { recursive: true });
  await writeFile(path.join(root, 'remote-types/catalog/index.d.ts'), declaration);
});

afterEach(async () => {
  expect(fetcher).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

describe('production remote contract locks', () => {
  it('accepts compatible local declarations without downloading or rewriting them', async () => {
    await check();
    expect(await readFile(path.join(root, 'remote-types/catalog/index.d.ts'), 'utf8')).toBe(declaration);
    expect(JSON.parse(await readFile(path.join(root, 'kanso-remotes.lock.json'), 'utf8'))).toEqual(locked);
  });

  it('does not add a contract requirement to ordinary applications', async () => {
    await rm(path.join(root, 'kanso.microfrontends.json'));
    await rm(path.join(root, 'kanso-remotes.lock.json'));
    await check();
  });

  it('leaves development startup available before the initial sync', async () => {
    await rm(path.join(root, 'kanso-remotes.lock.json'));
    await check('serve');
  });

  it('blocks a production build before module execution when the lock is absent', async () => {
    await rm(path.join(root, 'kanso-remotes.lock.json'));
    await expect(check()).rejects.toThrow('MF_TYPES_UNLOCKED');
  });

  it.each(['kanso.microfrontends.json', 'kanso-remotes.lock.json'])('reports malformed JSON in %s without evaluating it', async file => {
    await writeFile(path.join(root, file), 'fetch("https://untrusted.invalid/execute");');
    await expect(check()).rejects.toThrow('MF_TYPES_UNLOCKED');
  });

  it.each([null, [], { schema: 2, remotes: {} }, { schema: 1, remotes: [] }, { schema: 1, remotes: { catalog: null } }, { schema: 1, remotes: { catalog: {} } }])('rejects malformed lock %j', async value => {
    await writeJson('kanso-remotes.lock.json', value);
    await expect(check()).rejects.toThrow('MF_TYPES_UNLOCKED');
  });

  it('requires every configured remote to have its own lock entry', async () => {
    await writeJson('kanso-remotes.lock.json', { schema: 1, remotes: {} });
    await expect(check()).rejects.toThrow('MF_TYPES_UNLOCKED');
  });

  it.each(['2.0.0', '1.3.0-beta.1'])('rejects locked contract %s outside the requested stable range', async contract => {
    await writeJson('kanso-remotes.lock.json', { ...locked, remotes: { catalog: { ...locked.remotes.catalog, contract } } });
    await expect(check()).rejects.toThrow('MF_CONTRACT_MISMATCH');
  });

  it.each(['not-semver', '^1.0.0'])('requires an exact valid version in the lock, received %s', async contract => {
    await writeJson('kanso-remotes.lock.json', { ...locked, remotes: { catalog: { ...locked.remotes.catalog, contract } } });
    await expect(check()).rejects.toThrow('MF_TYPES_UNLOCKED');
  });

  it('rejects an invalid requested range and repeated remote names', async () => {
    await writeJson('kanso.microfrontends.json', { remotes: [{ ...source.remotes[0], contract: 'invalid-range' }] });
    await expect(check()).rejects.toThrow('MF_TYPES_UNLOCKED');
    await writeJson('kanso.microfrontends.json', { remotes: [...source.remotes, ...source.remotes] });
    await expect(check()).rejects.toThrow('MF_DUPLICATE_REMOTE');
  });

  it('requires the local declaration entry to be a file', async () => {
    const file = path.join(root, 'remote-types/catalog/index.d.ts');
    await rm(file);
    await expect(check()).rejects.toThrow('MF_TYPES_MISSING');
    await mkdir(file);
    await expect(check()).rejects.toThrow('MF_TYPES_MISSING');
  });
});
