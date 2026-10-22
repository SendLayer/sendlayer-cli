import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { resolveApiKey, maskApiKey, credentialsPath, readCredentials } from '../lib/auth';
import { ExitCodes } from '../lib/errors';
import { isJsonMode } from '../lib/output';

export default class Whoami extends Command {
  static description = 'Show the active SendLayer API key (masked) and where it came from.';
  static examples = ['<%= config.bin %> whoami', '<%= config.bin %> whoami --json'];

  static flags = {
    // Neither flag has an `env` or `default`: either would hide where the key
    // really came from, which is what this command exists to report.
    'api-key': Flags.string({ description: 'API key override' }),
    profile: Flags.string({ description: 'Profile to inspect (default: the default profile)' }),
    json: Flags.boolean({ description: 'Output as JSON' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Whoami);
    const auth = resolveApiKey({ flagKey: flags['api-key'], profile: flags.profile });
    const file = readCredentials();
    const profiles = Object.keys(file.profiles);

    const payload = {
      authenticated: !!auth,
      source: auth?.source,
      profile: auth?.profile,
      key: auth ? maskApiKey(auth.apiKey) : null,
      configPath: credentialsPath(),
      availableProfiles: profiles,
      defaultProfile: file.defaultProfile,
    };

    if (isJsonMode(flags)) {
      this.log(JSON.stringify(payload, null, 2));
      // Report the same failure in both modes: the JSON path used to return 0
      // even when nothing was configured, so a script had no way to tell.
      if (!auth) this.exit(ExitCodes.AUTH_MISSING);
      return;
    }

    if (!auth) {
      this.log(chalk.yellow('Not authenticated.'));
      this.log(chalk.dim(`Run 'sendlayer login' or set SENDLAYER_API_KEY.`));
      this.log(chalk.dim(`Config path: ${credentialsPath()}`));
      this.exit(ExitCodes.AUTH_MISSING);
      return;
    }

    this.log(chalk.green('✓') + ` Authenticated`);
    this.log(`  Key:     ${chalk.bold(maskApiKey(auth.apiKey))}`);
    this.log(`  Source:  ${auth.source}${auth.profile ? ` (profile: ${auth.profile})` : ''}`);
    this.log(`  Config:  ${chalk.dim(credentialsPath())}`);
    if (profiles.length > 1) {
      this.log(`  Profiles: ${profiles.join(', ')}`);
    }
  }
}
