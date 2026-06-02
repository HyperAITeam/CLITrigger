// Minimal Jira Cloud REST client used by the global agenda integration.
// Mirrors the auth/fetch approach of the per-project Jira plugin
// (src/server/plugins/jira/router.ts) but takes an explicit connection so it
// can be driven by the agenda's own global config.

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
  return fetch(`${normalizeBaseUrl(conn.baseUrl)}${path}`, { headers: headers(conn) });
}

export async function jiraMyself(conn: JiraConn): Promise<{ displayName: string; emailAddress?: string }> {
  const resp = await jiraFetch(conn, '/rest/api/3/myself');
  if (!resp.ok) throw new Error(`Jira ${resp.status}: ${await resp.text()}`);
  return resp.json() as Promise<{ displayName: string; emailAddress?: string }>;
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
