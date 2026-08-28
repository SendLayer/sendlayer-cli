import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { commands } from '../src/index';

const COMMANDS_DIR = path.join(__dirname, '..', 'src', 'commands');

/** Walk src/commands and derive the oclif command id for each .ts file. */
function discoverCommandIds(dir: string, prefix: string[] = []): string[] {
  const ids: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      ids.push(...discoverCommandIds(path.join(dir, entry.name), [...prefix, entry.name]));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      ids.push([...prefix, entry.name.replace(/\.ts$/, '')].join(':'));
    }
  }
  return ids;
}

/**
 * The native binaries resolve commands through the static map in src/index.ts
 * rather than oclif's runtime glob. If a new command file is added but not
 * registered there, npm installs keep working while the binaries silently lose
 * the command — so guard the two against drifting apart.
 */
describe('command index', () => {
  const discovered = discoverCommandIds(COMMANDS_DIR).sort();
  const registered = Object.keys(commands).sort();

  it('finds command files on disk', () => {
    expect(discovered.length).toBeGreaterThan(0);
  });

  it('registers every command file in src/index.ts', () => {
    expect(registered).toEqual(discovered);
  });

  it('maps every id to a runnable command class', () => {
    for (const [id, cmd] of Object.entries(commands)) {
      expect(typeof cmd, `${id} should map to a class`).toBe('function');
      expect(typeof (cmd as { run?: unknown }).run, `${id} should have a static run()`).toBe('function');
    }
  });
});
