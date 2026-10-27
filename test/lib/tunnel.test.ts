import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';

import { useTempConfigHome } from '../helpers/config-home';
import { listenStatePath } from '../../src/lib/auth';
import { SendLayerAPIError } from 'sendlayer';
import {
  deleteWebhooks,
  forgetListenWebhooks,
  getListenSession,
  recordListenSession,
  registerWebhooks,
  startListenServer,
  withTimeout,
  type ListenOptions,
} from '../../src/lib/tunnel';

useTempConfigHome();

/** Ask the OS for a port that's free right now. */
async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** Wait until `predicate` holds, or give up. Keeps async assertions off timers. */
async function eventually(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition was never met');
}

function listenOptions(overrides: Partial<ListenOptions> & { client: ListenOptions['client'] }): ListenOptions {
  return {
    apiKey: 'sl_test',
    publicUrl: 'https://example.ngrok.io',
    port: 4000,
    events: ['bounce', 'click', 'open'],
    log: () => {},
    ...overrides,
  };
}

/** Minimal stand-in for the SDK client; only Webhooks is exercised here. */
function fakeClient(webhooks: Record<string, unknown>): ListenOptions['client'] {
  return { Webhooks: webhooks } as unknown as ListenOptions['client'];
}

describe('listen session state', () => {
  it('round-trips an entry and clears it once every id is forgotten', () => {
    const entry = {
      webhookIds: [1, 2, 3],
      publicUrl: 'https://example.ngrok.io',
      startedAt: new Date().toISOString(),
    };

    recordListenSession('key-a', entry);
    expect(getListenSession('key-a')).toEqual(entry);

    forgetListenWebhooks('key-a', [1, 3]);
    expect(getListenSession('key-a')?.webhookIds).toEqual([2]);

    forgetListenWebhooks('key-a', [2]);
    expect(getListenSession('key-a')).toBeUndefined();
  });

  it('merges new ids into an existing entry instead of replacing it', () => {
    // Regression: declining the stale-webhook prompt and then registering new
    // webhooks overwrote the slot, so the stale ids were never offered again.
    recordListenSession('key-a', { webhookIds: [1, 2], publicUrl: 'https://old.ngrok.io', startedAt: 'then' });
    recordListenSession('key-a', { webhookIds: [2, 3], publicUrl: 'https://new.ngrok.io', startedAt: 'now' });

    expect(getListenSession('key-a')).toEqual({
      webhookIds: [1, 2, 3],
      publicUrl: 'https://new.ngrok.io',
      startedAt: 'now',
    });
  });

  it('ignores forgetting ids for a key with no record', () => {
    forgetListenWebhooks('never-seen', [1]);
    expect(getListenSession('never-seen')).toBeUndefined();
  });

  it('keeps separate slots per API key', () => {
    // Regression: every stored-credential profile used to share one slot, so a
    // run under one profile would offer to delete another account's webhooks.
    recordListenSession('staging-key', {
      webhookIds: [10],
      publicUrl: 'https://staging.ngrok.io',
      startedAt: 'now',
    });
    recordListenSession('prod-key', {
      webhookIds: [20],
      publicUrl: 'https://prod.ngrok.io',
      startedAt: 'now',
    });

    expect(getListenSession('staging-key')?.webhookIds).toEqual([10]);
    expect(getListenSession('prod-key')?.webhookIds).toEqual([20]);

    forgetListenWebhooks('staging-key', [10]);
    expect(getListenSession('staging-key')).toBeUndefined();
    expect(getListenSession('prod-key')?.webhookIds).toEqual([20]);
  });

  it('returns undefined for an unknown key', () => {
    expect(getListenSession('never-seen')).toBeUndefined();
  });

  it('treats an unreadable state file as empty', () => {
    recordListenSession('key-a', { webhookIds: [1], publicUrl: 'u', startedAt: 'now' });
    fs.writeFileSync(listenStatePath(), '{ not json');
    expect(getListenSession('key-a')).toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')('writes the state file as 0600', () => {
    recordListenSession('key-a', { webhookIds: [1], publicUrl: 'u', startedAt: 'now' });
    fs.chmodSync(listenStatePath(), 0o644);
    // A second write must re-apply the mode: writeFileSync's `mode` only
    // applies when the file is created.
    recordListenSession('key-a', { webhookIds: [2], publicUrl: 'u', startedAt: 'now' });
    expect((fs.statSync(listenStatePath()).mode & 0o777).toString(8)).toBe('600');
  });
});

describe('registerWebhooks', () => {
  it('collects an id per event type', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ NewWebhookID: 1 })
      .mockResolvedValueOnce({ NewWebhookID: 2 })
      .mockResolvedValueOnce({ NewWebhookID: 3 });

    const ids: number[] = [];
    await registerWebhooks(listenOptions({ client: fakeClient({ create }) }), ids);

    expect(ids).toEqual([1, 2, 3]);
    expect(create).toHaveBeenCalledTimes(3);
    expect(create).toHaveBeenCalledWith({ url: 'https://example.ngrok.io', event: 'bounce' });
  });

  it('leaves partially-registered ids with the caller when it throws', async () => {
    // Regression: the ids used to be returned rather than accumulated, so a
    // mid-loop failure meant the caller's array was still empty and its
    // "best-effort cleanup" was a no-op exactly when it was needed.
    const create = vi
      .fn()
      .mockResolvedValueOnce({ NewWebhookID: 1 })
      .mockResolvedValueOnce({ NewWebhookID: 2 })
      .mockRejectedValueOnce(new Error('rate limited'));

    const ids: number[] = [];
    await expect(
      registerWebhooks(listenOptions({ client: fakeClient({ create }) }), ids),
    ).rejects.toThrow('rate limited');

    expect(ids).toEqual([1, 2]);
  });

  it('reports each id as soon as it is created', async () => {
    // The caller persists ids from this callback, so a Ctrl+C mid-registration
    // still leaves every created webhook on disk.
    const seen: number[][] = [];
    const ids: number[] = [];
    const create = vi
      .fn()
      .mockResolvedValueOnce({ NewWebhookID: 1 })
      .mockImplementationOnce(async () => {
        expect(seen).toEqual([[1]]);
        throw new Error('interrupted');
      });

    await expect(
      registerWebhooks(listenOptions({ client: fakeClient({ create }) }), ids, () => seen.push([...ids])),
    ).rejects.toThrow('interrupted');

    expect(seen).toEqual([[1]]);
  });
});

describe('deleteWebhooks', () => {
  it('deletes every id and reports each one', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const logs: string[] = [];

    await deleteWebhooks(fakeClient({ delete: remove }), [7, 8], (m) => logs.push(m));

    expect(remove.mock.calls.map(([id]) => id)).toEqual([7, 8]);
    expect(logs.join('\n')).toContain('removed webhook 7');
  });

  it('keeps going after a failed delete and returns the ids that failed', async () => {
    // Regression: failures were only logged, so callers treated cleanup as
    // done and dropped the session record while the webhooks stayed live.
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error('service unavailable'))
      .mockResolvedValueOnce(undefined);
    const logs: string[] = [];
    const deleted: number[] = [];

    const failed = await deleteWebhooks(
      fakeClient({ delete: remove }),
      [7, 8],
      (m) => logs.push(m),
      (id) => deleted.push(id),
    );

    expect(failed).toEqual([7]);
    expect(deleted).toEqual([8]);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(logs.join('\n')).toContain('failed to remove webhook 7');
    expect(logs.join('\n')).toContain('removed webhook 8');
  });

  it('counts a 404 as already deleted', async () => {
    const remove = vi.fn().mockRejectedValue(new SendLayerAPIError('not found', 404, {}));
    const deleted: number[] = [];

    const failed = await deleteWebhooks(fakeClient({ delete: remove }), [7], () => {}, (id) => deleted.push(id));

    expect(failed).toEqual([]);
    expect(deleted).toEqual([7]);
  });

  it('keeps a failed id in the session record when wired to forgetListenWebhooks', async () => {
    // The shape listen.ts uses: only ids that are really gone leave the record.
    recordListenSession('key-a', { webhookIds: [7, 8, 9], publicUrl: 'u', startedAt: 'now' });
    const remove = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new SendLayerAPIError('unauthorized', 401, {}))
      .mockResolvedValueOnce(undefined);

    const failed = await deleteWebhooks(fakeClient({ delete: remove }), [7, 8, 9], () => {}, (id) =>
      forgetListenWebhooks('key-a', [id]),
    );

    expect(failed).toEqual([8]);
    expect(getListenSession('key-a')?.webhookIds).toEqual([8]);
  });
});

describe('startListenServer', () => {
  it('accepts a POST and rejects other methods', async () => {
    const port = await freePort();
    const logs: string[] = [];
    const server = await startListenServer({ port, log: (m) => logs.push(m) });

    try {
      const posted = await fetch(`http://127.0.0.1:${port}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sendlayer-event': 'bounce' },
        body: JSON.stringify({ Event: 'bounce', MessageID: 'msg_1' }),
      });
      expect(posted.status).toBe(200);
      expect(await posted.json()).toEqual({ received: true });
      expect(logs.join('\n')).toContain('[bounce]');

      const got = await fetch(`http://127.0.0.1:${port}/`);
      expect(got.status).toBe(405);
    } finally {
      await server.close();
    }
  });

  it('forwards the payload to --forward-to', async () => {
    const port = await freePort();
    const targetPort = await freePort();

    const received: Array<{ body: string; event?: string }> = [];
    const target = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push({
          body: Buffer.concat(chunks).toString('utf8'),
          event: req.headers['x-sendlayer-event'] as string | undefined,
        });
        res.statusCode = 204;
        res.end();
      });
    });
    await new Promise<void>((resolve) => target.listen(targetPort, '127.0.0.1', () => resolve()));

    const server = await startListenServer({
      port,
      forwardTo: `http://127.0.0.1:${targetPort}/hook`,
      log: () => {},
    });

    try {
      await fetch(`http://127.0.0.1:${port}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sendlayer-event': 'click' },
        body: JSON.stringify({ Event: 'click' }),
      });
      await eventually(() => received.length === 1);
      expect(received[0].event).toBe('click');
      expect(JSON.parse(received[0].body)).toEqual({ Event: 'click' });
    } finally {
      await server.close();
      await new Promise<void>((resolve) => {
        target.close(() => resolve());
        // The forwarding fetch leaves a keep-alive connection behind, which
        // would otherwise hold close() open until undici's idle timeout.
        target.closeIdleConnections();
      });
    }
  });

  it('rejects a body over the size cap', async () => {
    const port = await freePort();
    const logs: string[] = [];
    const server = await startListenServer({ port, log: (m) => logs.push(m) });

    try {
      // The connection may be torn down before the 413 is read, so assert on
      // the server's own record of the rejection rather than the response.
      await fetch(`http://127.0.0.1:${port}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'x'.repeat(1024 * 1024 + 4096),
      }).catch(() => undefined);

      await eventually(() => logs.some((l) => l.includes('rejected a body over')));
    } finally {
      await server.close();
    }
  });

  it('rejects with a readable error when the port is taken', async () => {
    // Regression: server.listen() had no 'error' handler, so EADDRINUSE — a
    // routine event on port 4000 — crashed the process with a raw Node stack
    // trace after the webhooks had already been registered.
    const port = await freePort();
    const squatter = http.createServer(() => {});
    await new Promise<void>((resolve) => squatter.listen(port, () => resolve()));

    try {
      await expect(startListenServer({ port, log: () => {} })).rejects.toThrow(
        `Port ${port} is already in use`,
      );
    } finally {
      await new Promise<void>((resolve) => squatter.close(() => resolve()));
    }
  });
});

describe('withTimeout', () => {
  it('reports true when the work finishes first', async () => {
    await expect(withTimeout(Promise.resolve('done'), 1000)).resolves.toBe(true);
  });

  it('reports false when the work outlasts the deadline', async () => {
    const never = new Promise((resolve) => {
      const t = setTimeout(resolve, 10_000);
      t.unref();
    });
    await expect(withTimeout(never, 20)).resolves.toBe(false);
  });
});
