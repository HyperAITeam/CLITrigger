import { describe, it, expect } from 'vitest';
import { resolveVaultRelative, visibleTreeItems, treeRange } from './files-utils';
import type { FileEntry } from '../../api/files';

describe('visibleTreeItems / treeRange', () => {
  const dir = (name: string): FileEntry => ({ name, type: 'directory', size: null, mtime: null, hidden: false });
  const file = (name: string): FileEntry => ({ name, type: 'file', size: null, mtime: null, hidden: false });
  const children: Record<string, FileEntry[]> = { docs: [file('a.md'), dir('sub')], 'docs/sub': [file('b.md')], closed: [file('x.md')] };
  // `closed` has loaded children but is collapsed, so childrenOf skips it.
  const items = visibleTreeItems([dir('docs'), dir('closed'), file('c.md')], (path) => (path === 'closed' ? undefined : children[path]));

  it('lists expanded folders depth-first in render order', () => {
    expect(items.map((item) => item.path)).toEqual(['docs', 'docs/a.md', 'docs/sub', 'docs/sub/b.md', 'closed', 'c.md']);
  });

  it('selects the rows between anchor and target in either direction', () => {
    expect(treeRange(items, 'docs/a.md', 'closed').map((item) => item.path)).toEqual(['docs/a.md', 'docs/sub', 'docs/sub/b.md', 'closed']);
    expect(treeRange(items, 'c.md', 'docs/sub').map((item) => item.path)).toEqual(['docs/sub', 'docs/sub/b.md', 'closed', 'c.md']);
  });

  it('falls back to the clicked row when the anchor is not visible', () => {
    expect(treeRange(items, 'closed/x.md', 'c.md').map((item) => item.path)).toEqual(['c.md']);
    expect(treeRange(items, null, 'c.md').map((item) => item.path)).toEqual(['c.md']);
    expect(treeRange(items, 'c.md', 'missing.md')).toEqual([]);
  });
});

describe('resolveVaultRelative', () => {
  it('resolves against the document directory', () => {
    expect(resolveVaultRelative('docs/guide/intro.md', './img/a.png')).toBe('docs/guide/img/a.png');
    expect(resolveVaultRelative('docs/guide/intro.md', 'a.png')).toBe('docs/guide/a.png');
  });

  it('normalizes .. and backslashes', () => {
    expect(resolveVaultRelative('docs/guide/intro.md', '../assets/a.png')).toBe('docs/assets/a.png');
    expect(resolveVaultRelative('docs/intro.md', '..\\a.png')).toBe('a.png');
  });

  it('treats a leading slash as project root', () => {
    expect(resolveVaultRelative('_posts/2026-09-14-gpu.md', '/assets/images/a.svg')).toBe('assets/images/a.svg');
    expect(resolveVaultRelative('docs/guide/intro.md', '/a.png')).toBe('a.png');
  });

  it('handles root-level documents and null base', () => {
    expect(resolveVaultRelative('README.md', './a.png')).toBe('a.png');
    expect(resolveVaultRelative(null, 'img/a.png')).toBe('img/a.png');
  });

  it('strips fragment/query and decodes URI escapes', () => {
    expect(resolveVaultRelative('docs/intro.md', 'a.png?v=1#top')).toBe('docs/a.png');
    expect(resolveVaultRelative('docs/intro.md', '%EC%9D%B4%EB%AF%B8%EC%A7%80.png')).toBe('docs/이미지.png');
  });

  it('returns empty string when nothing remains', () => {
    expect(resolveVaultRelative('docs/intro.md', '#section')).toBe('');
    expect(resolveVaultRelative('docs/intro.md', '../../..')).toBe('');
  });
});
