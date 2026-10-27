import { Flags } from '@oclif/core';
import chalk from 'chalk';
import { BaseCommand } from '../../base-command';
import { emit } from '../../lib/output';
import { handleError } from '../../lib/errors';

const VALID_EVENTS = ['bounce', 'click', 'open', 'unsubscribe', 'complaint', 'delivery'] as const;

export default class WebhooksCreate extends BaseCommand<typeof WebhooksCreate> {
  static description = 'Register a webhook URL for an event type.';
  static examples = [
    '<%= config.bin %> webhooks create --url https://example.com/hook --event bounce',
    '<%= config.bin %> webhooks create -u https://example.com/hook -e click',
  ];

  static flags = {
    url: Flags.string({
      char: 'u',
      description: 'Public HTTPS endpoint to receive event payloads',
      required: true,
    }),
    event: Flags.string({
      char: 'e',
      description: `Event type (${VALID_EVENTS.join(', ')})`,
      required: true,
      options: [...VALID_EVENTS],
    }),
  };

  async run(): Promise<void> {
    const client = this.getClient();
    try {
      const result = await client.Webhooks.create({ url: this.flags.url, event: this.flags.event });
      emit(
        this.flags,
        { id: result.NewWebhookID, url: this.flags.url, event: this.flags.event },
        () => `${chalk.green('✓')} Created webhook ${chalk.bold(result.NewWebhookID)} for ${chalk.bold(this.flags.event)}`,
      );
    } catch (err) {
      return handleError(this.flags, err);
    }
  }
}
