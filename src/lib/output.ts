import chalk from 'chalk';

export function isJsonMode(flags: { json?: boolean } | undefined): boolean {
  if (flags?.json) return true;
  // Auto-detect non-TTY (CI, pipes) and emit JSON.
  return !process.stdout.isTTY;
}

export function emit(flags: { json?: boolean } | undefined, payload: unknown, prettyRenderer: () => string): void {
  if (isJsonMode(flags)) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }
  process.stdout.write(prettyRenderer() + '\n');
}

export function emitError(flags: { json?: boolean } | undefined, error: { message: string; code?: string; details?: unknown }): void {
  if (isJsonMode(flags)) {
    process.stderr.write(JSON.stringify({ error: error.message, code: error.code, details: error.details }, null, 2) + '\n');
    return;
  }
  process.stderr.write(chalk.red(`Error: ${error.message}`) + '\n');
  if (error.details) {
    process.stderr.write(chalk.dim(JSON.stringify(error.details, null, 2)) + '\n');
  }
}

export function table(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  if (rows.length === 0) return chalk.dim('(no records)');
  const cols = columns || Object.keys(rows[0]);
  const widths: Record<string, number> = {};
  for (const c of cols) {
    widths[c] = c.length;
    for (const row of rows) {
      const val = String(row[c] ?? '');
      if (val.length > widths[c]) widths[c] = val.length;
    }
  }
  const header = cols.map((c) => chalk.bold(c.padEnd(widths[c]))).join('  ');
  const sep = cols.map((c) => '-'.repeat(widths[c])).join('  ');
  const body = rows
    .map((row) => cols.map((c) => String(row[c] ?? '').padEnd(widths[c])).join('  '))
    .join('\n');
  return `${header}\n${sep}\n${body}`;
}
