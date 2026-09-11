import { format } from 'node:util';
import { vi } from 'vitest';

export interface Captured<T> {
  stdout: string;
  stderr: string;
  result?: T;
  error?: unknown;
}

/**
 * Run `fn` and collect everything it printed.
 *
 * @oclif/test's captureOutput only patches process.stdout/stderr.write, which
 * misses Command.log — oclif routes that through console.log, and vitest
 * intercepts the console before the patched stream method is reached. Commands
 * here use both (emit() writes to the stream directly, this.log doesn't), so
 * both paths are captured.
 */
export async function captureConsole<T>(fn: () => Promise<T>): Promise<Captured<T>> {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    stdout.push(format(...args) + '\n');
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    stderr.push(format(...args) + '\n');
  });
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout.push(chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr.push(chunk.toString());
    return true;
  }) as typeof process.stderr.write;

  try {
    const result = await fn();
    return { result, stdout: stdout.join(''), stderr: stderr.join('') };
  } catch (error) {
    return { error, stdout: stdout.join(''), stderr: stderr.join('') };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }
}

/**
 * Run `fn` as if stdout were a terminal.
 *
 * Output defaults to JSON whenever stdout isn't a TTY, so this is how the
 * human-readable rendering gets exercised under vitest.
 */
export async function asTty<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.stdout.isTTY;
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process.stdout, 'isTTY', { value: original, configurable: true });
  }
}
