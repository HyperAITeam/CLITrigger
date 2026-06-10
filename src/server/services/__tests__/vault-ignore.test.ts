import { describe, it, expect } from 'vitest';
import ignore from 'ignore';
import { unhideInVaultIgnore } from '../file-scanner.js';

function ignores(content: string, matchPath: string): boolean {
  const ig = ignore();
  ig.add(content);
  return ig.ignores(matchPath);
}

describe('unhideInVaultIgnore', () => {
  it('removes the exact anchored pattern (inverse of a prior hide)', () => {
    const next = unhideInVaultIgnore('/docs/draft.md\n', 'docs/draft.md', false);
    expect(next).toBe('');
    expect(ignores(next, 'docs/draft.md')).toBe(false);
  });

  it('removes the exact anchored directory pattern', () => {
    const next = unhideInVaultIgnore('/private/\n', 'private', true);
    expect(next).toBe('');
    expect(ignores(next, 'private/')).toBe(false);
  });

  it('appends a negation under a broad ignore-all pattern', () => {
    const next = unhideInVaultIgnore('*\n', 'README.md', false);
    expect(ignores(next, 'README.md')).toBe(false);
    // Everything else stays hidden.
    expect(ignores(next, 'other.md')).toBe(true);
  });

  it('builds the ancestor negation chain for nested files', () => {
    const next = unhideInVaultIgnore('*\n', 'docs/guide/setup.md', false);
    expect(next).toContain('!/docs/');
    expect(next).toContain('!/docs/guide/');
    expect(next).toContain('!/docs/guide/setup.md');
    expect(ignores(next, 'docs/guide/setup.md')).toBe(false);
    // Siblings stay hidden — re-included ancestors don't expose them.
    expect(ignores(next, 'docs/guide/other.md')).toBe(true);
    expect(ignores(next, 'docs/readme.md')).toBe(true);
  });

  it('un-hides a whole directory subtree under ignore-all', () => {
    const next = unhideInVaultIgnore('*\n', 'docs', true);
    expect(ignores(next, 'docs/')).toBe(false);
    expect(ignores(next, 'docs/a.md')).toBe(false);
    expect(ignores(next, 'docs/sub/b.md')).toBe(false);
    expect(ignores(next, 'elsewhere.md')).toBe(true);
  });

  it('is idempotent — no duplicate negation lines on repeat calls', () => {
    const once = unhideInVaultIgnore('*\n', 'docs/a.md', false);
    const twice = unhideInVaultIgnore(once, 'docs/a.md', false);
    expect(twice).toBe(once);
  });

  it('leaves unrelated hand-written patterns untouched', () => {
    const next = unhideInVaultIgnore('*.draft.md\n/notes/secret.md\n', 'notes/secret.md', false);
    expect(next).toContain('*.draft.md');
    expect(next).not.toContain('/notes/secret.md\n');
    expect(ignores(next, 'notes/secret.md')).toBe(false);
    expect(ignores(next, 'a.draft.md')).toBe(true);
  });

  it('normalizes backslashes and stray slashes in the path', () => {
    const next = unhideInVaultIgnore('*\n', 'docs\\guide\\setup.md', false);
    expect(ignores(next, 'docs/guide/setup.md')).toBe(false);
  });
});
