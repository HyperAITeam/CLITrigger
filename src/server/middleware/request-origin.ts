import net from 'net';
import type { IncomingMessage } from 'http';
import { getSetting } from '../db/app-settings.js';
import { tunnelManager } from '../services/tunnel-manager.js';

// Who may talk to this server. The server drives shells and AI CLIs, so a
// request a web page can forge is code execution on the user's machine.
//
// Host check (DNS rebinding): answer only to localhost, IP literals (LAN
// access keeps working) and the hostnames we actually serve — the tunnel's
// and any listed in ALLOWED_HOSTS. A rebinding attack always arrives with the
// attacker's own domain in Host.
//
// Origin check (cross-site requests / WebSocket hijacking): a browser request
// must come from the page we served (Origin matches Host) or an origin listed
// in CORS_ORIGIN. No Origin = not a browser page (curl, plugins) → allowed.

function hostnameOf(hostHeader: string): string {
  let h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']')); // [::1]:3000
  const colon = h.lastIndexOf(':');
  if (colon !== -1 && h.indexOf(':') === colon) h = h.slice(0, colon); // strip :port (not IPv6)
  return h.replace(/\.$/, '');
}

function listEnv(name: string): string[] {
  return (process.env[name] ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function servedHostnames(): string[] {
  const names = listEnv('ALLOWED_HOSTS');
  const configured = getSetting('tunnel.hostname') ?? process.env.TUNNEL_HOSTNAME;
  if (configured) names.push(configured.trim().toLowerCase());
  const url = tunnelManager.getTunnelStatus().url;
  if (url) {
    try { names.push(new URL(url).hostname.toLowerCase()); } catch { /* ignore */ }
  }
  return names;
}

export function isAllowedHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return true; // HTTP/1.0-style client, not a browser
  const host = hostnameOf(hostHeader);
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (net.isIP(host)) return true;
  return servedHostnames().includes(host);
}

export function isAllowedOrigin(origin: string | undefined, hostHeader: string | undefined): boolean {
  if (!origin) return true;
  if (hostHeader && (origin === `http://${hostHeader}` || origin === `https://${hostHeader}`)) {
    return isAllowedHost(hostHeader);
  }
  return listEnv('CORS_ORIGIN').includes(origin.toLowerCase());
}

/** True for a direct connection from this machine — not via the tunnel or another proxy. */
export function isDirectLoopback(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  const h = req.headers;
  return loopback && !h['x-forwarded-for'] && !h['cf-connecting-ip'] && !h['forwarded'];
}
