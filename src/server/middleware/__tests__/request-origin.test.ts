process.env.DB_PATH = ':memory:';

import { describe, it, expect, afterEach } from 'vitest';
import type { IncomingMessage } from 'http';

const { isAllowedHost, isAllowedOrigin, isDirectLoopback } = await import('../request-origin.js');

afterEach(() => {
  delete process.env.ALLOWED_HOSTS;
  delete process.env.CORS_ORIGIN;
});

describe('isAllowedHost (DNS rebinding)', () => {
  it('accepts localhost, IP literals (LAN) and listed hosts', () => {
    expect(isAllowedHost('localhost:3000')).toBe(true);
    expect(isAllowedHost('127.0.0.1:3737')).toBe(true);
    expect(isAllowedHost('192.168.0.12:3000')).toBe(true);
    expect(isAllowedHost('[::1]:3000')).toBe(true);
    expect(isAllowedHost(undefined)).toBe(true);
    process.env.ALLOWED_HOSTS = 'my.box.lan';
    expect(isAllowedHost('My.Box.Lan:3000')).toBe(true);
  });

  it('rejects any other domain, e.g. an attacker rebinding to 127.0.0.1', () => {
    expect(isAllowedHost('evil.example:3000')).toBe(false);
    expect(isAllowedHost('127.0.0.1.evil.example')).toBe(false);
    expect(isAllowedHost('localhost.evil.example')).toBe(false);
  });
});

describe('isAllowedOrigin (cross-site requests / WS hijacking)', () => {
  it('allows the page we served and non-browser clients', () => {
    expect(isAllowedOrigin(undefined, 'localhost:3000')).toBe(true);
    expect(isAllowedOrigin('http://localhost:3000', 'localhost:3000')).toBe(true);
    expect(isAllowedOrigin('http://192.168.0.12:3000', '192.168.0.12:3000')).toBe(true);
  });

  it('rejects other origins, including other localhost ports and tunnels', () => {
    expect(isAllowedOrigin('https://evil.example', 'localhost:3000')).toBe(false);
    expect(isAllowedOrigin('http://localhost:5173', 'localhost:3000')).toBe(false);
    expect(isAllowedOrigin('https://x.trycloudflare.com', 'localhost:3000')).toBe(false);
    // Origin matching an attacker Host still fails the Host check.
    expect(isAllowedOrigin('http://evil.example:3000', 'evil.example:3000')).toBe(false);
  });

  it('honours CORS_ORIGIN', () => {
    process.env.CORS_ORIGIN = 'http://localhost:5173';
    expect(isAllowedOrigin('http://localhost:5173', 'localhost:3000')).toBe(true);
  });
});

describe('isDirectLoopback', () => {
  const req = (addr: string, headers: Record<string, string> = {}) =>
    ({ socket: { remoteAddress: addr }, headers } as unknown as IncomingMessage);
  it('only a loopback socket without proxy headers counts', () => {
    expect(isDirectLoopback(req('127.0.0.1'))).toBe(true);
    expect(isDirectLoopback(req('::ffff:127.0.0.1'))).toBe(true);
    expect(isDirectLoopback(req('192.168.0.5'))).toBe(false);
    expect(isDirectLoopback(req('127.0.0.1', { 'cf-connecting-ip': '1.2.3.4' }))).toBe(false);
    expect(isDirectLoopback(req('127.0.0.1', { 'x-forwarded-for': '1.2.3.4' }))).toBe(false);
  });
});
