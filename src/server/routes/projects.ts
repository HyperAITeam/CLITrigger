import { Router, Request, Response } from 'express';
import nodePath from 'path';
import fs from 'fs';
import { createProject, getAllProjects, getProjectById, updateProject, deleteProject, syncProjectCliDefaults } from '../db/queries.js';
import { worktreeManager } from '../services/worktree-manager.js';
import { getAvailableSkills } from '../services/skill-injector.js';

const router = Router();

/**
 * Validate project path: must be absolute, exist, be a directory,
 * and not contain path traversal sequences.
 */
function validateProjectPath(inputPath: string): { valid: boolean; error?: string; resolved?: string } {
  if (!inputPath || typeof inputPath !== 'string') {
    return { valid: false, error: 'Path is required' };
  }

  // Resolve to absolute path
  const resolved = nodePath.resolve(inputPath);

  // Check for path traversal attempts
  if (inputPath.includes('..')) {
    return { valid: false, error: 'Path traversal (..) is not allowed' };
  }

  // Must be an absolute path
  if (!nodePath.isAbsolute(inputPath)) {
    return { valid: false, error: 'Path must be absolute' };
  }

  // Must exist and be a directory
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return { valid: false, error: 'Path must be a directory' };
    }
  } catch {
    return { valid: false, error: 'Path does not exist or is not accessible' };
  }

  return { valid: true, resolved };
}

// POST /api/projects - create project
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, path, default_branch } = req.body;
    if (!name || !path) {
      res.status(400).json({ error: 'name and path are required' });
      return;
    }

    const pathCheck = validateProjectPath(path);
    if (!pathCheck.valid) {
      res.status(400).json({ error: pathCheck.error });
      return;
    }

    const safePath = pathCheck.resolved!;
    const isGitRepo = await worktreeManager.isGitRepository(safePath);
    const project = createProject(name, safePath, default_branch, isGitRepo ? 1 : 0);
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

// PUT /api/projects/:id - update project
router.put('/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const existing = getProjectById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const { name, path, default_branch, max_concurrent, claude_model, claude_options, cli_tool, gstack_enabled, gstack_skills, jira_enabled, jira_base_url, jira_email, jira_api_token, jira_project_key, cli_fallback_chain, default_max_turns, notion_enabled, notion_api_key, notion_database_id, github_enabled, github_token, github_owner, github_repo } = req.body;
    const project = updateProject(req.params.id, { name, path, default_branch, max_concurrent, claude_model, claude_options, cli_tool, gstack_enabled, gstack_skills, jira_enabled, jira_base_url, jira_email, jira_api_token, jira_project_key, cli_fallback_chain, default_max_turns, notion_enabled, notion_api_key, notion_database_id, github_enabled, github_token, github_owner, github_repo });

    const cliChanged =
      (cli_tool !== undefined && cli_tool !== existing.cli_tool) ||
      (claude_model !== undefined && claude_model !== existing.claude_model);

    if (project && cliChanged) {
      syncProjectCliDefaults(
        req.params.id,
        existing.cli_tool ?? null,
        existing.claude_model ?? null,
        project.cli_tool ?? null,
        project.claude_model ?? null
      );
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

// POST /api/projects/:id/check-git - re-check if project path is a git repo
router.post('/:id/check-git', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const existing = getProjectById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const isGitRepo = await worktreeManager.isGitRepository(existing.path);
    const project = updateProject(req.params.id, { is_git_repo: isGitRepo ? 1 : 0 });
    res.json(project);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/git-status - get git status tree
router.get('/:id/git-status', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!project.is_git_repo) {
      res.status(400).json({ error: 'Project is not a git repository' });
      return;
    }

    const worktreePath = req.query.worktreePath as string | undefined;
    let targetPath = project.path;

    if (worktreePath) {
      // Validate worktree path: must be under project's .worktrees directory
      const resolved = nodePath.resolve(worktreePath);
      const worktreeBase = nodePath.resolve(project.path, '.worktrees');
      if (!resolved.startsWith(worktreeBase)) {
        res.status(400).json({ error: 'Invalid worktree path' });
        return;
      }
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        res.status(400).json({ error: 'Worktree path does not exist' });
        return;
      }
      targetPath = resolved;
    }

    const status = await worktreeManager.getGitStatus(targetPath);
    res.json(status);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;

// Separate router for gstack endpoints (mounted at /api/gstack)
export const gstackRouter = Router();

// GET /api/gstack/skills - list available gstack skills
gstackRouter.get('/skills', (_req: Request, res: Response) => {
  res.json(getAvailableSkills());
});
