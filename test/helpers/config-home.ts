import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach } from 'vitest';

/**
 * Point the CLI's config dir at a fresh temp dir for each test in the suite.
 *
 * configDir() reads APPDATA on win32 and XDG_CONFIG_HOME everywhere else, so
 * both are redirected here rather than in each test file. Redirecting only one
 * of them meant a test run on Windows wrote to — and then deleted from — the
 * developer's real credentials file; CI is Linux-only and never saw it.
 *
 * @returns a live handle whose `dir` is the temp dir for the current test
 */
export function useTempConfigHome(): { readonly dir: string } {
  const handle = { dir: '' };
  let original: Record<string, string | undefined> = {};

  beforeEach(() => {
    handle.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-cli-'));
    original = {
      APPDATA: process.env.APPDATA,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    };
    process.env.APPDATA = handle.dir;
    process.env.XDG_CONFIG_HOME = handle.dir;
  });

  afterEach(() => {
    fs.rmSync(handle.dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  return handle;
}
