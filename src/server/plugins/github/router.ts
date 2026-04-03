import { Router, type Request, type Response } from 'express';
import type { PluginHelpers } from '../types.js';
import { validatePromptContent, MAX_DESCRIPTION_LENGTH } from '../../services/prompt-guard.js';

interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
}

type PidReq = Request<{ projectId: string }>;
type PidNumReq = Request<{ projectId: string; number: string }>;

function resolveConfig(helpers: PluginHelpers, projectId: string): GitHubConfig | null {
  const config = helpers.getConfig(projectId);
  if (!config || config.enabled !== '1' || !config.token || !config.owner || !config.repo) {
    return null;
  }
  return {
    token: config.token,
    owner: config.owner,
    repo: config.repo,
  };
}

function ghHeaders(config: GitHubConfig): Record<string, string> {
  return {
    'Authorization': `Bearer ${config.token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function ghFetch(config: GitHubConfig, path: string, options: RequestInit = {}): Promise<globalThis.Response> {
  const url = `https://api.github.com${path}`;
  return fetch(url, {
    ...options,
    headers: {
      ...ghHeaders(config),
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
      res.status(400).json({ error: 'GitHub not configured for this project' });
      return;
    }

    try {
      const resp = await ghFetch(config, `/repos/${config.owner}/${config.repo}`);
      if (!resp.ok) {
        const text = await resp.text();
        res.status(resp.status).json({ error: text });
        return;
      }
      const data = await resp.json();
      res.json({ ok: true, name: data.full_name, private: data.private });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // List issues
  router.get('/:projectId/issues', async (req: PidReq, res: Response) => {
    const config = resolveConfig(helpers, req.params.projectId);
    if (!config) {
      res.status(400).json({ error: 'GitHub not configured for this project' });
      return;
    }

    try {
      const { state = 'open', page = '1', per_page = '20', labels, search } = req.query as Record<string, string>;

      if (search) {
        const q = `repo:${config.owner}/${config.repo} is:issue ${search}`;
        const resp = await ghFetch(config, `/search/issues?q=${encodeURIComponent(q)}&page=${page}&per_page=${per_page}`);
        if (!resp.ok) {
          const text = await resp.text();
          res.status(resp.status).json({ error: text });
          return;
        }
        const data = await resp.json();
        res.json({ items: data.items, total_count: data.total_count });
        return;
      }

      let url = `/repos/${config.owner}/${config.repo}/issues?state=${state}&page=${page}&per_page=${per_page}&sort=updated&direction=desc`;
      if (labels) {
        url += `&labels=${encodeURIComponent(labels)}`;
      }

      const resp = await ghFetch(config, url);
      if (!resp.ok) {
        const text = await resp.text();
        res.status(resp.status).json({ error: text });
        return;
      }
      const data = await resp.json();
      const issues = data.filter((item: any) => !item.pull_request);
      res.json({ items: issues, total_count: issues.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single issue
  router.get('/:projectId/issue/:number', async (req: PidNumReq, res: Response) => {
    const config = resolveConfig(helpers, req.params.projectId);
    if (!config) {
      res.status(400).json({ error: 'GitHub not configured for this project' });
      return;
    }

    try {
      const resp = await ghFetch(config, `/repos/${config.owner}/${config.repo}/issues/${req.params.number}`);
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

  // Get issue comments
  router.get('/:projectId/issue/:number/comments', async (req: PidNumReq, res: Response) => {
    const config = resolveConfig(helpers, req.params.projectId);
    if (!config) {
      res.status(400).json({ error: 'GitHub not configured for this project' });
      return;
    }

    try {
      const resp = await ghFetch(config, `/repos/${config.owner}/${config.repo}/issues/${req.params.number}/comments`);
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
      res.status(400).json({ error: 'GitHub not configured for this project' });
      return;
    }

    try {
      const { title, body, labels } = req.body;
      if (!title) {
        res.status(400).json({ error: 'title is required' });
        return;
      }

      const payload: Record<string, unknown> = { title };
      if (body) payload.body = body;
      if (labels) payload.labels = labels;

      const resp = await ghFetch(config, `/repos/${config.owner}/${config.repo}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

  // Add comment to issue
  router.post('/:projectId/issue/:number/comment', async (req: PidNumReq, res: Response) => {
    const config = resolveConfig(helpers, req.params.projectId);
    if (!config) {
      res.status(400).json({ error: 'GitHub not configured for this project' });
      return;
    }

    try {
      const { body } = req.body;
      if (!body) {
        res.status(400).json({ error: 'body is required' });
        return;
      }

      const resp = await ghFetch(config, `/repos/${config.owner}/${config.repo}/issues/${req.params.number}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
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
  router.post('/:projectId/import/:number', async (req: PidNumReq, res: Response) => {
    const config = resolveConfig(helpers, req.params.projectId);
    if (!config) {
      res.status(400).json({ error: 'GitHub not configured for this project' });
      return;
    }

    try {
      const resp = await ghFetch(config, `/repos/${config.owner}/${config.repo}/issues/${req.params.number}`);
      if (!resp.ok) {
        const text = await resp.text();
        res.status(resp.status).json({ error: text });
        return;
      }
      const issue = await resp.json();
      const title = `#${issue.number} ${issue.title}`;
      const description = issue.body || '';
      const validation = validatePromptContent(description, MAX_DESCRIPTION_LENGTH);
      if (!validation.valid) {
        console.warn(`[prompt-guard] GitHub import #${issue.number}: ${validation.warnings.join('; ')}`);
      }
      res.json({ title, description: validation.sanitized, number: issue.number, warnings: validation.warnings });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get labels
  router.get('/:projectId/labels', async (req: PidReq, res: Response) => {
    const config = resolveConfig(helpers, req.params.projectId);
    if (!config) {
      res.status(400).json({ error: 'GitHub not configured for this project' });
      return;
    }

    try {
      const resp = await ghFetch(config, `/repos/${config.owner}/${config.repo}/labels?per_page=100`);
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

  return router;
}
