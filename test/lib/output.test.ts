import { describe, it, expect } from 'vitest';
import { asTty } from '../helpers/capture-console';
import { drainOutput, emit, emitError, isJsonMode, table } from '../../src/lib/output';

/** Collect one synchronous write to the given stream. */
function captureStream(name: 'stdout' | 'stderr', fn: () => void): string {
  const chunks: string[] = [];
  const original = process[name].write;
  process[name].write = ((chunk: string | Uint8Array) => {
    chunks.push(chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process[name].write = original;
  }
  return chunks.join('');
}

const captureStdout = (fn: () => void): string => captureStream('stdout', fn);
const captureStderr = (fn: () => void): string => captureStream('stderr', fn);

describe('isJsonMode', () => {
  it('returns true when --json flag is set', () => {
    expect(isJsonMode({ json: true })).toBe(true);
  });

  it('returns true when stdout is not a TTY', () => {
    const original = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    expect(isJsonMode(undefined)).toBe(true);
    Object.defineProperty(process.stdout, 'isTTY', { value: original, configurable: true });
  });
});

describe('table', () => {
  it('renders aligned rows', () => {
    const out = table([
      { id: 1, name: 'a' },
      { id: 22, name: 'bb' },
    ]);
    expect(out).toContain('id');
    expect(out).toContain('name');
    expect(out).toContain('22');
    expect(out).toContain('bb');
  });

  it('returns dim placeholder when no rows', () => {
    expect(table([])).toContain('no records');
  });
});

describe('emit', () => {
  it('writes the JSON payload in JSON mode and ignores the pretty renderer', () => {
    const written = captureStdout(() =>
      emit({ json: true }, { MessageID: 'msg_1' }, () => 'should not be used'),
    );
    expect(JSON.parse(written)).toEqual({ MessageID: 'msg_1' });
    expect(written).not.toContain('should not be used');
  });

  it('writes the pretty rendering when attached to a terminal', async () => {
    const written = await asTty(async () =>
      captureStdout(() => emit(undefined, { MessageID: 'msg_1' }, () => 'Queued msg_1')),
    );
    expect(written.trim()).toBe('Queued msg_1');
  });
});

describe('emitError', () => {
  it('writes error, code and details as JSON', () => {
    const written = captureStderr(() =>
      emitError({ json: true }, {
        message: 'upstream is down',
        code: 'API_ERROR',
        details: { statusCode: 500 },
      }),
    );
    expect(JSON.parse(written)).toEqual({
      error: 'upstream is down',
      code: 'API_ERROR',
      details: { statusCode: 500 },
    });
  });

  it('writes a human-readable message when attached to a terminal', async () => {
    const written = await asTty(async () =>
      captureStderr(() => emitError(undefined, { message: 'no API key' })),
    );
    expect(written).toContain('Error: no API key');
  });
});

describe('drainOutput', () => {
  it('resolves once the streams have accepted their output', async () => {
    await expect(drainOutput()).resolves.toBeUndefined();
  });
});
