import { describe, it, expect, afterEach } from 'vitest';
import { Errors } from '@oclif/core';
import {
  SendLayerAPIError,
  SendLayerAuthenticationError,
  SendLayerError,
  SendLayerInternalServerError,
  SendLayerNotFoundError,
  SendLayerRateLimitError,
  SendLayerValidationError,
} from 'sendlayer';
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

  // sendlayer 1.1 raises these instead of SendLayerAPIError. They extend
  // SendLayerError directly, and used to fall through to VALIDATION.
  it('maps SendLayerAuthenticationError to AUTH_INVALID exit code', () => {
    const err = new SendLayerAuthenticationError('Invalid API key', 401, {});
    expect(describeError(err)).toMatchObject({ code: 'API_ERROR', exitCode: ExitCodes.AUTH_INVALID });
  });

  it.each([
    ['SendLayerNotFoundError', new SendLayerNotFoundError('missing', 404, {})],
    ['SendLayerRateLimitError', new SendLayerRateLimitError('slow down', 429, {})],
    ['SendLayerInternalServerError', new SendLayerInternalServerError('boom', 500, {})],
  ])('maps %s to API exit code with its status', (_name, err) => {
    const desc = describeError(err);
    expect(desc.exitCode).toBe(ExitCodes.API);
    expect(desc.details).toMatchObject({ statusCode: err.statusCode });
  });

  it('maps SendLayerValidationError to VALIDATION exit code, local or from the API', () => {
    expect(describeError(new SendLayerValidationError('bad input')).exitCode).toBe(ExitCodes.VALIDATION);
    expect(describeError(new SendLayerValidationError('bad input', 422, {})).exitCode).toBe(ExitCodes.VALIDATION);
  });

  it('maps a status-less SendLayerError (timeout, transport failure) to NETWORK exit code', () => {
    const err = new SendLayerError('Request timed out: timeout of 30000ms exceeded');
    expect(describeError(err)).toMatchObject({ code: 'NETWORK_ERROR', exitCode: ExitCodes.NETWORK });
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
