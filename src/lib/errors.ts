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

export function describeError(err: unknown): CliErrorPayload {
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

export function handleError(flags: { json?: boolean } | undefined, err: unknown): never {
  const payload = describeError(err);
  emitError(flags, payload);
  process.exit(payload.exitCode);
}
