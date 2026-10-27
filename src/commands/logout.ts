import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { activeProfile, deleteProfile, credentialsPath, readCredentials } from '../lib/auth';
import { isJsonMode } from '../lib/output';

export default class Logout extends Command {
  static description = 'Remove a stored SendLayer API key.';
  static examples = ['<%= config.bin %> logout', '<%= config.bin %> logout --profile staging'];

  static flags = {
    profile: Flags.string({
      description: 'Profile name to remove (default: the default profile)',
    }),
    json: Flags.boolean({ description: 'Output as JSON' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Logout);
    const profile = activeProfile(flags.profile);
    const wasDefault = readCredentials().defaultProfile === profile;
    const removed = deleteProfile(profile);
    // Removing the default promotes another profile, so commands run without
    // --profile keep working, but against a different account. Say so.
    const defaultProfile = readCredentials().defaultProfile;
    const promoted = removed && wasDefault ? defaultProfile : undefined;

    if (isJsonMode(flags)) {
      this.log(JSON.stringify({ removed, profile, defaultProfile: defaultProfile ?? null, path: credentialsPath() }, null, 2));
      return;
    }

    if (removed) {
      this.log(chalk.green('✓') + ` Removed profile ${chalk.bold(profile)}`);
      if (promoted) {
        this.log(chalk.yellow('!') + ` Default profile is now ${chalk.bold(promoted)}; commands without --profile will use it.`);
      }
    } else {
      this.log(chalk.yellow('!') + ` Profile ${chalk.bold(profile)} was not stored`);
    }
  }
}
