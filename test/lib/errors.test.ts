import { describe, it, expect, afterEach } from 'vitest';
import { Errors } from '@oclif/core';
import { SendLayerAPIError, SendLayerError } from 'sendlayer';
import {
  describeError,
  ExitCodes,
  exitWith,
  failWith,
  handleError,
  isUsageError,
} from '../../src/lib/errors';

describe('describeError', () => {
  it('maps SendLayerAPIError 401 to AUTH_INVALID exit code', () => {
    const err = new SendLayerAPIError('unauthorized', 401, { foo: 'bar' });
    const desc = describeError(err);
    expect(desc.exitCode).toBe(ExitCodes.AUTH_INVALID);
    expect(desc.code).toBe('API_ERROR');
  });

  it('maps SendLayerAPIError 500 to API exit code', () => {
    const err = new SendLayerAPIError('boom', 500, {});
    expect(describeError(err).exitCode).toBe(ExitCodes.API);
  });

  it('maps generic SendLayerError to VALIDATION exit code', () => {
    const err = new SendLayerError('bad input');
    expect(describeError(err).exitCode).toBe(ExitCodes.VALIDATION);
  });

  it('handles plain Error', () => {
    expect(describeError(new Error('x')).exitCode).toBe(ExitCodes.GENERIC);
  });

  it('handles non-Error throwables', () => {
    expect(describeError('something bad').exitCode).toBe(ExitCodes.GENERIC);
    expect(describeError('something bad').message).toBe('something bad');
  });
});

describe('isUsageError', () => {
  it('recognises an oclif parse error', () => {
    // oclif's parse errors are CLIErrors carrying a `parse` payload; that is
    // what separates them from an ordinary CLIError.
    const err = new Errors.CLIError('Missing required flag event');
    (err as unknown as { parse: unknown }).parse = { input: {} };
    expect(isUsageError(err)).toBe(true);
    expect(describeError(err)).toMatchObject({ code: 'USAGE', exitCode: ExitCodes.USAGE });
  });

  it('does not treat a plain CLIError or Error as a usage error', () => {
    expect(isUsageError(new Errors.CLIError('boom'))).toBe(false);
    expect(isUsageError(new Error('boom'))).toBe(false);
    expect(isUsageError('boom')).toBe(false);
  });

  it('does not treat an ExitError as a usage error', () => {
    expect(isUsageError(new Errors.ExitError(2))).toBe(false);
  });
});

describe('exitWith / handleError', () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('throws an ExitError carrying the code instead of exiting', () => {
    // Regression: handleError called process.exit() immediately after writing,
    // which can truncate output on a pipe. Throwing hands control to oclif,
    // which flushes first.
    let thrown: unknown;
    try {
      exitWith(ExitCodes.API);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Errors.ExitError);
    expect((thrown as { oclif?: { exit?: number } }).oclif?.exit).toBe(ExitCodes.API);
    expect(process.exitCode).toBe(ExitCodes.API);
  });

  it('reports the error and exits with its classified code', () => {
    const written: string[] = [];
    const original = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      written.push(chunk.toString());
      return true;
    }) as typeof process.stderr.write;

    try {
      expect(() => handleError({ json: true }, new SendLayerAPIError('nope', 401, {}))).toThrow(
        Errors.ExitError,
      );
    } finally {
      process.stderr.write = original;
    }

    expect(JSON.parse(written.join(''))).toMatchObject({ code: 'API_ERROR' });
    expect(process.exitCode).toBe(ExitCodes.AUTH_INVALID);
  });

  it('honours an explicit payload via failWith', () => {
    const original = process.stderr.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      expect(() =>
        failWith({ json: true }, { message: 'rejected', exitCode: ExitCodes.AUTH_INVALID }),
      ).toThrow(Errors.ExitError);
    } finally {
      process.stderr.write = original;
    }
    expect(process.exitCode).toBe(ExitCodes.AUTH_INVALID);
  });
});
