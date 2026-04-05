import { Router, Request, Response } from 'express';
import { getProjectById } from '../db/queries.js';
import { debugLogger } from '../services/debug-logger.js';

const router = Router();

// List debug logs for a project
router.get('/projects/:id/debug-logs', (req: Request<{ id: string }>, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const todoId = req.query.todoId as string | undefined;
  const files = debugLogger.listLogs(project.path, todoId);
  res.json({ files });
});

// Read a specific debug log file
router.get('/projects/:id/debug-logs/:filename', (req: Request<{ id: string; filename: string }>, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const content = debugLogger.readLog(project.path, req.params.filename);
  if (content === null) return res.status(404).json({ error: 'Log file not found' });

  res.type('text/plain').send(content);
});

// Delete a specific debug log file
router.delete('/projects/:id/debug-logs/:filename', (req: Request<{ id: string; filename: string }>, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const deleted = debugLogger.deleteLog(project.path, req.params.filename);
  if (!deleted) return res.status(404).json({ error: 'Log file not found' });
  res.json({ ok: true });
});

// Delete all debug logs for a project
router.delete('/projects/:id/debug-logs', (req: Request<{ id: string }>, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const count = debugLogger.deleteAllLogs(project.path);
  res.json({ ok: true, deleted: count });
});

export default router;
