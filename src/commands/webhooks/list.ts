import chalk from 'chalk';
import { BaseCommand } from '../../base-command';
import { emit, table } from '../../lib/output';
import { handleError } from '../../lib/errors';

export default class WebhooksList extends BaseCommand<typeof WebhooksList> {
  static description = 'List configured webhooks.';
  static aliases = ['webhooks'];
  static examples = ['<%= config.bin %> webhooks list', '<%= config.bin %> webhooks list --json'];

  static flags = {};

  async run(): Promise<void> {
    const client = this.getClient();
    try {
      const webhooks = await client.Webhooks.get();
      emit(this.flags, webhooks, () => {
        if (!webhooks.length) return chalk.dim('No webhooks configured.');
        return table(
          webhooks.map((w) => ({
            id: w.WebhookID,
            event: w.Event,
            status: w.Status,
            url: w.WebhookURL,
          })),
          ['id', 'event', 'status', 'url'],
        );
      });
    } catch (err) {
      return handleError(this.flags, err);
    }
  }
}
