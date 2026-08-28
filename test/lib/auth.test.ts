import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  configDir,
  credentialsPath,
  saveApiKey,
  readCredentials,
  resolveApiKey,
  deleteProfile,
  maskApiKey,
} from '../../src/lib/auth';

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-cli-'));
  process.env.XDG_CONFIG_HOME = tmpHome;
  delete process.env.SENDLAYER_API_KEY;
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.XDG_CONFIG_HOME;
});

describe('configDir / credentialsPath', () => {
  it('honors XDG_CONFIG_HOME on linux/darwin', () => {
    if (process.platform === 'win32') return;
    expect(configDir()).toBe(path.join(tmpHome, 'sendlayer'));
    expect(credentialsPath()).toBe(path.join(tmpHome, 'sendlayer', 'credentials.json'));
  });
});

describe('saveApiKey / readCredentials', () => {
  it('writes 0600 credentials.json with the profile', () => {
    if (process.platform === 'win32') return;
    saveApiKey('sl_abc123456789', 'default');
    const data = readCredentials();
    expect(data.profiles.default?.apiKey).toBe('sl_abc123456789');
    const stat = fs.statSync(credentialsPath());
    // mode bits: only owner read+write
    expect((stat.mode & 0o777).toString(8)).toBe('600');
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
