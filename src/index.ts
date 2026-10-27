import type { Command } from '@oclif/core';

import EmailsSend from './commands/emails/send';
import EventsList from './commands/events/list';
import Login from './commands/login';
import Logout from './commands/logout';
import WebhooksCreate from './commands/webhooks/create';
import WebhooksDelete from './commands/webhooks/delete';
import WebhooksList from './commands/webhooks/list';
import WebhooksListen from './commands/webhooks/listen';
import Whoami from './commands/whoami';

/**
 * Static registry of every command, keyed by oclif command id.
 *
 * oclif normally discovers commands at runtime by globbing `dist/commands/**`
 * and requiring each file by absolute path. That works for npm installs but
 * breaks inside a single-file compiled binary, where those paths don't exist on
 * the user's machine. Listing the classes here makes the whole command tree
 * reachable through static imports, so a bundler can see and embed it.
 *
 * Ids use ':' as the separator (matching oclif.manifest.json) even though the
 * CLI presents them space-separated via `oclif.topicSeparator`.
 *
 * Keep in sync with src/commands/ — test/command-index.test.ts enforces this.
 */
export const commands: Record<string, Command.Class> = {
  'emails:send': EmailsSend,
  'events:list': EventsList,
  login: Login,
  logout: Logout,
  'webhooks:create': WebhooksCreate,
  'webhooks:delete': WebhooksDelete,
  'webhooks:list': WebhooksList,
  'webhooks:listen': WebhooksListen,
  whoami: Whoami,
} as unknown as Record<string, Command.Class>;

export { BaseCommand } from './base-command';
export default commands;
