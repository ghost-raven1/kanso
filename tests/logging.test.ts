import { afterEach, expect, it, vi } from 'vitest';
import { createTerminalFormatter } from '../packages/cli/src/logging.js';

const commands = vi.hoisted(() => ({
  migrate: vi.fn(),
  createProject: vi.fn(),
  checkSeo: vi.fn(),
  doctor: vi.fn(),
  checkMicrofrontends: vi.fn(),
  syncMicrofrontends: vi.fn(),
}));
vi.mock('../packages/cli/src/index.js', () => commands);

const plain = createTerminalFormatter({ isTTY: false, env: {} });
const originalArgv = process.argv;
const originalExitCode = process.exitCode;
afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it('shows original diagnostic codes, exact ranges and multiline fixes', () => {
  const item = {
    severity: 'error' as const,
    code: 'KANSO_PURITY',
    message: 'Cannot infer purity.\nThe dependency changes.',
    file: 'src/Profile.tsx', line: 12, column: 3, endLine: 14, endColumn: 9,
    hint: 'Use an explicit memo:\nconst name = useMemo(() => normalize(user));',
    docsUrl: 'https://example.com/compiler',
  };
  const before = JSON.stringify(item);
  expect(plain.diagnostic(item)).toBe([
    '  ERROR  [KANSO_PURITY] Cannot infer purity.',
    '    The dependency changes.',
    '    at src/Profile.tsx:12:3-14:9',
    '    Fix: Use an explicit memo:',
    '    const name = useMemo(() => normalize(user));',
    '    Docs: https://example.com/compiler',
  ].join('\n'));
  expect(JSON.stringify(item)).toBe(before);
});

it('does not invent source coordinates or leave empty hint lines', () => {
  expect(plain.diagnostic({ severity: 'error', code: 'PACKAGE_MISSING', message: 'Package missing.', file: 'package.json', hint: '' }))
    .toBe('  ERROR  [PACKAGE_MISSING] Package missing.\n    at package.json');
  expect(plain.diagnostic({ severity: 'warning', code: 'CHECK', message: 'Review this expression.', file: 'src/App.tsx', line: 8 }))
    .toBe('  WARNING  [CHECK] Review this expression.\n    at src/App.tsx:8');
});

it('keeps remote and SEO context alongside the diagnostic', () => {
  expect(plain.diagnostic({ severity: 'error', code: 'MF_LOCK_MISSING', message: 'Sync the remote.', remote: 'catalog' }))
    .toBe('  ERROR  [MF_LOCK_MISSING] Sync the remote.\n    Remote: catalog');
  expect(plain.diagnostic({ severity: 'warning', code: 'SEO_MISSING', message: 'Add a title.', url: 'https://example.com/products', field: 'title' }))
    .toBe('  WARNING  [SEO_MISSING] Add a title.\n    at https://example.com/products\n    Field: title');
});

it('summarizes errors and warnings separately while retaining diagnostic order', () => {
  const output = plain.report('doctor', 'Configuration checked.', [
    { severity: 'warning', code: 'FIRST', message: 'Review.' },
    { severity: 'error', code: 'SECOND', message: 'Fix.' },
  ]);
  expect(output).toBe('Kanso doctor\n  Configuration checked.\n\n  WARNING  [FIRST] Review.\n\n  ERROR  [SECOND] Fix.\n\nERROR  1 error, 1 warning.');
  expect(plain.report('SEO', '1 page checked.', [])).toBe('Kanso SEO\n  1 page checked.\n\nSUCCESS  0 errors, 0 warnings.');
  expect(plain.report('SEO', '1 page checked.', [{ severity: 'warning', code: 'SEO_MISSING', message: 'Add a title.' }])).toContain('WARNING  0 errors, 1 warning.');
});

it('uses color only for an interactive terminal without NO_COLOR or TERM=dumb', () => {
  expect(createTerminalFormatter({ isTTY: true, env: {} }).message('error', 'Fix this.')).toBe('\u001b[31mERROR\u001b[0m  Fix this.');
  for (const options of [
    { isTTY: false, env: {} },
    { isTTY: true, env: { NO_COLOR: '' } },
    { isTTY: true, env: { NO_COLOR: '0' } },
    { isTTY: true, env: { TERM: 'dumb' } },
  ]) expect(createTerminalFormatter(options).report('doctor', 'Checked.', [])).not.toContain('\u001b');
});

async function run(args: string[]) {
  process.argv = [process.execPath, 'kanso', ...args];
  process.exitCode = undefined;
  vi.stubEnv('NO_COLOR', '1');
  const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.resetModules();
  await import('../packages/cli/src/bin.js');
  return { stdout: stdout.mock.calls, stderr: stderr.mock.calls, code: process.exitCode ?? 0 };
}

const error = { severity: 'error', code: 'TEST_ERROR', file: 'src/App.tsx', message: 'Fix the source.', hint: 'Use a supported expression.' } as const;
const migration = { modules: 1, changes: [], applied: false, diagnostics: [error], coverage: { complete: true, entries: ['src/App.tsx'], configs: [], files: ['src/App.tsx'] } };
const doctorReport = { root: '/project', versions: { node: '20.19.0' }, diagnostics: [error] };
const seo = { pages: 1, truncated: false, diagnostics: [{ severity: 'error', code: 'SEO_DUPLICATE', url: 'https://example.com', field: 'title', message: 'Keep one title.' }] };
const microfrontends = { root: '/project', remotes: {}, written: [], diagnostics: [error] };

it.each([
  { name: 'migrate', args: ['migrate', '--check'], mock: 'migrate', report: migration },
  { name: 'doctor', args: ['doctor'], mock: 'doctor', report: doctorReport },
  { name: 'SEO', args: ['seo', 'check', '--url', 'https://example.com'], mock: 'checkSeo', report: seo },
  { name: 'remote check', args: ['microfrontends', 'check'], mock: 'checkMicrofrontends', report: microfrontends },
  { name: 'remote sync', args: ['microfrontends', 'sync'], mock: 'syncMicrofrontends', report: microfrontends },
] as const)('preserves the exact JSON output and error exit code for $name', async ({ args, mock, report }) => {
  commands[mock].mockResolvedValue(report);
  const result = await run([...args, '--json']);
  expect(result).toEqual({ stdout: [[JSON.stringify(report, null, 2)]], stderr: [], code: 2 });
});

it('renders migration coverage and blocked status without extra source guesses', async () => {
  commands.migrate.mockResolvedValue(migration);
  const result = await run(['migrate', '--check']);
  expect(result.stdout).toEqual([
    [plain.report('migrate', '1 modules checked, 0 proposed file changes.', [error])],
    ['INFO  Coverage: complete selected source graph.\n  Entries: src/App.tsx.'],
    ['ERROR  Blocked. No files changed.'],
  ]);
  expect(result.code).toBe(2);
});

it('keeps warnings successful and makes a partial SEO audit visible', async () => {
  commands.checkSeo.mockResolvedValue({ pages: 2, truncated: true, diagnostics: [{ severity: 'warning', code: 'SEO_TRUNCATED', url: 'https://example.com', field: 'max-pages', message: 'Increase --max-pages.' }] });
  const result = await run(['seo', 'check', '--url', 'https://example.com']);
  expect(result.code).toBe(0);
  expect(result.stdout[0][0]).toContain('2 pages checked (partial audit).');
  expect(result.stdout[0][0]).toContain('WARNING  0 errors, 1 warning.');
});

it.each([false, true])('keeps execution failures on stderr with exit 1 (json=%s)', async json => {
  commands.doctor.mockRejectedValue(new Error('Cannot read package.json.'));
  const result = await run(['doctor', ...(json ? ['--json'] : [])]);
  expect(result).toEqual({ stdout: [], stderr: [[json ? 'Cannot read package.json.' : 'ERROR  Cannot read package.json.']], code: 1 });
});
