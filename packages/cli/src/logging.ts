interface TerminalOptions {
  isTTY?: boolean;
  env?: { NO_COLOR?: string; TERM?: string };
}

interface PrintableDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  url?: string;
  remote?: string;
  field?: string;
  hint?: string;
  docsUrl?: string;
}

type Level = PrintableDiagnostic['severity'] | 'info' | 'success';
const colors: Record<Level, number> = { error: 31, warning: 33, info: 36, success: 32 };
const indent = (value: string, spaces: number) => value.replaceAll('\n', `\n${' '.repeat(spaces)}`);

function location(item: PrintableDiagnostic): string | undefined {
  if (!item.file) return item.url;
  let value = item.file;
  if (item.line !== undefined) {
    value += `:${item.line}`;
    if (item.column !== undefined) value += `:${item.column}`;
    if (item.endLine !== undefined) {
      value += `-${item.endLine}`;
      if (item.endColumn !== undefined) value += `:${item.endColumn}`;
    }
  }
  return value;
}

/** Format human CLI output without changing report objects or machine-readable output. */
export function createTerminalFormatter(options: TerminalOptions = {}) {
  const env = options.env ?? process.env;
  const colored = Boolean(options.isTTY ?? process.stdout.isTTY)
    && env.NO_COLOR === undefined && env.TERM !== 'dumb';
  const paint = (code: number, value: string) => colored ? `\u001b[${code}m${value}\u001b[0m` : value;
  const message = (level: Level, value: string) => `${paint(colors[level], level.toUpperCase())}  ${indent(value, 2)}`;
  const diagnostic = (item: PrintableDiagnostic): string => {
    const lines = [`  ${indent(message(item.severity, `[${item.code}] ${item.message}`), 2)}`];
    const at = location(item);
    if (at) lines.push(`    at ${at}`);
    if (item.remote) lines.push(`    Remote: ${item.remote}`);
    if (item.field) lines.push(`    Field: ${item.field}`);
    if (item.hint?.trim()) lines.push(`    Fix: ${indent(item.hint, 4)}`);
    if (item.docsUrl) lines.push(`    Docs: ${item.docsUrl}`);
    return lines.join('\n');
  };
  const report = (command: string, summary: string, diagnostics: readonly PrintableDiagnostic[]): string => {
    const errors = diagnostics.filter(item => item.severity === 'error').length;
    const warnings = diagnostics.length - errors;
    const outcome = message(errors ? 'error' : warnings ? 'warning' : 'success',
      `${errors} ${errors === 1 ? 'error' : 'errors'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}.`);
    return [
      paint(1, `Kanso ${command}`),
      `  ${summary}`,
      ...diagnostics.map(item => `\n${diagnostic(item)}`),
      `\n${outcome}`,
    ].join('\n');
  };
  return { message, diagnostic, report };
}
