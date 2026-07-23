import { describe, it, expect } from 'vitest';
import { formatDroppedPaths } from './SessionTerminal';

describe('formatDroppedPaths', () => {
  it('inserts a path without whitespace as-is plus a trailing space', () => {
    expect(formatDroppedPaths(['C:\\Users\\me\\file.ts'])).toBe('C:\\Users\\me\\file.ts ');
  });

  it('quotes a path containing whitespace', () => {
    expect(formatDroppedPaths(['/home/me/My Docs/a.txt'])).toBe('"/home/me/My Docs/a.txt" ');
  });

  it('joins multiple paths with spaces, quoting only those that need it', () => {
    expect(formatDroppedPaths(['/a/b.txt', '/c d/e.txt'])).toBe('/a/b.txt "/c d/e.txt" ');
  });

  it('returns an empty string for an empty list', () => {
    expect(formatDroppedPaths([])).toBe('');
  });

  it('drops empty entries', () => {
    expect(formatDroppedPaths(['', '/a.txt'])).toBe('/a.txt ');
  });
});
