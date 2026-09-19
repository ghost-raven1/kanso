#!/usr/bin/env node
import { migrate, createProject, checkSeo, doctor } from './index.js';

const [command, ...args] = process.argv.slice(2);
const option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
try {
  if (command === 'create') {
    const directory = args[0];
    if (!directory || directory.startsWith('-')) throw new Error('Usage: kanso create <directory> [--local <workspace>]');
    const template = option('--template');
    if (template && !['csr', 'ssr'].includes(template)) throw new Error('Choose --template csr or ssr.');
    await createProject(directory, option('--local'), { template: template as 'csr' | 'ssr' | undefined });
    console.log(`Created ${directory}. Run npm install, then npm run dev inside it.`);
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
    const report = await migrate({ root: option('--root') ?? process.cwd(), apply: args.includes('--apply'), local: option('--local') });
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Kanso: ${report.modules} modules checked, ${report.changes.length} proposed file changes.`);
      for (const item of report.diagnostics) console.log(`${item.file}:${item.line ?? 1}:${item.column ?? 1} [${item.code}] ${item.message}\n  ${item.hint ?? ''}`);
      console.log(report.applied ? 'Migration applied. Run npm install and your checks.' : report.diagnostics.some(item => item.severity === 'error') ? 'Blocked. No files changed.' : 'Ready. Use --apply to write these changes.');
    }
    if (report.diagnostics.some(item => item.severity === 'error')) process.exitCode = 2;
  } else {
    console.log('kanso create <directory> [--local <workspace>]\nkanso migrate --check|--apply [--root <project>] [--local <workspace>] [--json]');
    console.log('kanso doctor [--root <project>] [--json]\nkanso create <directory> --template csr|ssr [--local <workspace>]');
    console.log('kanso seo check --url <origin/page> [--max-pages 200] [--json]');
    if (command) process.exitCode = 1;
  }
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
