import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { useTempConfigHome } from '../helpers/config-home';
import {
  activeProfile,
  configDir,
  credentialsPath,
  saveApiKey,
  readCredentials,
  resolveApiKey,
  deleteProfile,
  maskApiKey,
} from '../../src/lib/auth';

const home = useTempConfigHome();

beforeEach(() => {
  delete process.env.SENDLAYER_API_KEY;
});

describe('configDir / credentialsPath', () => {
  it('resolves under the redirected config home on every platform', () => {
    expect(configDir()).toBe(path.join(home.dir, 'sendlayer'));
    expect(credentialsPath()).toBe(path.join(home.dir, 'sendlayer', 'credentials.json'));
  });
});

describe('saveApiKey / readCredentials', () => {
  it('stores the key under the named profile', () => {
    saveApiKey('sl_abc123456789', 'default');
    expect(readCredentials().profiles.default?.apiKey).toBe('sl_abc123456789');
  });

  // Windows doesn't carry POSIX mode bits, so only assert them where they mean
  // something. The redirection above keeps the write itself safe everywhere.
  it.skipIf(process.platform === 'win32')('writes credentials.json as 0600', () => {
    saveApiKey('sl_abc123456789', 'default');
    const stat = fs.statSync(credentialsPath());
    expect((stat.mode & 0o777).toString(8)).toBe('600');
  });

  it('re-chmods an existing credentials file', () => {
    saveApiKey('first', 'default');
    fs.chmodSync(credentialsPath(), 0o644);
    saveApiKey('second', 'default');
    if (process.platform !== 'win32') {
      expect((fs.statSync(credentialsPath()).mode & 0o777).toString(8)).toBe('600');
    }
    expect(readCredentials().profiles.default?.apiKey).toBe('second');
  });

  it('supports multiple profiles', () => {
    saveApiKey('key-one', 'default');
    saveApiKey('key-two', 'staging');
    const data = readCredentials();
    expect(Object.keys(data.profiles).sort()).toEqual(['default', 'staging']);
  });
});

describe('resolveApiKey precedence', () => {
  it('flag wins over env wins over file', () => {
    saveApiKey('file-key', 'default');
    process.env.SENDLAYER_API_KEY = 'env-key';

    expect(resolveApiKey({ flagKey: 'flag-key' })?.apiKey).toBe('flag-key');
    expect(resolveApiKey({ flagKey: 'flag-key' })?.source).toBe('flag');

    expect(resolveApiKey({})?.apiKey).toBe('env-key');
    expect(resolveApiKey({})?.source).toBe('env');

    delete process.env.SENDLAYER_API_KEY;
    expect(resolveApiKey({})?.apiKey).toBe('file-key');
    expect(resolveApiKey({})?.source).toBe('file');
  });

  it('returns null when nothing is configured', () => {
    expect(resolveApiKey({})).toBeNull();
  });

  it('reads the named profile', () => {
    saveApiKey('default-key', 'default');
    saveApiKey('staging-key', 'staging');
    expect(resolveApiKey({ profile: 'staging' })?.apiKey).toBe('staging-key');
  });
});

describe('deleteProfile', () => {
  it('removes the entry and reports success', () => {
    saveApiKey('k', 'default');
    expect(deleteProfile('default')).toBe(true);
    expect(deleteProfile('default')).toBe(false);
    expect(readCredentials().profiles.default).toBeUndefined();
  });

  it('moves the default to a remaining profile, which resolveApiKey then uses', () => {
    saveApiKey('default-key', 'default');
    saveApiKey('staging-key', 'staging');

    deleteProfile('default');

    expect(readCredentials().defaultProfile).toBe('staging');
    expect(resolveApiKey({})).toMatchObject({ apiKey: 'staging-key', profile: 'staging' });
  });
});

describe('default profile', () => {
  it('is set to the first profile saved', () => {
    // Regression: the empty file pre-set defaultProfile to 'default', so this
    // never fired and a lone non-default profile was unreachable.
    saveApiKey('work-key', 'work');
    saveApiKey('other-key', 'other');

    expect(readCredentials().defaultProfile).toBe('work');
    expect(resolveApiKey({})).toMatchObject({ apiKey: 'work-key', source: 'file', profile: 'work' });
  });

  it('repairs a default that points at a missing profile', () => {
    // The shape older versions left behind after `login --profile work`.
    fs.mkdirSync(path.dirname(credentialsPath()), { recursive: true });
    fs.writeFileSync(credentialsPath(), JSON.stringify({ defaultProfile: 'default', profiles: {} }));

    saveApiKey('work-key', 'work');

    expect(readCredentials().defaultProfile).toBe('work');
  });

  it('activeProfile prefers the explicit name, then the stored default', () => {
    expect(activeProfile()).toBe('default');
    saveApiKey('work-key', 'work');
    expect(activeProfile()).toBe('work');
    expect(activeProfile('staging')).toBe('staging');
  });
});

describe('maskApiKey', () => {
  it('shows first 4 and last 4 chars', () => {
    expect(maskApiKey('sl_abcdefghijkl1234')).toMatch(/^sl_a.+1234$/);
    expect(maskApiKey('sl_abcdefghijkl1234')).not.toContain('cdefghijkl');
  });
  it('handles short keys without leaking', () => {
    expect(maskApiKey('abc')).toBe('***');
  });
});
