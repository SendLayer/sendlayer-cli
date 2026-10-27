import { Flags } from '@oclif/core';
import chalk from 'chalk';
import { BaseCommand } from '../../base-command';
import { emit, table } from '../../lib/output';
import { handleError } from '../../lib/errors';

const VALID_EVENT_TYPES = [
  'accepted',
  'rejected',
  'delivered',
  'opened',
  'clicked',
  'unsubscribed',
  'complained',
  'failed',
] as const;

function parseDate(input: string | undefined, label: string): Date | undefined {
  if (!input) return undefined;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid ${label} date: '${input}' (use ISO 8601, e.g. 2026-05-09T00:00:00Z)`);
  }
  return d;
}

export default class EventsList extends BaseCommand<typeof EventsList> {
  static description = 'List delivery and engagement events.';
  static aliases = ['events'];
  static examples = [
    '<%= config.bin %> events list',
    '<%= config.bin %> events list --event delivered --limit 20',
    '<%= config.bin %> events list --start 2026-05-01 --end 2026-05-09',
  ];

  static flags = {
    event: Flags.string({
      description: `Filter by event type (${VALID_EVENT_TYPES.join(', ')})`,
      options: [...VALID_EVENT_TYPES],
    }),
    start: Flags.string({ description: 'Start date (ISO 8601)' }),
    end: Flags.string({ description: 'End date (ISO 8601)' }),
    'message-id': Flags.string({ description: 'Filter by MessageId' }),
    limit: Flags.integer({ description: 'Max records (1-100)', min: 1, max: 100 }),
  };

  async run(): Promise<void> {
    let startDate: Date | undefined;
    let endDate: Date | undefined;
    try {
      startDate = parseDate(this.flags.start, 'start');
      endDate = parseDate(this.flags.end, 'end');
    } catch (err) {
      return handleError(this.flags, err);
    }

    const client = this.getClient();
    try {
      const result = await client.Events.get({
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        ...(this.flags.event ? { event: this.flags.event } : {}),
        ...(this.flags['message-id'] ? { messageId: this.flags['message-id'] } : {}),
        ...(this.flags.limit ? { retrieveCount: this.flags.limit } : {}),
      });
      emit(this.flags, result, () => {
        if (!result.Events.length) return chalk.dim(`No events found (total ${result.TotalRecords}).`);
        const rows = result.Events.map((e) => ({
          loggedAt: new Date(e.LoggedAt * 1000).toISOString(),
          event: e.Event,
          // Message.Headers.To is the recipient field the SDK actually declares;
          // a top-level Recipient isn't part of the Event type.
          recipient: e.Message?.Headers?.To?.join(', ') ?? '',
          messageId: e.Message?.Headers?.MessageId ?? '',
          subject: e.Message?.Headers?.Subject ?? '',
        }));
        const head = chalk.dim(`Total records: ${result.TotalRecords}`);
        return `${head}\n${table(rows, ['loggedAt', 'event', 'recipient', 'messageId', 'subject'])}`;
      });
    } catch (err) {
      return handleError(this.flags, err);
    }
  }
}
