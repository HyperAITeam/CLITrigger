import { Router, type Request, type Response } from 'express';
import type { PluginHelpers } from '../types.js';
import { validatePromptContent, MAX_DESCRIPTION_LENGTH } from '../../services/prompt-guard.js';

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

type PidReq = Request<{ projectId: string }>;
type PidIssueReq = Request<{ projectId: string; issueKey: string }>;

function resolveConfig(helpers: PluginHelpers, projectId: string): JiraConfig | null {
  const config = helpers.getConfig(projectId);
  if (!config || config.enabled !== '1' || !config.base_url || !config.email || !config.api_token) {
    return null;
  }
  return {
    baseUrl: config.base_url.replace(/\/+$/, ''),
    email: config.email,
    apiToken: config.api_token,
    projectKey: config.project_key || '',
  };
}

function jiraHeaders(config: JiraConfig): Record<string, string> {
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  return {
    'Authorization': `Basic ${auth}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
}

async function jiraFetch(config: JiraConfig, path: string, options: RequestInit = {}): Promise<globalThis.Response> {
  const url = `${config.baseUrl}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      ...jiraHeaders(config),
      ...(options.headers as Record<string, string> || {}),
    },
  });
}

export function createRouter(helpers: PluginHelpers): Router {
  const router = Router();

  // Test connection
  router.get('/:projectId/test', async (req: PidReq, res: Response) => {
    const config = resolveConfig(helpers, req.params.projectId);
    if (!config) {
      res.status(400).json({ error: 'Jira not configured for this project' });
      return;
    }

    try {
      const resp = await jiraFetch(config, '/rest/api/3/myself');
      if (!resp.ok) {
        const text = await resp.text();
        res.status(resp.status).json({ error: text });
        return;
      }
      const data = await resp.json();
      res.json({ ok: true, user: data.displayName, email: data.emailAddress });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // List issues (with JQL search)
  router.get('/:projectId/issues', async (req: PidReq, res: Response) => {
    const config = resolveConfig(helpers, req.params.projectId);
    if (!config) {
      res.status(400).json({ error: 'Jira not configured for this project' });
      return;
    }

    try {
      const status = req.query.status as string | undefined;
      const search = req.query.search as string | undefined;
      const maxResults = parseInt(req.query.maxResults as string || '50', 10);
      const startAt = parseInt(req.query.startAt as string || '0', 10);

      let jql = config.projectKey ? `project = "${config.projectKey}"` : '';

      if (status && status !== 'all') {
        const statusClause = `status = "${status}"`;
        jql = jql ? `${jql} AND ${statusClause}` : statusClause;
      }

      if (search) {
        const searchClause = `summary ~ "${search.replace(/"/g, '\\"')}"`;
        jql = jql ? `${jql} AND ${searchClause}` : searchClause;
      }

      if (jql) {
        jql += ' ORDER BY updated DESC';
      } else {
        jql = 'ORDER BY updated DESC';
      }

      const params = new URLSearchParams({
        jql,
        maxResults: String(maxResults),
        startAt: String(startAt),
        fields: 'summary,status,assignee,priority,issuetype,created,updated,labels',
      });

      const resp = await jiraFetch(config, `/rest/api/3/search?${params}`);
      if (!resp.ok) {
        const text = await resp.text();
        res.status(resp.status).json({ error: text });
        return;
      }
      const data = await resp.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single issue
  router.get('/:projectId/issue/:issueKey', async (req: PidIssueReq, res: Response) => {
    const config = resolveConfig(helpers, req.params.projectId);
    if (!config) {
      res.status(400).json({ error: 'Jira not configured for this project' });
      return;
    }

    try {
      const resp = await jiraFetch(config, `/rest/api/3/issue/${encodeURIComponent(req.params.issueKey)}`);
      if (!resp.ok) {
        const text = await resp.text();
        res.status(resp.status).json({ error: text });
        return;
      }
      const data = await resp.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get transitions for an issue
  router.get('/:projectId/issue/:issueKey/transitions', async (req: PidIssueReq, res: Response) => {
    const config = resolveConfig(helpers, req.params.projectId);
    if (!config) {
      res.status(400).json({ error: 'Jira not configured for this project' });
      return;
    }

    try {
      const resp = await jiraFetch(config, `/rest/api/3/issue/${encodeURIComponent(req.params.issueKey)}/transitions`);
      if (!resp.ok) {
        const text = await resp.text();
        res.status(resp.status).json({ error: text });
        return;
      }
      const data = await resp.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Transition issue (change status)
  router.post('/:projectId/issue/:issueKey/transition', async (req: PidIssueReq, res: Response) => {
    const config = resolveConfig(helpers, req.params.projectId);
    if (!config) {
      res.status(400).json({ error: 'Jira not configured for this project' });
      return;
    }

    try {
      const { transitionId } = req.body;
      if (!transitionId) {
        res.status(400).json({ error: 'transitionId is required' });
        return;
      }

      const resp = await jiraFetch(config, `/rest/api/3/issue/${encodeURIComponent(req.params.issueKey)}/transitions`, {
        method: 'POST',
        body: JSON.stringify({ transition: { id: transitionId } }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        res.status(resp.status).json({ error: text });
        return;
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Add comment to issue
  router.post('/:projectId/issue/:issueKey/comment', async (req: PidIssueReq, res: Response) => {
    const config = resolveConfig(helpers, req.params.projectId);
    if (!config) {
      res.status(400).json({ error: 'Jira not configured for this project' });
      return;
    }

    try {
      const { body: commentBody } = req.body;
      if (!commentBody) {
        res.status(400).json({ error: 'body is required' });
        return;
      }

      const resp = await jiraFetch(config, `/rest/api/3/issue/${encodeURIComponent(req.params.issueKey)}/comment`, {
        method: 'POST',
        body: JSON.stringify({
          body: {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: commentBody }] }],
          },
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        res.status(resp.status).json({ error: text });
        return;
      }
      const data = await resp.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create issue
  router.post('/:projectId/issues', async (req: PidReq, res: Response) => {
    const config = resolveConfig(helpers, req.params.projectId);
    if (!config) {
      res.status(400).json({ error: 'Jira not configured for this project' });
      return;
    }

    try {
      const { summary, description, issueType } = req.body;
      if (!summary) {
        res.status(400).json({ error: 'summary is required' });
        return;
      }

      const fields: Record<string, unknown> = {
        project: { key: config.projectKey },
        summary,
        issuetype: { name: issueType || 'Task' },
      };

      if (description) {
        fields.description = {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }],
        };
      }

      const resp = await jiraFetch(config, '/rest/api/3/issue', {
        method: 'POST',
        body: JSON.stringify({ fields }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        res.status(resp.status).json({ error: text });
        return;
      }
      const data = await resp.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Import issue as task
  router.post('/:projectId/import/:issueKey', async (req: PidIssueReq, res: Response) => {
    const config = resolveConfig(helpers, req.params.projectId);
    if (!config) {
      res.status(400).json({ error: 'Jira not configured for this project' });
      return;
    }

    try {
      const resp = await jiraFetch(config, `/rest/api/3/issue/${encodeURIComponent(req.params.issueKey)}`);
      if (!resp.ok) {
        const text = await resp.text();
        res.status(resp.status).json({ error: text });
        return;
      }
      const issue = await resp.json();

      const summary = issue.fields?.summary || req.params.issueKey;
      let description = '';
      if (issue.fields?.description?.content) {
        description = extractAdfText(issue.fields.description.content);
      }

      const title = `[${req.params.issueKey}] ${summary}`;
      const validation = validatePromptContent(description, MAX_DESCRIPTION_LENGTH);
      if (!validation.valid) {
        console.warn(`[prompt-guard] Jira import ${req.params.issueKey}: ${validation.warnings.join('; ')}`);
      }
      res.json({ title, description: validation.sanitized, issueKey: req.params.issueKey, warnings: validation.warnings });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get project statuses (for filter dropdown)
  router.get('/:projectId/statuses', async (req: PidReq, res: Response) => {
    const config = resolveConfig(helpers, req.params.projectId);
    if (!config) {
      res.status(400).json({ error: 'Jira not configured for this project' });
      return;
    }

    try {
      if (!config.projectKey) {
        res.json([]);
        return;
      }
      const resp = await jiraFetch(config, `/rest/api/3/project/${encodeURIComponent(config.projectKey)}/statuses`);
      if (!resp.ok) {
        const text = await resp.text();
        res.status(resp.status).json({ error: text });
        return;
      }
      const data = await resp.json();
      const statuses = new Set<string>();
      for (const issueType of data) {
        for (const s of issueType.statuses || []) {
          statuses.add(s.name);
        }
      }
      res.json([...statuses]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

function extractAdfText(content: any[]): string {
  let text = '';
  for (const node of content) {
    if (node.type === 'text') {
      text += node.text;
    } else if (node.type === 'paragraph' || node.type === 'heading') {
      text += extractAdfText(node.content || []) + '\n';
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      for (const item of node.content || []) {
        text += '- ' + extractAdfText(item.content || []);
      }
    } else if (node.content) {
      text += extractAdfText(node.content);
    }
  }
  return text;
}
