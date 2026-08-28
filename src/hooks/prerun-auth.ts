import { Hook } from '@oclif/core';

/**
 * No-op hook today — auth is resolved per-command in BaseCommand.getClient().
 * Reserved for future cross-cutting checks (e.g. version warnings).
 */
const hook: Hook<'prerun'> = async function () {
  return;
};

export default hook;
