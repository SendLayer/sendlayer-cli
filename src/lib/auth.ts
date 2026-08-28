import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const APP_DIR = 'sendlayer';
const CREDENTIALS_FILE = 'credentials.json';
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

export interface ProfileCredentials {
  apiKey: string;
  createdAt: string;
}

export interface CredentialsFile {
  defaultProfile?: string;
  profiles: Record<string, ProfileCredentials>;
}

export function configDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, APP_DIR);
  }
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdgConfigHome, APP_DIR);
}

export function credentialsPath(): string {
  return path.join(configDir(), CREDENTIALS_FILE);
}

export function listenStatePath(): string {
  return path.join(configDir(), 'listen-state.json');
}

function ensureConfigDir(): void {
  const dir = configDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  }
}

function emptyFile(): CredentialsFile {
  return { defaultProfile: 'default', profiles: {} };
}

export function readCredentials(): CredentialsFile {
  const file = credentialsPath();
  if (!fs.existsSync(file)) return emptyFile();
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as CredentialsFile;
    if (!parsed.profiles || typeof parsed.profiles !== 'object') {
      return emptyFile();
    }
    return parsed;
  } catch {
    return emptyFile();
  }
}

export function writeCredentials(data: CredentialsFile): void {
  ensureConfigDir();
  const file = credentialsPath();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: FILE_MODE });
  try {
    fs.chmodSync(file, FILE_MODE);
  } catch {
    // best-effort on platforms that ignore mode (e.g. Windows)
  }
}

export function saveApiKey(apiKey: string, profile = 'default'): void {
  const data = readCredentials();
  data.profiles[profile] = {
    apiKey,
    createdAt: new Date().toISOString(),
  };
  if (!data.defaultProfile) data.defaultProfile = profile;
  writeCredentials(data);
}

export function deleteProfile(profile = 'default'): boolean {
  const data = readCredentials();
  if (!data.profiles[profile]) return false;
  delete data.profiles[profile];
  if (data.defaultProfile === profile) {
    const remaining = Object.keys(data.profiles);
    data.defaultProfile = remaining[0];
  }
  writeCredentials(data);
  return true;
}

export interface ResolvedAuth {
  apiKey: string;
  source: 'flag' | 'env' | 'file';
  profile?: string;
}

/**
 * Resolution order: --api-key flag > SENDLAYER_API_KEY env > stored credentials.
 */
export function resolveApiKey(opts: {
  flagKey?: string;
  profile?: string;
}): ResolvedAuth | null {
  if (opts.flagKey) {
    return { apiKey: opts.flagKey, source: 'flag' };
  }

  const envKey = process.env.SENDLAYER_API_KEY;
  if (envKey) {
    return { apiKey: envKey, source: 'env' };
  }

  const data = readCredentials();
  const profile = opts.profile || data.defaultProfile || 'default';
  const stored = data.profiles[profile];
  if (stored?.apiKey) {
    return { apiKey: stored.apiKey, source: 'file', profile };
  }

  return null;
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return '*'.repeat(apiKey.length);
  const head = apiKey.slice(0, 4);
  const tail = apiKey.slice(-4);
  return `${head}${'*'.repeat(Math.max(4, apiKey.length - 8))}${tail}`;
}
