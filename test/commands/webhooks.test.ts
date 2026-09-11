import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { captureOutput } from '@oclif/test';
import { Config } from '@oclif/core';
import * as path from 'node:path';

import { useTempConfigHome } from '../helpers/config-home';
import { ExitCodes } from '../../src/lib/errors';

const { createMock, getMock, deleteMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  getMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock('sendlayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sendlayer')>();
  return {
    ...actual,
    SendLayer: vi.fn().mockImplementation(() => ({
      Emails: {},
      Webhooks: { create: createMock, get: getMock, delete: deleteMock },
      Events: {},
    })),
  };
});

import WebhooksCreate from '../../src/commands/webhooks/create';
import WebhooksDelete from '../../src/commands/webhooks/delete';
import WebhooksList from '../../src/commands/webhooks/list';

// Keep every command test off the developer's real credentials file.
useTempConfigHome();

let config: Config;

beforeAll(async () => {
  config = await Config.load(path.resolve(__dirname, '..', '..'));
});

beforeEach(() => {
  createMock.mockReset();
  getMock.mockReset();
  deleteMock.mockReset();
  process.env.SENDLAYER_API_KEY = 'sl_test_key';
});

afterAll(() => {
  delete process.env.SENDLAYER_API_KEY;
});

/** The exit code oclif will exit the process with for a thrown error. */
function exitCodeOf(err: unknown): number | undefined {
  return (err as { oclif?: { exit?: number } } | undefined)?.oclif?.exit;
}

describe('webhooks list', () => {
  it('renders the webhooks it is given', async () => {
    getMock.mockResolvedValue([
      { WebhookID: '11', WebhookURL: 'https://a.example/hook', Event: 'bounce', Status: 'active' },
    ]);

    const { stdout } = await captureOutput(() => WebhooksList.run([], config));

    expect(JSON.parse(stdout)).toEqual([
      { WebhookID: '11', WebhookURL: 'https://a.example/hook', Event: 'bounce', Status: 'active' },
    ]);
  });

  it('reports API failures with the API exit code', async () => {
    const { SendLayerAPIError } = await import('sendlayer');
    getMock.mockRejectedValue(new SendLayerAPIError('upstream is down', 500, {}));

    const { stderr, error } = await captureOutput(() => WebhooksList.run([], config));

    const reported = JSON.parse(stderr);
    expect(reported.error).toContain('upstream is down');
    expect(reported.code).toBe('API_ERROR');
    expect(reported.details.statusCode).toBe(500);
    expect(exitCodeOf(error)).toBe(ExitCodes.API);
  });

  it('maps a 401 to the auth exit code', async () => {
    const { SendLayerAPIError } = await import('sendlayer');
    getMock.mockRejectedValue(new SendLayerAPIError('unauthorized', 401, {}));

    const { error } = await captureOutput(() => WebhooksList.run([], config));

    expect(exitCodeOf(error)).toBe(ExitCodes.AUTH_INVALID);
  });
});

describe('webhooks create', () => {
  it('passes the url and event through to the SDK', async () => {
    createMock.mockResolvedValue({ NewWebhookID: 42 });

    const { stdout } = await captureOutput(() =>
      WebhooksCreate.run(['--url', 'https://example.com/hook', '--event', 'bounce'], config),
    );

    expect(createMock).toHaveBeenCalledWith({ url: 'https://example.com/hook', event: 'bounce' });
    expect(JSON.parse(stdout)).toEqual({
      id: 42,
      url: 'https://example.com/hook',
      event: 'bounce',
    });
  });

  it('exits with the usage code when required flags are missing', async () => {
    // Regression: BaseCommand.catch funnelled oclif's own parse errors through
    // handleError, which classified them as generic — so the documented
    // USAGE code was unreachable and this exited 1.
    const { stderr, error } = await captureOutput(() => WebhooksCreate.run([], config));

    expect(exitCodeOf(error)).toBe(ExitCodes.USAGE);
    expect(JSON.parse(stderr).code).toBe('USAGE');
    expect(JSON.parse(stderr).error).toMatch(/Missing required flag/);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects an event outside the allowed set', async () => {
    const { error } = await captureOutput(() =>
      WebhooksCreate.run(['--url', 'https://example.com/hook', '--event', 'nope'], config),
    );

    expect(exitCodeOf(error)).toBe(ExitCodes.USAGE);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('webhooks delete', () => {
  it('deletes a numeric id', async () => {
    deleteMock.mockResolvedValue(undefined);

    const { stdout } = await captureOutput(() => WebhooksDelete.run(['42'], config));

    expect(deleteMock).toHaveBeenCalledWith(42);
    expect(JSON.parse(stdout)).toEqual({ deleted: true, id: 42 });
  });

  it('rejects a non-numeric id before calling the API', async () => {
    const { stderr, error } = await captureOutput(() => WebhooksDelete.run(['abc'], config));

    expect(JSON.parse(stderr).error).toMatch(/positive integer/);
    expect(exitCodeOf(error)).toBe(ExitCodes.GENERIC);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('requires an id argument', async () => {
    const { error } = await captureOutput(() => WebhooksDelete.run([], config));

    expect(exitCodeOf(error)).toBe(ExitCodes.USAGE);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe('missing credentials', () => {
  it('exits with the auth-missing code, not the generic one', async () => {
    // ExitCodes.AUTH_MISSING was unreachable: the message was wrapped in a
    // plain Error and classified as generic.
    delete process.env.SENDLAYER_API_KEY;

    const { stderr, error } = await captureOutput(() => WebhooksList.run([], config));

    const reported = JSON.parse(stderr);
    expect(reported.error).toMatch(/No API key found/);
    expect(reported.code).toBe('AUTH_MISSING');
    expect(exitCodeOf(error)).toBe(ExitCodes.AUTH_MISSING);
    expect(getMock).not.toHaveBeenCalled();
  });
});
