import { Errors } from '@oclif/core';
import { SendLayerAPIError, SendLayerError } from 'sendlayer';
import { emitError } from './output';

export const ExitCodes = {
  OK: 0,
  GENERIC: 1,
  USAGE: 2,
  AUTH_MISSING: 3,
  AUTH_INVALID: 4,
  VALIDATION: 5,
  API: 6,
  NETWORK: 7,
  INTERRUPTED: 130,
} as const;

export interface CliErrorPayload {
  message: string;
  code?: string;
  details?: unknown;
  exitCode: number;
}

/**
 * oclif's own parse errors (missing required flag, bad --flag value, unexpected
 * argument). They already carry a rendered message and the `--help` output, so
 * they are re-thrown rather than reformatted — see BaseCommand.catch.
 */
export function isUsageError(err: unknown): err is Errors.CLIError & { parse?: unknown } {
  return err instanceof Errors.CLIError && 'parse' in err;
}

export function describeError(err: unknown): CliErrorPayload {
  if (isUsageError(err)) {
    return { message: err.message, code: 'USAGE', exitCode: ExitCodes.USAGE };
  }
  if (err instanceof SendLayerAPIError) {
    return {
      message: err.message,
      code: 'API_ERROR',
      details: { statusCode: err.statusCode, response: err.response },
      exitCode: err.statusCode === 401 || err.statusCode === 403 ? ExitCodes.AUTH_INVALID : ExitCodes.API,
    };
  }
  if (err instanceof SendLayerError) {
    return { message: err.message, code: err.name, exitCode: ExitCodes.VALIDATION };
  }
  if (err instanceof Error) {
    return { message: err.message, code: err.name, exitCode: ExitCodes.GENERIC };
  }
  return { message: String(err), exitCode: ExitCodes.GENERIC };
}

/**
 * Stop the command with `code`.
 *
 * Throwing oclif's ExitError rather than calling process.exit() hands control
 * back to oclif, which flushes output before exiting. BaseCommand.catch drains
 * stdout/stderr on the way through.
 */
export function exitWith(code: number): never {
  process.exitCode = code;
  throw new Errors.ExitError(code);
}

/** Report an already-described failure and stop with its exit code. */
export function failWith(flags: { json?: boolean } | undefined, payload: CliErrorPayload): never {
  emitError(flags, payload);
  exitWith(payload.exitCode);
}

export function handleError(flags: { json?: boolean } | undefined, err: unknown): never {
  failWith(flags, describeError(err));
}
