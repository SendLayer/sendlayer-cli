import { Command, Flags, Interfaces } from '@oclif/core';
import { resolveApiKey } from './lib/auth';
import { handleError } from './lib/errors';
import { getClient } from './lib/client';
import type { SendLayer } from 'sendlayer';

export type BaseFlags<T extends typeof Command> = Interfaces.InferredFlags<typeof BaseCommand['baseFlags'] & T['flags']>;
export type BaseArgs<T extends typeof Command> = Interfaces.InferredArgs<T['args']>;

export abstract class BaseCommand<T extends typeof Command> extends Command {
  static enableJsonFlag = false;

  static baseFlags = {
    'api-key': Flags.string({
      description: 'SendLayer API key (overrides env and config)',
      env: 'SENDLAYER_API_KEY',
      helpGroup: 'GLOBAL',
    }),
    profile: Flags.string({
      description: 'Named credentials profile',
      default: 'default',
      helpGroup: 'GLOBAL',
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      helpGroup: 'GLOBAL',
    }),
  };

  protected flags!: BaseFlags<T>;
  protected args!: BaseArgs<T>;

  /** Override in commands that don't need auth (e.g. login). */
  protected requiresAuth(): boolean {
    return true;
  }

  public async init(): Promise<void> {
    await super.init();
    const { flags, args } = await this.parse({
      flags: this.ctor.flags,
      baseFlags: (super.ctor as typeof BaseCommand).baseFlags,
      args: this.ctor.args,
      strict: this.ctor.strict,
    });
    this.flags = flags as BaseFlags<T>;
    this.args = args as BaseArgs<T>;
  }

  protected getClient(): SendLayer {
    const auth = resolveApiKey({
      flagKey: this.flags['api-key'],
      profile: this.flags.profile,
    });
    if (!auth) {
      handleError(this.flags, new Error("No API key found. Run 'sendlayer login' or set SENDLAYER_API_KEY."));
    }
    return getClient(auth!.apiKey);
  }

  protected async catch(err: Error & { exitCode?: number }): Promise<void> {
    handleError(this.flags, err);
  }
}
