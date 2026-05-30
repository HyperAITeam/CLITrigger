import { describe, it, expect } from 'vitest';
import { parseInlineTags } from './file-scanner.js';

describe('parseInlineTags', () => {
  it('reads inline tags from body', () => {
    expect(parseInlineTags('some #backend note')).toEqual(['backend']);
  });

  it('ignores markdown headings (# + space)', () => {
    expect(parseInlineTags('# 제목\n본문')).toEqual([]);
  });

  it('ignores `#` inside inline and fenced code', () => {
    expect(parseInlineTags('`#include`')).toEqual([]);
    expect(parseInlineTags('```\n#bad\n```')).toEqual([]);
  });

  it('ignores `#` not preceded by whitespace', () => {
    expect(parseInlineTags('example.com#section word#tag')).toEqual([]);
  });

  it('supports nested tags', () => {
    expect(parseInlineTags('#parent/child')).toEqual(['parent/child']);
  });

  it('excludes pure-numeric and supports Korean', () => {
    expect(parseInlineTags('#123')).toEqual([]);
    expect(parseInlineTags('#백엔드')).toEqual(['백엔드']);
  });

  it('dedupes repeated tags', () => {
    expect(parseInlineTags('text #a #a')).toEqual(['a']);
  });
});
