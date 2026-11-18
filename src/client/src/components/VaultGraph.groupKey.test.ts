import { describe, it, expect } from 'vitest';
import { groupKey } from './VaultGraph';

describe('groupKey', () => {
  it('groups by top-level folder at root, keeps root files as-is', () => {
    expect(groupKey('docs/api/x.md', '')).toBe('docs/');
    expect(groupKey('README.md', '')).toBe('README.md');
  });

  it('shows immediate children inside a folder', () => {
    expect(groupKey('docs/api/x.md', 'docs/')).toBe('docs/api/');
    expect(groupKey('docs/intro.md', 'docs/')).toBe('docs/intro.md');
  });

  it('maps outside paths to the sibling under the nearest shared ancestor', () => {
    expect(groupKey('docs/guide/y.md', 'docs/api/')).toBe('docs/guide/');
    expect(groupKey('docs/intro.md', 'docs/api/')).toBe('docs/intro.md');
    expect(groupKey('src/a/b.md', 'docs/api/')).toBe('src/');
    expect(groupKey('README.md', 'docs/api/')).toBe('README.md');
  });

  it('does not treat a name prefix as a parent folder', () => {
    expect(groupKey('docs2/x.md', 'docs/')).toBe('docs2/');
  });
});
