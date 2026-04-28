import { Router, type Request, type Response } from 'express';
import { getProjectById } from '../../db/queries.js';
import type { PluginHelpers } from '../types.js';
import { claudeHarnessAdapter } from './adapters/claude.js';
import { geminiHarnessAdapter } from './adapters/gemini.js';
import { codexHarnessAdapter } from './adapters/codex.js';
import { HarnessPathError } from './io.js';
import type { CliId, HarnessAdapter, HarnessSettings, McpServer } from './types.js';

const adapters: Record<CliId, HarnessAdapter> = {
  claude: claudeHarnessAdapter,
  gemini: geminiHarnessAdapter,
  codex: codexHarnessAdapter,
};

const CLI_IDS: CliId[] = ['claude', 'gemini', 'codex'];

function resolveProjectPath(projectId: string): string | null {
  const project = getProjectById(projectId);
  if (!project) return null;
  return project.path;
}

function isCliId(value: string): value is CliId {
  return value === 'claude' || value === 'gemini' || value === 'codex';
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof HarnessPathError) {
    res.status(400).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: message });
}

function isMcpServer(value: unknown): value is McpServer {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.alias !== 'string' || !v.alias) return false;
  if (v.transport !== 'stdio' && v.transport !== 'http' && v.transport !== 'sse') return false;
  return true;
}

export function createRouter(_helpers: PluginHelpers): Router {
  const router = Router();

  router.get('/:projectId', async (req: Request<{ projectId: string }>, res: Response) => {
    const projectPath = resolveProjectPath(req.params.projectId);
    if (!projectPath) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    try {
      const entries = await Promise.all(
        CLI_IDS.map(async (cli) => [cli, await adapters[cli].read(projectPath)] as const),
      );
      res.json(Object.fromEntries(entries));
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/:projectId/:cli', async (req: Request<{ projectId: string; cli: string }>, res: Response) => {
    const projectPath = resolveProjectPath(req.params.projectId);
    if (!projectPath) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!isCliId(req.params.cli)) {
      res.status(400).json({ error: 'Invalid cli identifier' });
      return;
    }
    try {
      const snapshot = await adapters[req.params.cli].read(projectPath);
      res.json(snapshot);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.put('/:projectId/:cli/settings', async (req: Request<{ projectId: string; cli: string }>, res: Response) => {
    const projectPath = resolveProjectPath(req.params.projectId);
    if (!projectPath) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!isCliId(req.params.cli)) {
      res.status(400).json({ error: 'Invalid cli identifier' });
      return;
    }
    const body = req.body as Partial<HarnessSettings> | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Body must be a JSON object' });
      return;
    }
    try {
      await adapters[req.params.cli].writeSettings(projectPath, body);
      const snapshot = await adapters[req.params.cli].read(projectPath);
      res.json(snapshot);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/:projectId/:cli/memory', async (req: Request<{ projectId: string; cli: string }>, res: Response) => {
    const projectPath = resolveProjectPath(req.params.projectId);
    if (!projectPath) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!isCliId(req.params.cli)) {
      res.status(400).json({ error: 'Invalid cli identifier' });
      return;
    }
    try {
      const snapshot = await adapters[req.params.cli].read(projectPath);
      res.json({
        path: snapshot.filePaths.memory,
        content: snapshot.memory,
        exists: !!snapshot.memory,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.put('/:projectId/:cli/memory', async (req: Request<{ projectId: string; cli: string }>, res: Response) => {
    const projectPath = resolveProjectPath(req.params.projectId);
    if (!projectPath) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!isCliId(req.params.cli)) {
      res.status(400).json({ error: 'Invalid cli identifier' });
      return;
    }
    const body = req.body as { content?: unknown } | undefined;
    if (!body || typeof body.content !== 'string') {
      res.status(400).json({ error: 'Body must include string "content"' });
      return;
    }
    try {
      await adapters[req.params.cli].writeMemory(projectPath, body.content);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/:projectId/:cli/mcp', async (req: Request<{ projectId: string; cli: string }>, res: Response) => {
    const projectPath = resolveProjectPath(req.params.projectId);
    if (!projectPath) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!isCliId(req.params.cli)) {
      res.status(400).json({ error: 'Invalid cli identifier' });
      return;
    }
    try {
      const snapshot = await adapters[req.params.cli].read(projectPath);
      res.json(snapshot.mcp);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.put('/:projectId/:cli/mcp/:alias', async (req: Request<{ projectId: string; cli: string; alias: string }>, res: Response) => {
    const projectPath = resolveProjectPath(req.params.projectId);
    if (!projectPath) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!isCliId(req.params.cli)) {
      res.status(400).json({ error: 'Invalid cli identifier' });
      return;
    }
    const body = { ...(req.body ?? {}), alias: req.params.alias };
    if (!isMcpServer(body)) {
      res.status(400).json({ error: 'Body is not a valid McpServer' });
      return;
    }
    try {
      await adapters[req.params.cli].upsertMcp(projectPath, body);
      const snapshot = await adapters[req.params.cli].read(projectPath);
      res.json(snapshot.mcp);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.delete('/:projectId/:cli/mcp/:alias', async (req: Request<{ projectId: string; cli: string; alias: string }>, res: Response) => {
    const projectPath = resolveProjectPath(req.params.projectId);
    if (!projectPath) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!isCliId(req.params.cli)) {
      res.status(400).json({ error: 'Invalid cli identifier' });
      return;
    }
    try {
      await adapters[req.params.cli].removeMcp(projectPath, req.params.alias);
      const snapshot = await adapters[req.params.cli].read(projectPath);
      res.json(snapshot.mcp);
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}
