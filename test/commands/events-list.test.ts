import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { Config } from '@oclif/core';
import * as path from 'node:path';

import { useTempConfigHome } from '../helpers/config-home';
import { asTty, captureConsole } from '../helpers/capture-console';
import { ExitCodes } from '../../src/lib/errors';

const { eventsGetMock } = vi.hoisted(() => ({ eventsGetMock: vi.fn() }));

vi.mock('sendlayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sendlayer')>();
  return {
    ...actual,
    SendLayer: vi.fn().mockImplementation(() => ({
      Emails: {},
      Webhooks: {},
      Events: { get: eventsGetMock },
    })),
  };
});

import EventsList from '../../src/commands/events/list';

// Keep every command test off the developer's real credentials file.
useTempConfigHome();

let config: Config;

beforeAll(async () => {
  config = await Config.load(path.resolve(__dirname, '..', '..'));
});

beforeEach(() => {
  eventsGetMock.mockReset();
  process.env.SENDLAYER_API_KEY = 'sl_test_key';
});

afterAll(() => {
  delete process.env.SENDLAYER_API_KEY;
});

function exitCodeOf(err: unknown): number | undefined {
  return (err as { oclif?: { exit?: number } } | undefined)?.oclif?.exit;
}

function eventFixture(overrides: Record<string, unknown> = {}) {
  return {
    Event: 'delivered',
    LoggedAt: 1_767_225_600,
    LogLevel: 'info',
    Reason: '',
    Ip: '203.0.113.1',
    GeoLocation: {},
    Message: {
      Headers: {
        MessageId: 'msg_abc',
        From: ['sender@acme.dev'],
        ReplyTo: [],
        To: ['recipient@example.com'],
        Cc: [],
        Bcc: [],
        Subject: 'Welcome aboard',
      },
    },
    ...overrides,
  };
}

describe('events list', () => {
  it('passes filters through to the SDK', async () => {
    eventsGetMock.mockResolvedValue({ TotalRecords: 0, Events: [] });

    await captureConsole(() =>
      EventsList.run(
        ['--event', 'delivered', '--limit', '20', '--start', '2026-05-01', '--message-id', 'msg_1'],
        config,
      ),
    );

    const options = eventsGetMock.mock.calls[0][0];
    expect(options.event).toBe('delivered');
    expect(options.retrieveCount).toBe(20);
    expect(options.messageId).toBe('msg_1');
    expect(options.startDate).toBeInstanceOf(Date);
    expect(options.endDate).toBeUndefined();
  });

  it('renders the recipient from the declared Message.Headers.To field', async () => {
    // Regression: the table read a top-level `Recipient` that the SDK's Event
    // type doesn't declare, so the column was silently always empty.
    eventsGetMock.mockResolvedValue({ TotalRecords: 1, Events: [eventFixture()] });

    const { stdout } = await asTty(() => captureConsole(() => EventsList.run([], config)));

    expect(stdout).toContain('recipient@example.com');
    expect(stdout).toContain('msg_abc');
    expect(stdout).toContain('Welcome aboard');
    expect(stdout).toContain('Total records: 1');
  });

  it('joins multiple recipients', async () => {
    eventsGetMock.mockResolvedValue({
      TotalRecords: 1,
      Events: [
        eventFixture({
          Message: {
            Headers: {
              MessageId: 'msg_multi',
              From: ['sender@acme.dev'],
              ReplyTo: [],
              To: ['a@example.com', 'b@example.com'],
              Cc: [],
              Bcc: [],
              Subject: 'Two up',
            },
          },
        }),
      ],
    });

    const { stdout } = await asTty(() => captureConsole(() => EventsList.run([], config)));

    expect(stdout).toContain('a@example.com, b@example.com');
  });

  it('survives an event with no message headers', async () => {
    eventsGetMock.mockResolvedValue({
      TotalRecords: 1,
      Events: [eventFixture({ Message: undefined })],
    });

    const { stdout, error } = await asTty(() => captureConsole(() => EventsList.run([], config)));

    expect(error).toBeUndefined();
    expect(stdout).toContain('delivered');
  });

  it('reports an empty result set', async () => {
    eventsGetMock.mockResolvedValue({ TotalRecords: 0, Events: [] });

    const { stdout } = await asTty(() => captureConsole(() => EventsList.run([], config)));

    expect(stdout).toMatch(/No events found/);
  });

  it('emits JSON when not attached to a terminal', async () => {
    eventsGetMock.mockResolvedValue({ TotalRecords: 1, Events: [eventFixture()] });

    const { stdout } = await captureConsole(() => EventsList.run([], config));

    expect(JSON.parse(stdout).TotalRecords).toBe(1);
  });

  it('rejects an unparseable date before calling the API', async () => {
    const { stderr, error } = await captureConsole(() =>
      EventsList.run(['--start', 'not-a-date'], config),
    );

    expect(JSON.parse(stderr).error).toMatch(/Invalid start date/);
    expect(exitCodeOf(error)).toBe(ExitCodes.GENERIC);
    expect(eventsGetMock).not.toHaveBeenCalled();
  });

  it('rejects an event type outside the allowed set', async () => {
    const { error } = await captureConsole(() => EventsList.run(['--event', 'exploded'], config));

    expect(exitCodeOf(error)).toBe(ExitCodes.USAGE);
    expect(eventsGetMock).not.toHaveBeenCalled();
  });
});
