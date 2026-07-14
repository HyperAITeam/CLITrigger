import { describe, it, expect } from 'vitest';
import { resolveVaultRelative } from './files-utils';

describe('resolveVaultRelative', () => {
  it('resolves against the document directory', () => {
    expect(resolveVaultRelative('docs/guide/intro.md', './img/a.png')).toBe('docs/guide/img/a.png');
    expect(resolveVaultRelative('docs/guide/intro.md', 'a.png')).toBe('docs/guide/a.png');
  });

  it('normalizes .. and backslashes', () => {
    expect(resolveVaultRelative('docs/guide/intro.md', '../assets/a.png')).toBe('docs/assets/a.png');
    expect(resolveVaultRelative('docs/intro.md', '..\\a.png')).toBe('a.png');
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
