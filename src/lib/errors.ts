import { Errors } from '@oclif/core';
import { SendLayerAuthenticationError, SendLayerError, SendLayerValidationError } from 'sendlayer';
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
  // Since sendlayer 1.1 most HTTP failures arrive as sibling subclasses of
  // SendLayerError (Authentication, NotFound, RateLimit, InternalServer), not
  // as SendLayerAPIError, so classify by type and statusCode rather than by
  // SendLayerAPIError alone.
  if (err instanceof SendLayerValidationError) {
    return { message: err.message, code: err.name, exitCode: ExitCodes.VALIDATION };
  }
  if (err instanceof SendLayerError && err.statusCode !== undefined) {
    return {
      message: err.message,
      code: 'API_ERROR',
      details: { statusCode: err.statusCode, response: err.response },
      exitCode:
        err instanceof SendLayerAuthenticationError || err.statusCode === 401 || err.statusCode === 403
          ? ExitCodes.AUTH_INVALID
          : ExitCodes.API,
    };
  }
  if (err instanceof SendLayerError) {
    // Without a status the request never got a response: the SDK raises these
    // for timeouts and transport failures.
    return { message: err.message, code: 'NETWORK_ERROR', exitCode: ExitCodes.NETWORK };
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
