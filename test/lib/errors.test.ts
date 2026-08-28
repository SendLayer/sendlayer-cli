import { describe, it, expect } from 'vitest';
import { SendLayerAPIError, SendLayerError } from 'sendlayer';
import { describeError, ExitCodes } from '../../src/lib/errors';

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
