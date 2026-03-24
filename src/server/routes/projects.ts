import { Router, Request, Response } from 'express';
import { createProject, getAllProjects, getProjectById, deleteProject } from '../db/queries.js';

const router = Router();

// POST /api/projects - create project
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, path, default_branch } = req.body;
    if (!name || !path) {
      res.status(400).json({ error: 'name and path are required' });
      return;
    }
    const project = createProject(name, path, default_branch);
    res.status(201).json(project);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'A project with this path already exists' });
      return;
    }
    res.status(500).json({ error: message });
  }
});

// GET /api/projects - list all projects
router.get('/', (_req: Request, res: Response) => {
  try {
    const projects = getAllProjects();
    res.json(projects);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id - get project by id
router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json(project);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/projects/:id - delete project
router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const deleted = deleteProject(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.status(204).send();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
