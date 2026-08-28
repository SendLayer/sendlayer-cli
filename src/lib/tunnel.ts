import * as fs from 'node:fs';
import * as http from 'node:http';
import chalk from 'chalk';
import type { SendLayer } from 'sendlayer';
import { listenStatePath, configDir } from './auth';

export interface ListenStateEntry {
  webhookIds: number[];
  publicUrl: string;
  apiKeyHash: string;
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

function ensureDir(): void {
  const dir = configDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
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
  ensureDir();
  fs.writeFileSync(listenStatePath(), JSON.stringify(state, null, 2), { mode: 0o600 });
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

export async function registerWebhooks(opts: ListenOptions): Promise<number[]> {
  const ids: number[] = [];
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

export function startListenServer(opts: {
  port: number;
  forwardTo?: string;
  log: (msg: string) => void;
}): ListenServer {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
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

  server.listen(opts.port);

  return {
    close: () => new Promise((resolve) => server.close(() => resolve())),
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
