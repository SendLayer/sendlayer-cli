import { Flags } from '@oclif/core';
import chalk from 'chalk';
import prompts from 'prompts';
import { BaseCommand } from '../../base-command';
import { ExitCodes, handleError } from '../../lib/errors';
import {
  deleteWebhooks,
  forgetListenWebhooks,
  getListenSession,
  recordListenSession,
  registerWebhooks,
  startListenServer,
  withTimeout,
  type ListenServer,
} from '../../lib/tunnel';

const ALL_EVENTS = ['bounce', 'click', 'open', 'unsubscribe', 'complaint', 'delivery'];

/** How long shutdown waits for webhook deletion before giving up. */
const CLEANUP_TIMEOUT_MS = 10_000;

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

    // Key the session record by the credentials actually in use. Deriving it
    // from the flag alone collapsed every stored profile onto one slot, so a
    // run under one profile could offer to delete another account's webhooks.
    const apiKey = this.resolveAuth().apiKey;
    const client = this.getClient();

    const log = (m: string): void => this.log(m);
    const forget = (id: number): void => forgetListenWebhooks(apiKey, [id]);

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
        const failed = await deleteWebhooks(client, stale.webhookIds, log, forget);
        if (failed.length) {
          this.log(chalk.yellow(`! ${failed.length} stale webhook(s) could not be removed; the next run will offer them again.`));
        }
      } else {
        this.log(chalk.dim('  Kept them; the next run will offer them again.'));
      }
    }

    this.log(chalk.bold(`Starting webhook listener on port ${flags.port}`));
    this.log(chalk.dim(`Public URL:  ${flags['public-url']}`));
    if (flags['forward-to']) this.log(chalk.dim(`Forward to:  ${flags['forward-to']}`));
    this.log(chalk.dim(`Events:      ${events.join(', ')}`));
    this.log(chalk.dim(`Tunnel hint: 'ngrok http ${flags.port}' or 'cloudflared tunnel --url http://localhost:${flags.port}'`));
    this.log('');

    // Owned here and filled in by registerWebhooks, so a failure partway
    // through still leaves us holding the ids created so far.
    const webhookIds: number[] = [];
    let server: ListenServer | undefined;

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      // A second Ctrl+C means "I don't care about cleanup, let me out".
      if (shuttingDown) {
        this.log(chalk.yellow(`Received ${signal} again — exiting without finishing cleanup.`));
        this.log(chalk.dim(`  Run 'sendlayer webhooks listen' again to remove: ${webhookIds.join(', ')}`));
        process.exit(ExitCodes.INTERRUPTED);
      }
      shuttingDown = true;
      this.log('');
      this.log(chalk.bold(`Received ${signal}. Cleaning up... (Ctrl+C again to skip)`));
      // A request still in flight shouldn't hold shutdown open for long.
      if (server) await withTimeout(server.close(), CLEANUP_TIMEOUT_MS);
      // Each webhook leaves the session record as it is deleted, so whatever
      // is still live when this returns, fails or times out stays recorded
      // for the next run to offer.
      let failed: number[] = [];
      const cleaned = await withTimeout(
        deleteWebhooks(client, webhookIds, log, forget).then((f) => {
          failed = f;
        }),
        CLEANUP_TIMEOUT_MS,
      );
      if (cleaned && !failed.length) {
        this.log(chalk.green('✓ Done.'));
        process.exit(0);
      }
      this.log(
        chalk.yellow(
          cleaned
            ? `! ${failed.length} webhook(s) could not be removed.`
            : `! Cleanup timed out after ${CLEANUP_TIMEOUT_MS / 1000}s.`,
        ),
      );
      this.log(chalk.dim('  The next run will offer to remove any webhooks left behind.'));
      process.exit(ExitCodes.INTERRUPTED);
    };

    // Installed before registering: a Ctrl+C during "Registering webhooks..."
    // would otherwise kill the process with the webhooks created so far still live.
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    try {
      this.log(chalk.bold('Registering webhooks...'));
      await registerWebhooks(
        {
          client,
          apiKey,
          publicUrl: flags['public-url'],
          port: flags.port,
          forwardTo: flags['forward-to'],
          events,
          log,
        },
        webhookIds,
        // Record each id the moment it exists, not once all are registered.
        (id) =>
          recordListenSession(apiKey, {
            webhookIds: [id],
            publicUrl: flags['public-url'],
            startedAt: new Date().toISOString(),
          }),
      );
    } catch (err) {
      // best-effort cleanup of any partially-registered ids
      if (webhookIds.length) await deleteWebhooks(client, webhookIds, log, forget);
      return handleError(flags, err);
    }

    try {
      server = await startListenServer({
        port: flags.port,
        forwardTo: flags['forward-to'],
        log,
      });
    } catch (err) {
      // The webhooks are live but nothing is listening — take them back down.
      await deleteWebhooks(client, webhookIds, log, forget);
      return handleError(flags, err);
    }

    this.log(chalk.green(`✓ Listening. Press Ctrl+C to stop.`));

    // Keep the process alive while the server runs.
    await new Promise<void>(() => {
      /* never resolves until shutdown */
    });
  }
}
