#!/usr/bin/env node

// Entrypoint for the single-file native binaries built by scripts/build-binaries.sh.
//
// Why this exists instead of reusing bin/run.js:
//
// bin/run.js calls oclif's `execute({dir: __dirname})`, which makes oclif locate
// the package on disk at runtime — it walks up from `dir` to find package.json
// (findRoot), reads oclif.manifest.json, then requires each command file by
// absolute path. A `bun build --compile` binary has none of that on the user's
// machine; worse, Bun replaces `__dirname` with the *build machine's* absolute
// path, so a binary built that way only works on the machine that built it.
//
// This entry removes every runtime filesystem lookup instead:
//   - package.json and oclif.manifest.json are `require`d statically, so the
//     bundler inlines them into the binary.
//   - Passing `pjson` for the root plugin makes oclif skip findRoot entirely
//     (see @oclif/core config/plugin.js — it only calls findRoot when pjson
//     is absent).
//   - Providing a prebuilt `plugins` map makes oclif use our in-memory plugin
//     as-is and skip plugin loading (and user/dev/core plugin scanning).
//   - Command metadata comes from the same manifest npm users get; `load()`
//     returns the statically imported class rather than requiring a path.
//
// Net effect: the binary is self-contained and location-independent.

const path = require('node:path');

const pjson = require('../package.json');
const manifest = require('../oclif.manifest.json');
const commandIndex = require('../dist/index.js');

const commandClasses = commandIndex.commands ?? commandIndex.default;

void (async () => {
  const { run, handle, flush } = await import('@oclif/core');

  // Nothing is read from `root`, but oclif expects a real-looking path.
  const root = path.dirname(process.execPath);
  const name = pjson.name;

  // The prerun hook is a no-op (auth is resolved in BaseCommand.getClient()),
  // and oclif resolves hooks by file path, so drop hooks from the binary.
  const binaryPjson = { ...pjson, oclif: { ...pjson.oclif, hooks: {} } };

  const missing = Object.keys(manifest.commands).filter((id) => !commandClasses[id]);
  if (missing.length > 0) {
    // A build-time wiring error: the manifest knows a command src/index.ts doesn't.
    throw new Error(
      `Binary is missing command implementations for: ${missing.join(', ')}. ` +
        'Add them to src/index.ts and rebuild.',
    );
  }

  const commands = Object.entries(manifest.commands).map(([id, cached]) => ({
    ...cached,
    id,
    load: async () => commandClasses[id],
  }));

  const plugin = {
    _base: `${name}@${pjson.version}`,
    alias: name,
    commandIDs: Object.keys(manifest.commands),
    commands,
    commandsDir: undefined,
    hasManifest: true,
    hooks: {},
    isRoot: true,
    moduleType: 'commonjs',
    name,
    options: { root },
    pjson: binaryPjson,
    root,
    type: 'core',
    valid: true,
    version: pjson.version,
    async findCommand(id, opts = {}) {
      const cmd = commandClasses[id];
      if (!cmd && opts.must) throw new Error(`command ${id} not found`);
      return cmd;
    },
    async load() {},
    get topics() {
      return Object.entries(this.pjson.oclif.topics ?? {}).map(([topicName, topic]) => ({
        name: topicName,
        ...topic,
      }));
    },
  };

  try {
    await run(process.argv.slice(2), {
      root,
      pjson: binaryPjson,
      plugins: new Map([[name, plugin]]),
    });
    await flush();
  } catch (error) {
    await handle(error);
  }
})();
