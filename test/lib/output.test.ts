import { describe, it, expect, vi } from 'vitest';
import { isJsonMode, table } from '../../src/lib/output';

describe('isJsonMode', () => {
  it('returns true when --json flag is set', () => {
    expect(isJsonMode({ json: true })).toBe(true);
  });

  it('returns true when stdout is not a TTY', () => {
    const original = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    expect(isJsonMode(undefined)).toBe(true);
    Object.defineProperty(process.stdout, 'isTTY', { value: original, configurable: true });
  });
});

describe('table', () => {
  it('renders aligned rows', () => {
    const out = table([
      { id: 1, name: 'a' },
      { id: 22, name: 'bb' },
    ]);
    expect(out).toContain('id');
    expect(out).toContain('name');
    expect(out).toContain('22');
    expect(out).toContain('bb');
  });

  it('returns dim placeholder when no rows', () => {
    expect(table([])).toContain('no records');
  });
});
