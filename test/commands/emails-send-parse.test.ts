import { describe, it, expect } from 'vitest';
import {
  guessMime,
  parseAttachments,
  parseHeaders,
  splitAttachmentSpec,
} from '../../src/commands/emails/send';

describe('guessMime', () => {
  it('maps known extensions', () => {
    expect(guessMime('report.pdf')).toBe('application/pdf');
    expect(guessMime('photo.JPG')).toBe('image/jpeg');
    expect(guessMime('data.csv')).toBe('text/csv');
  });

  it('falls back to octet-stream', () => {
    expect(guessMime('mystery.qqq')).toBe('application/octet-stream');
    expect(guessMime('no-extension')).toBe('application/octet-stream');
  });
});

describe('splitAttachmentSpec', () => {
  it('splits the documented fields', () => {
    expect(splitAttachmentSpec('./a.pdf:application/pdf:inline:renamed.pdf')).toEqual([
      './a.pdf',
      'application/pdf',
      'inline',
      'renamed.pdf',
    ]);
  });

  it('keeps a Windows drive letter with its path', () => {
    // Regression: a plain split(':') made the drive letter the path and the
    // rest of the path the MIME type, breaking every absolute Windows path.
    expect(splitAttachmentSpec(String.raw`C:\Users\me\report.pdf`)).toEqual([
      String.raw`C:\Users\me\report.pdf`,
    ]);
    expect(splitAttachmentSpec(String.raw`C:\Users\me\report.pdf:application/pdf`)).toEqual([
      String.raw`C:\Users\me\report.pdf`,
      'application/pdf',
    ]);
    expect(splitAttachmentSpec(String.raw`D:/forward/slashes.png:image/png:inline`)).toEqual([
      'D:/forward/slashes.png',
      'image/png',
      'inline',
    ]);
  });

  it('gives any extra colons to the filename', () => {
    expect(splitAttachmentSpec('./a.txt:text/plain:inline:odd:name.txt')).toEqual([
      './a.txt',
      'text/plain',
      'inline',
      'odd:name.txt',
    ]);
  });
});

describe('parseAttachments', () => {
  it('returns undefined when there is nothing to parse', () => {
    expect(parseAttachments(undefined)).toBeUndefined();
    expect(parseAttachments([])).toBeUndefined();
  });

  it('fills in type, filename and disposition', () => {
    expect(parseAttachments(['./docs/report.pdf'])).toEqual([
      {
        path: './docs/report.pdf',
        type: 'application/pdf',
        filename: 'report.pdf',
        disposition: 'attachment',
      },
    ]);
  });

  it('honours explicit fields', () => {
    expect(parseAttachments(['./logo.png:image/png:inline:brand.png'])).toEqual([
      { path: './logo.png', type: 'image/png', filename: 'brand.png', disposition: 'inline' },
    ]);
  });

  it('handles an absolute Windows path', () => {
    const [attachment] = parseAttachments([String.raw`C:\Users\me\report.pdf`]) ?? [];
    expect(attachment.path).toBe(String.raw`C:\Users\me\report.pdf`);
    expect(attachment.type).toBe('application/pdf');
    expect(attachment.disposition).toBe('attachment');
  });

  it('rejects an empty path', () => {
    expect(() => parseAttachments([':application/pdf'])).toThrow(/path is required/);
  });
});

describe('parseHeaders', () => {
  it('returns undefined when there is nothing to parse', () => {
    expect(parseHeaders(undefined)).toBeUndefined();
    expect(parseHeaders([])).toBeUndefined();
  });

  it('splits on the first = and trims', () => {
    expect(parseHeaders([' X-Campaign = spring-sale '])).toEqual({ 'X-Campaign': 'spring-sale' });
  });

  it('keeps = inside the value', () => {
    expect(parseHeaders(['X-Data=a=b=c'])).toEqual({ 'X-Data': 'a=b=c' });
  });

  it('rejects a value with no =', () => {
    expect(() => parseHeaders(['X-Broken'])).toThrow(/expected Key=Value/);
  });
});
