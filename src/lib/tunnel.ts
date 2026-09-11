import * as fs from 'node:fs';
import * as http from 'node:http';
import chalk from 'chalk';
import type { SendLayer } from 'sendlayer';
import { listenStatePath, writePrivateFile } from './auth';

/**
 * Cap on an incoming webhook body. The listen endpoint is deliberately exposed
 * through a public tunnel, so an unbounded body is an easy way to exhaust
 * memory on a dev machine.
 */
const MAX_BODY_BYTES = 1024 * 1024;

export interface ListenStateEntry {
  webhookIds: number[];
  publicUrl: string;
  startedAt: string;
}

export type ListenState = Record<string, ListenStateEntry>;

function hashKey(apiKey: string): string {
  // Simple non-cryptographic stable id (we just need a key->id link).
  let h = 0;
  for (let i = 0; i < apiKey.length; i++) {
    h = (Math.imul(31, h) + apiKey.charCodeAt(i)) | 0;
  }
  return `k${(h >>> 0).toString(16)}`;
}

function readState(): ListenState {
  const file = listenStatePath();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as ListenState;
  } catch {
    return {};
  }
}

function writeState(state: ListenState): void {
  writePrivateFile(listenStatePath(), JSON.stringify(state, null, 2));
}

export function recordListenSession(apiKey: string, entry: ListenStateEntry): void {
  const state = readState();
  state[hashKey(apiKey)] = entry;
  writeState(state);
}

export function clearListenSession(apiKey: string): void {
  const state = readState();
  delete state[hashKey(apiKey)];
  writeState(state);
}

export function getListenSession(apiKey: string): ListenStateEntry | undefined {
  return readState()[hashKey(apiKey)];
}

export interface ListenOptions {
  client: SendLayer;
  apiKey: string;
  publicUrl: string;
  port: number;
  forwardTo?: string;
  events: string[];
  log: (msg: string) => void;
}

/**
 * Register one webhook per event type, appending each new id to `ids`.
 *
 * The array is caller-owned on purpose: if a later call fails, the caller still
 * holds the ids created before the failure and can clean them up. Returning
 * them would lose exactly the ids that matter.
 */
export async function registerWebhooks(opts: ListenOptions, ids: number[]): Promise<number[]> {
  for (const event of opts.events) {
    const result = await opts.client.Webhooks.create({ url: opts.publicUrl, event });
    ids.push(result.NewWebhookID);
    opts.log(chalk.dim(`  + ${event} (id ${result.NewWebhookID})`));
  }
  return ids;
}

export async function deleteWebhooks(client: SendLayer, ids: number[], log: (msg: string) => void): Promise<void> {
  for (const id of ids) {
    try {
      await client.Webhooks.delete(id);
      log(chalk.dim(`  - removed webhook ${id}`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(chalk.yellow(`  ! failed to remove webhook ${id}: ${msg}`));
    }
  }
}

export interface ListenServer {
  close: () => Promise<void>;
}

/**
 * Resolve `false` if `work` hasn't settled within `ms`.
 *
 * Used to bound webhook cleanup on shutdown: a hung API call shouldn't leave
 * the user stuck in a Ctrl+C that never finishes.
 */
export async function withTimeout(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
    timer.unref();
  });
  try {
    return await Promise.race([work.then(() => true), expired]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function startListenServer(opts: {
  port: number;
  forwardTo?: string;
  log: (msg: string) => void;
}): Promise<ListenServer> {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    let tooLarge = false;
    req.on('data', (c: Buffer) => {
      if (tooLarge) return;
      received += c.length;
      if (received > MAX_BODY_BYTES) {
        tooLarge = true;
        opts.log(chalk.yellow(`  ! rejected a body over ${MAX_BODY_BYTES} bytes`));
        res.statusCode = 413;
        res.end();
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', async () => {
      if (tooLarge) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
      const eventType = (req.headers['x-sendlayer-event'] as string | undefined) ?? extractEvent(parsed) ?? 'unknown';
      opts.log(formatEvent(eventType, parsed));

      if (opts.forwardTo) {
        try {
          const r = await fetch(opts.forwardTo, {
            method: 'POST',
            headers: {
              'content-type': req.headers['content-type'] ?? 'application/json',
              'x-sendlayer-event': eventType,
              'x-sendlayer-cli-forwarded': '1',
            },
            body: raw,
          });
          opts.log(chalk.dim(`    → forwarded to ${opts.forwardTo} (${r.status})`));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          opts.log(chalk.yellow(`    ! forward failed: ${msg}`));
        }
      }

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ received: true }));
    });
  });

  // Resolve only once the port is actually bound, so a caller that has already
  // registered webhooks learns about EADDRINUSE (a routine occurrence on 4000)
  // in time to clean them up, instead of the process dying on an unhandled
  // 'error' event with the webhooks left pointing at nothing.
  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      server.removeListener('listening', onListening);
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(`Port ${opts.port} is already in use. Pass --port to choose another.`)
          : err,
      );
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(opts.port);
  });

  // Past startup, a socket-level error shouldn't take the listener down.
  server.on('error', (err: Error) => {
    opts.log(chalk.yellow(`  ! server error: ${err.message}`));
  });

  return {
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        // close() waits for open connections, and a tunnel holds a keep-alive
        // connection open — so without this, shutdown blocks until the tunnel
        // itself goes away. In-flight requests still get to finish.
        server.closeIdleConnections();
      }),
  };
}

function extractEvent(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object' && 'Event' in payload) {
    const e = (payload as { Event: unknown }).Event;
    return typeof e === 'string' ? e : undefined;
  }
  return undefined;
}

function formatEvent(eventType: string, payload: unknown): string {
  const ts = new Date().toISOString();
  const tag = chalk.cyan(`[${eventType}]`);
  if (payload && typeof payload === 'object') {
    return `${chalk.dim(ts)} ${tag} ${chalk.dim(JSON.stringify(payload).slice(0, 200))}`;
  }
  return `${chalk.dim(ts)} ${tag} ${String(payload).slice(0, 200)}`;
}
