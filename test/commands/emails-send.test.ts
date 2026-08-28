import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { captureOutput } from '@oclif/test';
import { Config } from '@oclif/core';
import * as path from 'node:path';

// Shared SDK mock, hoisted so the vi.mock factory below can reference it.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

// Intercept the `sendlayer` SDK so no real HTTP request is ever made.
// Keep the real error classes (errors.ts imports them) and stub only the client.
vi.mock('sendlayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sendlayer')>();
  return {
    ...actual,
    SendLayer: vi.fn().mockImplementation(() => ({
      Emails: { send: sendMock },
      Webhooks: {},
      Events: {},
    })),
  };
});

// Import AFTER the mock is registered so the command picks up the fake SDK.
import EmailsSend from '../../src/commands/emails/send';

let config: Config;

beforeAll(async () => {
  config = await Config.load(path.resolve(__dirname, '..', '..'));
});

beforeEach(() => {
  sendMock.mockReset();
  process.env.SENDLAYER_API_KEY = 'sl_test_key';
});

afterAll(() => {
  delete process.env.SENDLAYER_API_KEY;
});

describe('emails send', () => {
  it('builds the payload from flags and reports the MessageID', async () => {
    sendMock.mockResolvedValue({ MessageID: 'msg_abc123' });

    const { stdout } = await captureOutput(() =>
      EmailsSend.run(
        [
          '--from', 'Acme <hello@acme.dev>',
          '--to', 'a@x.com,b@y.com',
          '--subject', 'Welcome',
          '--text', 'Glad to have you.',
          '--tag', 'onboarding',
        ],
        config,
      ),
    );

    // The SDK was called exactly once with a correctly-shaped payload.
    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0][0];
    expect(payload.from).toEqual({ name: 'Acme', email: 'hello@acme.dev' });
    expect(payload.to).toEqual([{ email: 'a@x.com' }, { email: 'b@y.com' }]);
    expect(payload.subject).toBe('Welcome');
    expect(payload.text).toBe('Glad to have you.');
    expect(payload.tags).toEqual(['onboarding']);

    expect(stdout).toContain('msg_abc123');
  });

  it('emits machine-readable JSON with --json', async () => {
    sendMock.mockResolvedValue({ MessageID: 'msg_json' });

    const { stdout } = await captureOutput(() =>
      EmailsSend.run(
        ['--from', 'a@x.com', '--to', 'b@y.com', '--subject', 'Hi', '--text', 'yo', '--json'],
        config,
      ),
    );

    expect(JSON.parse(stdout)).toMatchObject({ MessageID: 'msg_json' });
  });

  it('rejects a missing --from without touching the network', async () => {
    const { stderr, error } = await captureOutput(() =>
      EmailsSend.run(['--to', 'b@y.com', '--subject', 'Hi', '--text', 'yo'], config),
    );

    // handleError prints to stderr and exits non-zero before any SDK call.
    expect(stderr).toMatch(/--from is required/);
    expect(error).toBeDefined();
    expect(sendMock).not.toHaveBeenCalled();
  });
});
