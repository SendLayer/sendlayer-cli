import { Args } from '@oclif/core';
import chalk from 'chalk';
import { BaseCommand } from '../../base-command';
import { emit } from '../../lib/output';
import { handleError } from '../../lib/errors';

export default class WebhooksDelete extends BaseCommand<typeof WebhooksDelete> {
  static description = 'Delete a webhook by ID.';
  static examples = ['<%= config.bin %> webhooks delete 42'];

  static args = {
    id: Args.string({ description: 'Webhook ID', required: true }),
  };

  async run(): Promise<void> {
    const idNum = Number(this.args.id);
    if (!Number.isInteger(idNum) || idNum <= 0) {
      return handleError(this.flags, new Error(`Webhook id must be a positive integer (got '${this.args.id}')`));
    }
    const client = this.getClient();
    try {
      await client.Webhooks.delete(idNum);
      emit(this.flags, { deleted: true, id: idNum }, () => `${chalk.green('✓')} Deleted webhook ${chalk.bold(idNum)}`);
    } catch (err) {
      return handleError(this.flags, err);
    }
  }
}
