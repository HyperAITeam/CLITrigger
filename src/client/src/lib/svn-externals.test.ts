import { describe, expect, it } from 'vitest';
import { parseExternals, parseExternalsLine, serializeExternals } from './svn-externals';

describe('svn-externals', () => {
  it('parses new format with peg', () => {
    expect(parseExternalsLine('https://h/svn/GFRender@29054 Assets/GFRender')).toEqual({
      kind: 'entry',
      entry: { path: 'Assets/GFRender', url: 'https://h/svn/GFRender', peg: '29054', operative: '' },
    });
  });

  it('parses operative revision, attached or separate, and relative URLs', () => {
    expect(parseExternalsLine('-r120 ^/lib/foo vendor/foo')).toMatchObject({
      entry: { path: 'vendor/foo', url: '^/lib/foo', peg: '', operative: '120' },
    });
    expect(parseExternalsLine('-r 120 ../sibling@130 vendor/foo')).toMatchObject({
      entry: { path: 'vendor/foo', url: '../sibling', peg: '130', operative: '120' },
    });
  });

  it('parses legacy path-first format and quoted paths', () => {
    expect(parseExternalsLine('third-party/skins -r148 http://svn.example.com/skinproj')).toMatchObject({
      entry: { path: 'third-party/skins', url: 'http://svn.example.com/skinproj', peg: '', operative: '148' },
    });
    expect(parseExternalsLine('http://h/a@5 "My Dir"')).toMatchObject({
      entry: { path: 'My Dir', peg: '5' },
    });
  });

  it('keeps comments and blanks verbatim and round-trips', () => {
    const value = '# pinned libs\nhttps://h/a@5 libs/a\n\n-r7 https://h/b libs/b';
    const lines = parseExternals(value);
    expect(lines[0]).toEqual({ kind: 'raw', text: '# pinned libs' });
    expect(lines[2]).toEqual({ kind: 'raw', text: '' });
    expect(serializeExternals(lines)).toBe(value);
  });

  it('treats HEAD as unpinned and quotes paths with spaces on output', () => {
    const lines = parseExternals('https://h/a@HEAD "some dir"');
    expect(lines[0]).toMatchObject({ entry: { peg: '', path: 'some dir' } });
    expect(serializeExternals(lines)).toBe('https://h/a "some dir"');
  });
});
