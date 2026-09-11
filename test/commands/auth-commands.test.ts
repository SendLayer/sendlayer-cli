import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { Config } from '@oclif/core';
import * as path from 'node:path';

import { asTty, captureConsole } from '../helpers/capture-console';
import { useTempConfigHome } from '../helpers/config-home';
import { ExitCodes } from '../../src/lib/errors';
import { readCredentials, saveApiKey } from '../../src/lib/auth';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock('sendlayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sendlayer')>();
  return {
    ...actual,
    SendLayer: vi.fn().mockImplementation(() => ({
      Emails: {},
      Webhooks: { get: getMock },
      Events: {},
    })),
  };
});

import Login from '../../src/commands/login';
import Logout from '../../src/commands/logout';
import Whoami from '../../src/commands/whoami';

useTempConfigHome();

let config: Config;

beforeAll(async () => {
  config = await Config.load(path.resolve(__dirname, '..', '..'));
});

beforeEach(() => {
  getMock.mockReset();
  delete process.env.SENDLAYER_API_KEY;
});

function exitCodeOf(err: unknown): number | undefined {
  return (err as { oclif?: { exit?: number } } | undefined)?.oclif?.exit;
}

describe('login', () => {
  it('validates the key and stores it', async () => {
    getMock.mockResolvedValue([]);

    const { stdout } = await captureConsole(() => Login.run(['--key', 'sl_live_abcd1234'], config));

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stdout)).toMatchObject({ saved: true, profile: 'default' });
    expect(readCredentials().profiles.default?.apiKey).toBe('sl_live_abcd1234');
  });

  it('skips validation with --no-validate', async () => {
    const { stdout } = await captureConsole(() =>
      Login.run(['--key', 'sl_live_abcd1234', '--no-validate', '--profile', 'staging'], config),
    );

    expect(getMock).not.toHaveBeenCalled();
    expect(JSON.parse(stdout)).toMatchObject({ saved: true, profile: 'staging' });
    expect(readCredentials().profiles.staging?.apiKey).toBe('sl_live_abcd1234');
  });

  it('reports a rejected key with the auth exit code', async () => {
    const { SendLayerAPIError } = await import('sendlayer');
    getMock.mockRejectedValue(new SendLayerAPIError('nope', 401, {}));

    const { stderr, error } = await captureConsole(() =>
      Login.run(['--key', 'sl_live_abcd1234'], config),
    );

    expect(JSON.parse(stderr).error).toMatch(/rejected by SendLayer/);
    expect(exitCodeOf(error)).toBe(ExitCodes.AUTH_INVALID);
    expect(readCredentials().profiles.default).toBeUndefined();
  });

  it('does not call a server error an auth failure just because the body contains 401', async () => {
    // Regression: the check used to regex /401|403/ over the serialised
    // response, so a webhook id, record count or timestamp containing those
    // digits was reported as a rejected API key.
    const { SendLayerAPIError } = await import('sendlayer');
    getMock.mockRejectedValue(
      new SendLayerAPIError('server blew up', 500, { WebhookID: 401, TotalRecords: 403 }),
    );

    const { stderr, error } = await captureConsole(() =>
      Login.run(['--key', 'sl_live_abcd1234'], config),
    );

    expect(JSON.parse(stderr).error).toMatch(/Could not validate key/);
    expect(JSON.parse(stderr).error).not.toMatch(/rejected by SendLayer/);
    expect(exitCodeOf(error)).toBe(ExitCodes.GENERIC);
  });
});

describe('logout', () => {
  it('removes a stored profile', async () => {
    saveApiKey('sl_live_abcd1234', 'default');

    const { stdout } = await captureConsole(() => Logout.run([], config));

    expect(JSON.parse(stdout)).toMatchObject({ removed: true, profile: 'default' });
    expect(readCredentials().profiles.default).toBeUndefined();
  });

  it('reports when there was nothing to remove', async () => {
    const { stdout } = await captureConsole(() => Logout.run(['--profile', 'ghost'], config));

    expect(JSON.parse(stdout)).toMatchObject({ removed: false, profile: 'ghost' });
  });
});

describe('whoami', () => {
  it('reports the env var as the source', async () => {
    process.env.SENDLAYER_API_KEY = 'sl_env_abcdefgh1234';

    const { stdout } = await captureConsole(() => Whoami.run([], config));

    const payload = JSON.parse(stdout);
    // The --api-key flag declares env: 'SENDLAYER_API_KEY', so oclif fills the
    // flag in from the environment and resolveApiKey sees it as a flag.
    expect(payload).toMatchObject({ authenticated: true, source: 'flag' });
    expect(payload.key).not.toContain('abcdefgh');
  });

  it('reports the stored profile and never prints the raw key', async () => {
    saveApiKey('sl_file_abcdefgh1234', 'staging');

    const { stdout } = await captureConsole(() => Whoami.run(['--profile', 'staging'], config));

    const payload = JSON.parse(stdout);
    expect(payload).toMatchObject({ authenticated: true, source: 'file', profile: 'staging' });
    expect(stdout).not.toContain('sl_file_abcdefgh1234');
    expect(payload.availableProfiles).toEqual(['staging']);
  });

  it('exits with the auth-missing code when nothing is configured', async () => {
    const { stdout, error } = await asTty(() => captureConsole(() => Whoami.run([], config)));

    expect(stdout).toMatch(/Not authenticated/);
    expect(exitCodeOf(error)).toBe(ExitCodes.AUTH_MISSING);
  });
});

describe('exit codes for missing credentials', () => {
  it('whoami --json reports the auth-missing code instead of success', async () => {
    // Regression: the JSON path returned before the exit call, so a script
    // piping `whoami` saw exit 0 with authenticated: false.
    const { stdout, error } = await captureConsole(() => Whoami.run([], config));

    expect(JSON.parse(stdout)).toMatchObject({ authenticated: false, key: null });
    expect(exitCodeOf(error)).toBe(ExitCodes.AUTH_MISSING);
  });
});
