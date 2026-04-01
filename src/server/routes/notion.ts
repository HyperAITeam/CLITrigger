import { Router, type Request, type Response } from 'express';
import { getProjectById } from '../db/queries.js';
import { validatePromptContent, MAX_DESCRIPTION_LENGTH } from '../services/prompt-guard.js';

const router = Router();

interface NotionConfig {
  apiKey: string;
  databaseId: string;
}

type PidReq = Request<{ projectId: string }>;
type PidPageReq = Request<{ projectId: string; pageId: string }>;

function getNotionConfig(projectId: string): NotionConfig | null {
  const project = getProjectById(projectId);
  if (!project || !project.notion_enabled || !project.notion_api_key || !project.notion_database_id) {
    return null;
  }
  return {
    apiKey: project.notion_api_key,
    databaseId: project.notion_database_id,
  };
}

function notionHeaders(config: NotionConfig): Record<string, string> {
  return {
    'Authorization': `Bearer ${config.apiKey}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };
}

async function notionFetch(config: NotionConfig, path: string, options: RequestInit = {}): Promise<globalThis.Response> {
  const url = `https://api.notion.com/v1${path}`;
  return fetch(url, {
    ...options,
    headers: {
      ...notionHeaders(config),
      ...(options.headers as Record<string, string> || {}),
    },
  });
}

// Test connection
router.get('/:projectId/test', async (req: PidReq, res: Response) => {
  const config = getNotionConfig(req.params.projectId);
  if (!config) {
    res.status(400).json({ error: 'Notion not configured for this project' });
    return;
  }

  try {
    const resp = await notionFetch(config, '/users/me');
    if (!resp.ok) {
      const text = await resp.text();
      res.status(resp.status).json({ error: text });
      return;
    }
    const data = await resp.json();
    res.json({ ok: true, name: data.name || data.bot?.owner?.user?.name || 'Notion Bot', type: data.type });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Query database pages (list items)
router.post('/:projectId/pages', async (req: PidReq, res: Response) => {
  const config = getNotionConfig(req.params.projectId);
  if (!config) {
    res.status(400).json({ error: 'Notion not configured for this project' });
    return;
  }

  try {
    const { startCursor, filter, search } = req.body || {};

    const body: Record<string, unknown> = {
      page_size: 20,
    };

    if (startCursor) {
      body.start_cursor = startCursor;
    }

    if (filter) {
      body.filter = filter;
    } else if (search) {
      body.filter = {
        property: 'title',
        title: { contains: search },
      };
    }

    body.sorts = [{ timestamp: 'last_edited_time', direction: 'descending' }];

    const resp = await notionFetch(config, `/databases/${config.databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
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

// Get single page
router.get('/:projectId/page/:pageId', async (req: PidPageReq, res: Response) => {
  const config = getNotionConfig(req.params.projectId);
  if (!config) {
    res.status(400).json({ error: 'Notion not configured for this project' });
    return;
  }

  try {
    const resp = await notionFetch(config, `/pages/${req.params.pageId}`);
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

// Get page content (blocks)
router.get('/:projectId/page/:pageId/blocks', async (req: PidPageReq, res: Response) => {
  const config = getNotionConfig(req.params.projectId);
  if (!config) {
    res.status(400).json({ error: 'Notion not configured for this project' });
    return;
  }

  try {
    const resp = await notionFetch(config, `/blocks/${req.params.pageId}/children?page_size=100`);
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

// Update page property (e.g. status)
router.post('/:projectId/page/:pageId/update', async (req: PidPageReq, res: Response) => {
  const config = getNotionConfig(req.params.projectId);
  if (!config) {
    res.status(400).json({ error: 'Notion not configured for this project' });
    return;
  }

  try {
    const { properties } = req.body;
    if (!properties) {
      res.status(400).json({ error: 'properties is required' });
      return;
    }

    const resp = await notionFetch(config, `/pages/${req.params.pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
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

// Create page in database
router.post('/:projectId/create', async (req: PidReq, res: Response) => {
  const config = getNotionConfig(req.params.projectId);
  if (!config) {
    res.status(400).json({ error: 'Notion not configured for this project' });
    return;
  }

  try {
    const { title, properties } = req.body;
    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const pageProperties: Record<string, unknown> = {
      ...properties,
    };

    if (!properties?.title) {
      pageProperties.title = {
        title: [{ text: { content: title } }],
      };
    }

    const resp = await notionFetch(config, '/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: config.databaseId },
        properties: pageProperties,
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

// Import page as task
router.post('/:projectId/import/:pageId', async (req: PidPageReq, res: Response) => {
  const config = getNotionConfig(req.params.projectId);
  if (!config) {
    res.status(400).json({ error: 'Notion not configured for this project' });
    return;
  }

  try {
    const pageResp = await notionFetch(config, `/pages/${req.params.pageId}`);
    if (!pageResp.ok) {
      const text = await pageResp.text();
      res.status(pageResp.status).json({ error: text });
      return;
    }
    const page = await pageResp.json();

    const blocksResp = await notionFetch(config, `/blocks/${req.params.pageId}/children?page_size=100`);
    let description = '';
    if (blocksResp.ok) {
      const blocksData = await blocksResp.json();
      description = extractBlocksText(blocksData.results || []);
    }

    const title = extractPageTitle(page);
    const validation = validatePromptContent(description, MAX_DESCRIPTION_LENGTH);
    if (!validation.valid) {
      console.warn(`[prompt-guard] Notion import ${req.params.pageId}: ${validation.warnings.join('; ')}`);
    }
    res.json({ title, description: validation.sanitized, pageId: req.params.pageId, warnings: validation.warnings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get database schema (properties)
router.get('/:projectId/schema', async (req: PidReq, res: Response) => {
  const config = getNotionConfig(req.params.projectId);
  if (!config) {
    res.status(400).json({ error: 'Notion not configured for this project' });
    return;
  }

  try {
    const resp = await notionFetch(config, `/databases/${config.databaseId}`);
    if (!resp.ok) {
      const text = await resp.text();
      res.status(resp.status).json({ error: text });
      return;
    }
    const data = await resp.json();
    res.json({
      title: extractRichText(data.title || []),
      properties: data.properties,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function extractPageTitle(page: any): string {
  if (!page.properties) return 'Untitled';
  for (const prop of Object.values(page.properties) as any[]) {
    if (prop.type === 'title' && prop.title?.length > 0) {
      return extractRichText(prop.title);
    }
  }
  return 'Untitled';
}

function extractRichText(richText: any[]): string {
  return richText.map((t: any) => t.plain_text || t.text?.content || '').join('');
}

function extractBlocksText(blocks: any[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const type = block.type;
    if (!type) continue;

    const content = block[type];
    if (!content) continue;

    if (content.rich_text) {
      const text = extractRichText(content.rich_text);
      if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') {
        lines.push(`# ${text}`);
      } else if (type === 'bulleted_list_item') {
        lines.push(`- ${text}`);
      } else if (type === 'numbered_list_item') {
        lines.push(`1. ${text}`);
      } else if (type === 'to_do') {
        const checked = content.checked ? 'x' : ' ';
        lines.push(`- [${checked}] ${text}`);
      } else if (type === 'code') {
        lines.push(`\`\`\`\n${text}\n\`\`\``);
      } else {
        lines.push(text);
      }
    } else if (type === 'divider') {
      lines.push('---');
    }
  }
  return lines.join('\n');
}

export default router;
