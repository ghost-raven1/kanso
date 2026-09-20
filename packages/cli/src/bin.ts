#!/usr/bin/env node
import { migrate, createProject, checkSeo, doctor, checkMicrofrontends, syncMicrofrontends } from './index.js';
import type { CreateProjectOptions } from './index.js';

const [command, ...args] = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}.`);
  return value;
};
const options = (name: string) => args.flatMap((item, index) => {
  if (item !== name) return [];
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}.`);
  return [value];
});
try {
  if (command === 'create') {
    const directory = args[0];
    if (!directory || directory.startsWith('-')) throw new Error('Usage: kanso create <directory> [--local <workspace>]');
    const template = option('--template');
    if (template && !['csr', 'ssr', 'microfrontends', 'remote'].includes(template)) throw new Error('Choose --template csr, ssr, microfrontends or remote.');
    await createProject(directory, option('--local'), { template: template as CreateProjectOptions['template'] });
    console.log(`Created ${directory}. Run npm install, then npm run dev inside it.`);
  } else if (command === 'microfrontends') {
    if (!['sync', 'check'].includes(args[0])) throw new Error('Usage: kanso microfrontends sync|check [--root <project>] [--json]');
    const report = await (args[0] === 'sync' ? syncMicrofrontends : checkMicrofrontends)({ root: option('--root') });
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Kanso microfrontends: ${Object.keys(report.remotes).length} remotes checked, ${report.written.length} files written.`);
      for (const item of report.diagnostics) console.log(`${item.file ?? ''}${item.remote ? ` (${item.remote})` : ''} [${item.severity}:${item.code}] ${item.message}\n  ${item.hint ?? ''}`);
    }
    if (report.diagnostics.some(item => item.severity === 'error')) process.exitCode = 2;
  } else if (command === 'doctor') {
    const report = await doctor({ root: option('--root') });
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Kanso doctor: ${report.diagnostics.length} issues.`);
      for (const item of report.diagnostics) console.log(`${item.file} [${item.code}] ${item.message}\n  ${item.hint ?? ''}`);
    }
    if (report.diagnostics.some(item => item.severity === 'error')) process.exitCode = 2;
  } else if (command === 'seo' && args[0] === 'check') {
    const url = option('--url');
    if (!url) throw new Error('Usage: kanso seo check --url <origin/page> [--max-pages 200] [--json]');
    const report = await checkSeo({ url, maxPages: option('--max-pages') === undefined ? undefined : Number(option('--max-pages')) });
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Kanso SEO: ${report.pages} pages checked${report.truncated ? ' (partial audit)' : ''}.`);
      for (const item of report.diagnostics) console.log(`${item.url} [${item.severity}:${item.code}] ${item.field}: ${item.message}`);
    }
    if (report.diagnostics.some(item => item.severity === 'error')) process.exitCode = 2;
  } else if (command === 'migrate') {
    const sourceAliases: Record<string, string> = {};
    for (const value of options('--source-alias')) {
      const separator = value.indexOf('=');
      if (separator < 1 || separator === value.length - 1 || Object.hasOwn(sourceAliases, value.slice(0, separator))) throw new Error('Use unique --source-alias remote/Export=./source.tsx mappings.');
      sourceAliases[value.slice(0, separator)] = value.slice(separator + 1);
    }
    const report = await migrate({ sourceAliases, root: option('--root') ?? process.cwd(), apply: args.includes('--apply'), local: option('--local'), entries: options('--entry'), configs: options('--config') });
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Kanso: ${report.modules} modules checked, ${report.changes.length} proposed file changes.`);
      if (report.coverage) console.log(`Coverage: ${report.coverage.complete ? 'complete selected source graph' : 'partial; unresolved configuration or source edges remain'}. Entries: ${report.coverage.entries.join(', ') || 'none'}.`);
      for (const item of report.diagnostics) console.log(`${item.file}:${item.line ?? 1}:${item.column ?? 1} [${item.code}] ${item.message}\n  ${item.hint ?? ''}`);
      console.log(report.applied ? 'Migration applied. Run npm install and your checks.' : report.diagnostics.some(item => item.severity === 'error') ? 'Blocked. No files changed.' : 'Ready. Use --apply to write these changes.');
    }
    if (report.diagnostics.some(item => item.severity === 'error')) process.exitCode = 2;
  } else {
    console.log('kanso create <directory> [--local <workspace>]\nkanso migrate --check|--apply [--root <project>] [--entry <file>] [--config <file>] [--source-alias remote/Export=./source.tsx] [--local <workspace>] [--json]');
    console.log('kanso doctor [--root <project>] [--json]\nkanso create <directory> --template csr|ssr|microfrontends|remote [--local <workspace>]');
    console.log('kanso seo check --url <origin/page> [--max-pages 200] [--json]');
    console.log('kanso microfrontends sync|check [--root <project>] [--json]');
    if (command && !['--help', '-h', 'help'].includes(command)) process.exitCode = 1;
  }
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
