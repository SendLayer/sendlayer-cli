import { Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import type { EmailOptions, EmailRecipient, EmailAttachment } from 'sendlayer';
import { BaseCommand } from '../../base-command';
import { emit } from '../../lib/output';
import { handleError } from '../../lib/errors';

const DEFAULT_MIME = 'application/octet-stream';

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.html': 'text/html',
  '.zip': 'application/zip',
};

function guessMime(filename: string): string {
  return MIME_BY_EXT[path.extname(filename).toLowerCase()] || DEFAULT_MIME;
}

function parseRecipientList(value: string | undefined): EmailRecipient[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      // Accept "Name <email@x>" or plain "email@x"
      const match = entry.match(/^\s*(.*?)\s*<(.+?)>\s*$/);
      if (match) {
        return { name: match[1] || undefined, email: match[2] };
      }
      return { email: entry };
    });
}

function parseSingleRecipient(value: string | undefined): EmailRecipient | undefined {
  const list = parseRecipientList(value);
  return list?.[0];
}

function parseHeaders(values: string[] | undefined): Record<string, string> | undefined {
  if (!values?.length) return undefined;
  const out: Record<string, string> = {};
  for (const entry of values) {
    const eq = entry.indexOf('=');
    if (eq < 0) {
      throw new Error(`Invalid --header value (expected Key=Value): ${entry}`);
    }
    out[entry.slice(0, eq).trim()] = entry.slice(eq + 1).trim();
  }
  return out;
}

function parseAttachments(values: string[] | undefined): EmailAttachment[] | undefined {
  if (!values?.length) return undefined;
  return values.map((entry) => {
    // Format: path[:mime[:disposition[:filename]]]
    const [filePath, mime, disposition, filename] = entry.split(':');
    if (!filePath) throw new Error('Attachment path is required');
    return {
      path: filePath,
      type: mime || guessMime(filePath),
      filename: filename || path.basename(filePath),
      disposition: (disposition as 'attachment' | 'inline' | undefined) || 'attachment',
    };
  });
}

export default class EmailsSend extends BaseCommand<typeof EmailsSend> {
  static description = 'Send a transactional email.';
  static examples = [
    '<%= config.bin %> emails send --from a@x.com --to b@y.com --subject Hello --text "hi"',
    '<%= config.bin %> emails send --from "Acme <a@x.com>" --to b@y.com,c@z.com --subject Hi --html-file ./mail.html',
    '<%= config.bin %> emails send --file ./payload.json',
  ];

  static flags = {
    file: Flags.string({ description: 'Read full email payload from a JSON file' }),
    from: Flags.string({ description: 'Sender (email or "Name <email>")' }),
    to: Flags.string({ description: 'Comma-separated recipient list' }),
    cc: Flags.string({ description: 'Comma-separated CC list' }),
    bcc: Flags.string({ description: 'Comma-separated BCC list' }),
    'reply-to': Flags.string({ description: 'Comma-separated reply-to list' }),
    subject: Flags.string({ description: 'Email subject' }),
    text: Flags.string({ description: 'Plain text body' }),
    html: Flags.string({ description: 'HTML body (literal)' }),
    'html-file': Flags.string({ description: 'Path to a file containing the HTML body' }),
    'text-file': Flags.string({ description: 'Path to a file containing the plain text body' }),
    tag: Flags.string({ description: 'Tag (repeatable)', multiple: true }),
    header: Flags.string({ description: 'Header in Key=Value form (repeatable)', multiple: true }),
    attachment: Flags.string({
      description: 'Attachment in path[:mime[:disposition[:filename]]] (repeatable)',
      multiple: true,
    }),
  };

  async run(): Promise<void> {
    const flags = this.flags;
    let payload: EmailOptions;

    if (flags.file) {
      try {
        const raw = fs.readFileSync(flags.file, 'utf8');
        payload = JSON.parse(raw) as EmailOptions;
      } catch (err) {
        return handleError(flags, err);
      }
    } else {
      // Build payload from flags
      const from = parseSingleRecipient(flags.from);
      const to = parseRecipientList(flags.to);
      if (!from) return handleError(flags, new Error('--from is required (or use --file)'));
      if (!to?.length) return handleError(flags, new Error('--to is required (or use --file)'));
      if (!flags.subject) return handleError(flags, new Error('--subject is required (or use --file)'));

      const html = flags.html || (flags['html-file'] ? fs.readFileSync(flags['html-file'], 'utf8') : undefined);
      const text = flags.text || (flags['text-file'] ? fs.readFileSync(flags['text-file'], 'utf8') : undefined);
      if (!html && !text) {
        return handleError(flags, new Error('Provide one of --text, --html, --text-file, or --html-file'));
      }

      try {
        payload = {
          from,
          to,
          subject: flags.subject,
          ...(html ? { html } : {}),
          ...(text ? { text } : {}),
          ...(flags.cc ? { cc: parseRecipientList(flags.cc) } : {}),
          ...(flags.bcc ? { bcc: parseRecipientList(flags.bcc) } : {}),
          ...(flags['reply-to'] ? { replyTo: parseRecipientList(flags['reply-to']) } : {}),
          ...(flags.tag?.length ? { tags: flags.tag } : {}),
          ...(flags.header?.length ? { headers: parseHeaders(flags.header) } : {}),
          ...(flags.attachment?.length ? { attachments: parseAttachments(flags.attachment) } : {}),
        };
      } catch (err) {
        return handleError(flags, err);
      }
    }

    const client = this.getClient();
    try {
      const result = await client.Emails.send(payload);
      emit(flags, result, () => `${chalk.green('✓')} Email queued. MessageID: ${chalk.bold(result.MessageID)}`);
    } catch (err) {
      return handleError(flags, err);
    }
  }
}
