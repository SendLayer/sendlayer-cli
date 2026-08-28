import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { deleteProfile, credentialsPath } from '../lib/auth';
import { isJsonMode } from '../lib/output';

export default class Logout extends Command {
  static description = 'Remove a stored SendLayer API key.';
  static examples = ['<%= config.bin %> logout', '<%= config.bin %> logout --profile staging'];

  static flags = {
    profile: Flags.string({
      description: 'Profile name to remove',
      default: 'default',
    }),
    json: Flags.boolean({ description: 'Output as JSON' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Logout);
    const removed = deleteProfile(flags.profile);

    if (isJsonMode(flags)) {
      this.log(JSON.stringify({ removed, profile: flags.profile, path: credentialsPath() }, null, 2));
      return;
    }

    if (removed) {
      this.log(chalk.green('✓') + ` Removed profile ${chalk.bold(flags.profile)}`);
    } else {
      this.log(chalk.yellow('!') + ` Profile ${chalk.bold(flags.profile)} was not stored`);
    }
  }
}
