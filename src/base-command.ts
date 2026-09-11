import { Command, Errors, Flags, Interfaces } from '@oclif/core';
import { resolveApiKey, type ResolvedAuth } from './lib/auth';
import { describeError, ExitCodes, failWith, isUsageError } from './lib/errors';
import { getClient } from './lib/client';
import { drainOutput, emitError, isJsonMode } from './lib/output';
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

  /**
   * The credentials this invocation will use, from --api-key, the environment,
   * or the stored profile. Commands that need to identify the account (rather
   * than just talk to it) should use this instead of re-deriving the key.
   */
  protected resolveAuth(): ResolvedAuth {
    const auth = resolveApiKey({
      flagKey: this.flags['api-key'],
      profile: this.flags.profile,
    });
    if (!auth) {
      // Wrapping this in a plain Error reported it as generic and left the
      // documented AUTH_MISSING code unreachable.
      failWith(this.flags, {
        message: "No API key found. Run 'sendlayer login' or set SENDLAYER_API_KEY.",
        code: 'AUTH_MISSING',
        exitCode: ExitCodes.AUTH_MISSING,
      });
    }
    return auth;
  }

  protected getClient(): SendLayer {
    return getClient(this.resolveAuth().apiKey);
  }

  protected async catch(err: Error & { exitCode?: number }): Promise<void> {
    // The message was already written by whoever threw this — just make
    // sure it lands before oclif exits.
    if (err instanceof Errors.ExitError) {
      await drainOutput();
      throw err;
    }

    // Parse errors come with oclif's own rendering and usage text. Keep that in
    // interactive use and only correct the exit code; in JSON mode the caller
    // wants the machine-readable shape instead.
    if (isUsageError(err)) {
      if (isJsonMode(this.flags)) {
        emitError(this.flags, describeError(err));
        await drainOutput();
        process.exitCode = ExitCodes.USAGE;
        throw new Errors.ExitError(ExitCodes.USAGE);
      }
      err.oclif = { ...err.oclif, exit: ExitCodes.USAGE };
      process.exitCode = ExitCodes.USAGE;
      throw err;
    }

    const payload = describeError(err);
    emitError(this.flags, payload);
    await drainOutput();
    process.exitCode = payload.exitCode;
    throw new Errors.ExitError(payload.exitCode);
  }
}
