import { describe, expect, it } from 'vitest';
import { normalizeUrl } from './WebPanel';

describe('normalizeUrl', () => {
  it('turns local paths into file URLs', () => {
    expect(normalizeUrl('C:\\Users\\me\\내 문서\\index.html')).toBe('file:///C:/Users/me/%EB%82%B4%20%EB%AC%B8%EC%84%9C/index.html');
    expect(normalizeUrl('F:/site/a#b.html')).toBe('file:///F:/site/a%23b.html');
    expect(normalizeUrl('\\\\server\\share\\x.html')).toBe('file://server/share/x.html');
    expect(normalizeUrl('/home/me/x.html')).toBe('file:///home/me/x.html');
  });

  it('keeps explicit schemes and uses http for local dev servers', () => {
    expect(normalizeUrl('file:///C:/x.html')).toBe('file:///C:/x.html');
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeUrl('localhost:5173/app')).toBe('http://localhost:5173/app');
    expect(normalizeUrl('127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(normalizeUrl('example.com')).toBe('https://example.com');
  });
});
