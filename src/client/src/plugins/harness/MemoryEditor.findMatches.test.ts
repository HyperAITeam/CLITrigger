import { describe, it, expect } from 'vitest';
import { findMatches } from './MemoryEditor';

describe('findMatches', () => {
  it('returns all occurrences case-insensitively', () => {
    expect(findMatches('Foo bar foo BAZ FOO', 'foo')).toEqual([0, 8, 16]);
  });

  it('returns empty for empty needle or no match', () => {
    expect(findMatches('abc', '')).toEqual([]);
    expect(findMatches('abc', 'xyz')).toEqual([]);
  });

  it('does not overlap matches', () => {
    expect(findMatches('aaaa', 'aa')).toEqual([0, 2]);
  });
});
