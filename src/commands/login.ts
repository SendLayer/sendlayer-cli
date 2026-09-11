import { Command, Errors, Flags } from '@oclif/core';
import chalk from 'chalk';
import prompts from 'prompts';
import { saveApiKey, credentialsPath, maskApiKey } from '../lib/auth';
import { getClient } from '../lib/client';
import { describeError, exitWith, ExitCodes, failWith, handleError } from '../lib/errors';
import { drainOutput, isJsonMode } from '../lib/output';

export default class Login extends Command {
  static description = 'Save a SendLayer API key for future commands.';
  static examples = [
    '<%= config.bin %> login',
    '<%= config.bin %> login --key sl_xxx',
    '<%= config.bin %> login --key $SENDLAYER_API_KEY --profile staging',
  ];

  static flags = {
    key: Flags.string({
      description: 'API key (skip interactive prompt)',
      char: 'k',
    }),
    profile: Flags.string({
      description: 'Profile name to save under',
      default: 'default',
    }),
    'no-validate': Flags.boolean({
      description: 'Skip API validation',
    }),
    json: Flags.boolean({ description: 'Output as JSON' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Login);
    let apiKey = flags.key;

    if (!apiKey) {
      if (!process.stdin.isTTY) {
        handleError(flags, new Error('No --key provided and stdin is not a TTY. Pass --key or run interactively.'));
      }
      const response = await prompts({
        type: 'password',
        name: 'apiKey',
        message: 'SendLayer API key',
        validate: (val: string) => (val && val.length >= 8 ? true : 'Key looks too short'),
      });
      apiKey = response.apiKey as string | undefined;
      if (!apiKey) {
        exitWith(ExitCodes.INTERRUPTED);
      }
    }

    if (!flags['no-validate']) {
      try {
        // Cheap validation: list webhooks (small, low side effect)
        await getClient(apiKey).Webhooks.get();
      } catch (err) {
        const desc = describeError(err);
        // describeError already derived this from the HTTP status; matching on
        // the serialised body would also hit a 401 or 403 appearing in an id,
        // a record count, or a timestamp.
        if (desc.exitCode === ExitCodes.AUTH_INVALID) {
          // Keep the classification: wrapping this in a plain Error would
          // report the rejection but exit with the generic code.
          failWith(flags, {
            message: 'API key rejected by SendLayer (401/403). Check the key and try again.',
            code: 'AUTH_INVALID',
            exitCode: ExitCodes.AUTH_INVALID,
          });
        }
        // Network errors etc. — surface but allow opt-out via --no-validate
        handleError(flags, new Error(`Could not validate key: ${desc.message}. Re-run with --no-validate to skip.`));
      }
    }

    saveApiKey(apiKey, flags.profile);

    if (isJsonMode(flags)) {
      this.log(JSON.stringify({ saved: true, profile: flags.profile, path: credentialsPath() }, null, 2));
      return;
    }

    this.log(chalk.green('✓') + ` API key saved to profile ${chalk.bold(flags.profile)}`);
    this.log(chalk.dim(`  Key: ${maskApiKey(apiKey)}`));
    this.log(chalk.dim(`  Path: ${credentialsPath()}`));
  }

  protected async catch(err: Error & { exitCode?: number }): Promise<void> {
    // Let the already-written message reach a pipe before oclif exits.
    if (err instanceof Errors.ExitError) {
      await drainOutput();
      throw err;
    }
    return super.catch(err);
  }
}
