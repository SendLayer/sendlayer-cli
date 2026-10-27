import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { Config } from '@oclif/core';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import prompts from 'prompts';

import { captureConsole } from '../helpers/capture-console';
import { useTempConfigHome } from '../helpers/config-home';
import { ExitCodes } from '../../src/lib/errors';
import { getListenSession, recordListenSession } from '../../src/lib/tunnel';

const { createMock, deleteMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock('sendlayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sendlayer')>();
  return {
    ...actual,
    SendLayer: vi.fn().mockImplementation(() => ({
      Emails: {},
      Webhooks: { create: createMock, delete: deleteMock },
      Events: {},
    })),
  };
});

import WebhooksListen from '../../src/commands/webhooks/listen';

useTempConfigHome();

const API_KEY = 'sl_test_key';
const BASE_ARGS = ['--public-url', 'https://abc.ngrok.io', '--events', 'bounce,click'];

let config: Config;
let signalListeners: Record<'SIGINT' | 'SIGTERM', ReturnType<typeof process.listeners>>;

beforeAll(async () => {
  config = await Config.load(path.resolve(__dirname, '..', '..'));
});

beforeEach(() => {
  createMock.mockReset();
  deleteMock.mockReset();
  process.env.SENDLAYER_API_KEY = API_KEY;
  signalListeners = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') };
});

afterEach(() => {
  // The command installs real signal handlers; don't let them outlive a test.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    for (const listener of process.listeners(signal)) {
      if (!signalListeners[signal].includes(listener)) process.removeListener(signal, listener);
    }
  }
});

afterAll(() => {
  delete process.env.SENDLAYER_API_KEY;
});

function exitCodeOf(err: unknown): number | undefined {
  return (err as { oclif?: { exit?: number } } | undefined)?.oclif?.exit;
}

/** Hold a port open so the listener can't bind it. */
async function occupiedPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const squatter = http.createServer(() => {});
  await new Promise<void>((resolve) => squatter.listen(0, () => resolve()));
  const { port } = squatter.address() as net.AddressInfo;
  return { port, release: () => new Promise((resolve) => squatter.close(() => resolve())) };
}

/**
 * These tests end the run with a failed registration: past that point the
 * command blocks until a signal arrives. Everything the review flagged happens
 * before it.
 */
describe('webhooks listen session record', () => {
  it('keeps stale ids when the cleanup prompt is declined', async () => {
    // Regression: the new ids replaced the stale ones in the record, and the
    // cleanup after a failed start then cleared the slot along with them.
    recordListenSession(API_KEY, { webhookIds: [1, 2], publicUrl: 'https://old.ngrok.io', startedAt: 'then' });
    prompts.inject([false]);
    createMock.mockResolvedValueOnce({ NewWebhookID: 10 }).mockResolvedValueOnce({ NewWebhookID: 11 });
    deleteMock.mockResolvedValue(undefined);
    const squatter = await occupiedPort();

    try {
      const { error } = await captureConsole(() =>
        WebhooksListen.run([...BASE_ARGS, '--port', String(squatter.port), '--json'], config),
      );
      expect(exitCodeOf(error)).toBe(ExitCodes.GENERIC);
    } finally {
      await squatter.release();
    }

    expect(deleteMock.mock.calls.map(([id]) => id)).toEqual([10, 11]);
    expect(getListenSession(API_KEY)?.webhookIds).toEqual([1, 2]);
  });

  it('records each new id before registering the next', async () => {
    let midRegistration: number[] | undefined;
    createMock.mockResolvedValueOnce({ NewWebhookID: 10 }).mockImplementationOnce(async () => {
      midRegistration = getListenSession(API_KEY)?.webhookIds;
      throw new Error('rate limited');
    });
    deleteMock.mockResolvedValue(undefined);

    await captureConsole(() => WebhooksListen.run([...BASE_ARGS, '--json'], config));

    expect(midRegistration).toEqual([10]);
    // ...and the cleanup that followed removed it again.
    expect(getListenSession(API_KEY)).toBeUndefined();
  });

  it('keeps stale ids with --skip-cleanup-prompt', async () => {
    recordListenSession(API_KEY, { webhookIds: [1], publicUrl: 'https://old.ngrok.io', startedAt: 'then' });
    createMock.mockResolvedValueOnce({ NewWebhookID: 10 }).mockResolvedValueOnce({ NewWebhookID: 11 });
    deleteMock.mockResolvedValue(undefined);
    const squatter = await occupiedPort();

    try {
      await captureConsole(() =>
        WebhooksListen.run([...BASE_ARGS, '--port', String(squatter.port), '--skip-cleanup-prompt', '--json'], config),
      );
    } finally {
      await squatter.release();
    }

    expect(deleteMock.mock.calls.map(([id]) => id)).toEqual([10, 11]);
    expect(getListenSession(API_KEY)?.webhookIds).toEqual([1]);
  });

  it('keeps a stale id whose delete failed', async () => {
    const { SendLayerAPIError } = await import('sendlayer');
    recordListenSession(API_KEY, { webhookIds: [1, 2], publicUrl: 'https://old.ngrok.io', startedAt: 'then' });
    prompts.inject([true]);
    deleteMock.mockRejectedValueOnce(new SendLayerAPIError('unavailable', 503, {})).mockResolvedValueOnce(undefined);
    createMock.mockRejectedValueOnce(new Error('rate limited'));

    const { stdout } = await captureConsole(() => WebhooksListen.run([...BASE_ARGS, '--json'], config));

    expect(deleteMock.mock.calls.map(([id]) => id)).toEqual([1, 2]);
    expect(getListenSession(API_KEY)?.webhookIds).toEqual([1]);
    expect(stdout).toContain('could not be removed');
  });

  it('keeps a new id whose cleanup delete failed after registration broke', async () => {
    const { SendLayerAPIError } = await import('sendlayer');
    createMock.mockResolvedValueOnce({ NewWebhookID: 10 }).mockRejectedValueOnce(new SendLayerAPIError('boom', 500, {}));
    deleteMock.mockRejectedValueOnce(new SendLayerAPIError('unavailable', 503, {}));

    const { error } = await captureConsole(() => WebhooksListen.run([...BASE_ARGS, '--json'], config));

    expect(exitCodeOf(error)).toBe(ExitCodes.API);
    expect(getListenSession(API_KEY)?.webhookIds).toEqual([10]);
  });

  it('installs the signal handlers before registering webhooks', async () => {
    // Regression: a Ctrl+C during "Registering webhooks..." hit Node's default
    // handler and exited without cleaning up or recording anything.
    const before = process.listenerCount('SIGINT');
    let duringRegistration = -1;
    createMock.mockImplementationOnce(async () => {
      duringRegistration = process.listenerCount('SIGINT');
      throw new Error('rate limited');
    });

    await captureConsole(() => WebhooksListen.run([...BASE_ARGS, '--json'], config));

    expect(duringRegistration).toBe(before + 1);
  });
});

describe('webhooks listen shutdown', () => {
  /** Wait until `predicate` holds, or give up. */
  async function eventually(predicate: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('condition was never met');
  }

  async function freePort(): Promise<number> {
    const probe = net.createServer();
    await new Promise<void>((resolve) => probe.listen(0, () => resolve()));
    const { port } = probe.address() as net.AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return port;
  }

  async function accepting(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
  }

  /** Start the listener, send SIGINT once it's up, and return the exit code it chose. */
  async function interrupt(port: number): Promise<number | undefined> {
    const exits: Array<number | undefined> = [];
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exits.push(code);
    }) as typeof process.exit);
    try {
      await captureConsole(async () => {
        // run() never resolves: it waits for a signal.
        void WebhooksListen.run([...BASE_ARGS, '--port', String(port), '--json'], config);
        await eventually(() => accepting(port));
        process.emit('SIGINT');
        await eventually(() => exits.length > 0);
      });
    } finally {
      exitSpy.mockRestore();
    }
    return exits[0];
  }

  it('keeps webhooks whose delete failed in the session record', async () => {
    // Regression: Ctrl+C during an API outage cleared the record although every
    // delete failed, leaving the webhooks live with nothing remembering them.
    const { SendLayerAPIError } = await import('sendlayer');
    createMock.mockResolvedValueOnce({ NewWebhookID: 10 }).mockResolvedValueOnce({ NewWebhookID: 11 });
    deleteMock.mockRejectedValueOnce(new SendLayerAPIError('unavailable', 503, {})).mockResolvedValueOnce(undefined);

    const code = await interrupt(await freePort());

    expect(code).toBe(ExitCodes.INTERRUPTED);
    expect(getListenSession(API_KEY)?.webhookIds).toEqual([10]);
  });

  it('clears the record and exits 0 when every webhook is removed', async () => {
    createMock.mockResolvedValueOnce({ NewWebhookID: 10 }).mockResolvedValueOnce({ NewWebhookID: 11 });
    deleteMock.mockResolvedValue(undefined);

    const code = await interrupt(await freePort());

    expect(code).toBe(0);
    expect(getListenSession(API_KEY)).toBeUndefined();
  });
});
