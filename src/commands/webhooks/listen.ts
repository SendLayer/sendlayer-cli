import { Flags } from '@oclif/core';
import chalk from 'chalk';
import prompts from 'prompts';
import { BaseCommand } from '../../base-command';
import { handleError } from '../../lib/errors';
import {
  clearListenSession,
  deleteWebhooks,
  getListenSession,
  recordListenSession,
  registerWebhooks,
  startListenServer,
} from '../../lib/tunnel';

const ALL_EVENTS = ['bounce', 'click', 'open', 'unsubscribe', 'complaint', 'delivery'];

export default class WebhooksListen extends BaseCommand<typeof WebhooksListen> {
  static description = 'Receive webhook events locally and (optionally) forward them to a local URL.';
  static examples = [
    '<%= config.bin %> webhooks listen --port 4000 --public-url https://abc.ngrok.io --forward-to http://localhost:3000/webhook',
    '<%= config.bin %> webhooks listen --port 4000 --public-url https://abc.ngrok.io --events bounce,click',
  ];

  static flags = {
    port: Flags.integer({
      description: 'Local port to receive incoming webhook POSTs',
      default: 4000,
    }),
    'public-url': Flags.string({
      description: 'Public HTTPS URL (your tunnel) routed to this --port',
      required: true,
    }),
    'forward-to': Flags.string({
      description: 'Optional local URL to forward each event to',
    }),
    events: Flags.string({
      description: `Comma-separated event types (default: all). One of: ${ALL_EVENTS.join(', ')}`,
    }),
    'skip-cleanup-prompt': Flags.boolean({
      description: 'Skip the prompt to clean up stale webhooks from a previous run',
    }),
  };

  async run(): Promise<void> {
    const flags = this.flags;

    if (!/^https:\/\//.test(flags['public-url'])) {
      return handleError(flags, new Error('--public-url must be HTTPS'));
    }

    const events = flags.events
      ? flags.events.split(',').map((s) => s.trim()).filter(Boolean)
      : ALL_EVENTS;
    const invalid = events.filter((e) => !ALL_EVENTS.includes(e));
    if (invalid.length) {
      return handleError(flags, new Error(`Unknown event types: ${invalid.join(', ')}`));
    }

    const client = this.getClient();
    const apiKey = (flags['api-key'] as string | undefined) ?? process.env.SENDLAYER_API_KEY ?? 'stored';

    // Recovery: stale webhooks from a previous crashed run?
    const stale = getListenSession(apiKey);
    if (stale && !flags['skip-cleanup-prompt']) {
      this.log(chalk.yellow(`Found ${stale.webhookIds.length} stale webhook(s) from a previous session.`));
      const { proceed } = await prompts({
        type: 'confirm',
        name: 'proceed',
        message: 'Delete them now?',
        initial: true,
      });
      if (proceed) {
        await deleteWebhooks(client, stale.webhookIds, (m) => this.log(m));
        clearListenSession(apiKey);
      }
    }

    this.log(chalk.bold(`Starting webhook listener on port ${flags.port}`));
    this.log(chalk.dim(`Public URL:  ${flags['public-url']}`));
    if (flags['forward-to']) this.log(chalk.dim(`Forward to:  ${flags['forward-to']}`));
    this.log(chalk.dim(`Events:      ${events.join(', ')}`));
    this.log(chalk.dim(`Tunnel hint: 'ngrok http ${flags.port}' or 'cloudflared tunnel --url http://localhost:${flags.port}'`));
    this.log('');

    let webhookIds: number[] = [];
    try {
      this.log(chalk.bold('Registering webhooks...'));
      webhookIds = await registerWebhooks({
        client,
        apiKey,
        publicUrl: flags['public-url'],
        port: flags.port,
        forwardTo: flags['forward-to'],
        events,
        log: (m) => this.log(m),
      });
      recordListenSession(apiKey, {
        webhookIds,
        publicUrl: flags['public-url'],
        apiKeyHash: 'sha-omitted',
        startedAt: new Date().toISOString(),
      });
    } catch (err) {
      // best-effort cleanup of any partially-registered ids
      if (webhookIds.length) await deleteWebhooks(client, webhookIds, (m) => this.log(m));
      return handleError(flags, err);
    }

    const server = startListenServer({
      port: flags.port,
      forwardTo: flags['forward-to'],
      log: (m) => this.log(m),
    });

    this.log(chalk.green(`✓ Listening. Press Ctrl+C to stop.`));

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      this.log('');
      this.log(chalk.bold(`Received ${signal}. Cleaning up...`));
      await server.close();
      await deleteWebhooks(client, webhookIds, (m) => this.log(m));
      clearListenSession(apiKey);
      this.log(chalk.green('✓ Done.'));
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Keep the process alive while the server runs.
    await new Promise<void>(() => {
      /* never resolves until shutdown */
    });
  }
}
