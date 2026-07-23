// Minimal Jira Cloud REST client used by the global "My Schedule" agenda
// integration. Takes an explicit connection so it can be driven by the
// agenda's own global config (stored in app_settings).

import { assertPublicHttpUrl } from '../utils/net-safety.js';

export interface JiraConn {
  baseUrl: string; // e.g. https://xxx.atlassian.net (no trailing slash)
  email: string;
  apiToken: string;
}

function headers(conn: JiraConn): Record<string, string> {
  const auth = Buffer.from(`${conn.email}:${conn.apiToken}`).toString('base64');
  return {
    Authorization: `Basic ${auth}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '');
}

async function jiraFetch(conn: JiraConn, path: string): Promise<globalThis.Response> {
  const base = normalizeBaseUrl(conn.baseUrl);
  assertPublicHttpUrl(base);
  return fetch(`${base}${path}`, { headers: headers(conn) });
}

export async function jiraMyself(conn: JiraConn): Promise<{ displayName: string; emailAddress?: string }> {
  const resp = await jiraFetch(conn, '/rest/api/3/myself');
  if (!resp.ok) throw new Error(`Jira ${resp.status}: ${await resp.text()}`);
  return resp.json() as Promise<{ displayName: string; emailAddress?: string }>;
}

export interface JiraStatus {
  name: string;
  category: string; // statusCategory display name, e.g. "To Do" / "In Progress" / "Done"
}

// All workflow statuses on the instance, deduped by name. The global endpoint
// returns one entry per (status × workflow) so the same name repeats heavily on
// instances with many projects — callers get a flat, name-unique list.
export async function jiraStatuses(conn: JiraConn): Promise<JiraStatus[]> {
  const resp = await jiraFetch(conn, '/rest/api/3/status');
  if (!resp.ok) throw new Error(`Jira ${resp.status}: ${await resp.text()}`);
  const raw = (await resp.json()) as Array<{ name?: string; statusCategory?: { name?: string } }>;
  const seen = new Map<string, JiraStatus>();
  for (const s of raw) {
    if (s?.name && !seen.has(s.name)) {
      seen.set(s.name, { name: s.name, category: s.statusCategory?.name || '' });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface JiraSearchResult {
  issues: Array<{ key: string; fields: Record<string, unknown> }>;
  total: number;
}

export async function jiraSearch(conn: JiraConn, jql: string, fields: string, maxResults = 100): Promise<JiraSearchResult> {
  const params = new URLSearchParams({ jql, fields, maxResults: String(maxResults) });
  // Jira Cloud removed the legacy GET /rest/api/3/search; the enhanced
  // /search/jql endpoint replaces it. Fall back to the old path only if the
  // new one isn't present (older/self-hosted instances).
  let resp = await jiraFetch(conn, `/rest/api/3/search/jql?${params}`);
  if (resp.status === 404 || resp.status === 410) {
    resp = await jiraFetch(conn, `/rest/api/3/search?${params}`);
  }
  if (!resp.ok) throw new Error(`Jira ${resp.status}: ${await resp.text()}`);
  return resp.json() as Promise<JiraSearchResult>;
}
