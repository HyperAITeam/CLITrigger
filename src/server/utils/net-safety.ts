// SSRF guard for user-supplied base URLs (e.g. Jira base_url). Requires http(s)
// and blocks loopback / link-local hosts — notably the cloud metadata endpoint
// (169.254.169.254). Private LAN ranges (10./192.168./172.16-31.) are allowed
// so self-hosted/internal Jira still works. Does not defend against DNS
// rebinding (out of scope for a single-user tool).
export function assertPublicHttpUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('URL must use http or https');
  }
  const host = u.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '0.0.0.0' ||
    /^127\./.test(host) ||
    /^169\.254\./.test(host);
  if (blocked) {
    throw new Error('URL host is not allowed');
  }
}
