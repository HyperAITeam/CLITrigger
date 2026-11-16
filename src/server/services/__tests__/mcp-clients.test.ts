import { describe, it, expect } from 'vitest';
import TOML from '@iarna/toml';
import { replaceCodexServer } from '../mcp-clients.js';

const BLOCK = '[mcp_servers.clitrigger]\nurl = "http://127.0.0.1:3737/mcp"\nhttp_headers = { Authorization = "Bearer abc" }';

const EXISTING = [
  '# my codex config',
  'model = "gpt-5"',
  '',
  '[mcp_servers.clitrigger]',
  'url = "http://127.0.0.1:1111/mcp"',
  '',
  '[mcp_servers.clitrigger.http_headers]',
  'Authorization = "Bearer old"',
  '',
  '[mcp_servers.unityMCP] # keep me',
  'url = "http://127.0.0.1:8080/mcp"',
  '',
].join('\n');

describe('replaceCodexServer', () => {
  it('replaces the clitrigger table and its sub-tables, keeping everything else', () => {
    const next = replaceCodexServer(EXISTING, BLOCK);
    const parsed = TOML.parse(next) as any;
    expect(parsed.mcp_servers.clitrigger).toEqual({
      url: 'http://127.0.0.1:3737/mcp',
      http_headers: { Authorization: 'Bearer abc' },
    });
    expect(parsed.mcp_servers.unityMCP.url).toBe('http://127.0.0.1:8080/mcp');
    expect(next).toContain('# my codex config');
    expect(next).toContain('[mcp_servers.unityMCP] # keep me');
    expect(next).not.toContain('Bearer old');
  });

  it('removes the table when the block is empty', () => {
    const parsed = TOML.parse(replaceCodexServer(EXISTING, '')) as any;
    expect(Object.keys(parsed.mcp_servers)).toEqual(['unityMCP']);
  });

  it('starts from an empty file and keeps CRLF files CRLF', () => {
    expect(replaceCodexServer('', BLOCK)).toBe(`${BLOCK}\n`);
    expect(replaceCodexServer('', '')).toBe('');
    const crlf = replaceCodexServer('model = "gpt-5"\r\n', BLOCK);
    expect(crlf.split('\r\n').length).toBe(crlf.split('\n').length);
  });
});
