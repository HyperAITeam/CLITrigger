import { Router, Request, Response } from 'express';
import nodePath from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import os from 'os';
import { createProject, getAllProjects, getProjectById, updateProject, deleteProject, syncProjectCliDefaults } from '../db/queries.js';
import { worktreeManager } from '../services/worktree-manager.js';

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

// POST /api/projects/browse - open native OS folder picker dialog
router.post('/browse', (req: Request, res: Response) => {
  const initialDir = req.body.initialPath || '';

  try {
    let selected = '';

    if (process.platform === 'win32') {
      // Write a temp .ps1 script to avoid shell escaping issues
      // Use a hidden topmost Form as owner so the dialog appears in front
      const scriptLines = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$owner = New-Object System.Windows.Forms.Form',
        '$owner.TopMost = $true',
        '$owner.ShowInTaskbar = $false',
        '$owner.WindowState = [System.Windows.Forms.FormWindowState]::Minimized',
        '$owner.Show()',
        '$owner.Hide()',
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
        '$d.ShowNewFolderButton = $true',
      ];
      if (initialDir) {
        scriptLines.push(`$d.SelectedPath = '${initialDir.replace(/'/g, "''")}'`);
      }
      scriptLines.push(
        'if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }',
        '$owner.Dispose()',
      );

      const tmpScript = nodePath.join(os.tmpdir(), `clitrigger-browse-${Date.now()}.ps1`);
      fs.writeFileSync(tmpScript, scriptLines.join('\r\n'), 'utf-8');

      try {
        selected = execFileSync('powershell', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', tmpScript], {
          encoding: 'utf-8',
          timeout: 120000,
          windowsHide: false,
        }).trim();
      } finally {
        try { fs.unlinkSync(tmpScript); } catch { /* ignore */ }
      }
    } else if (process.platform === 'darwin') {
      const script = initialDir
        ? `POSIX path of (choose folder default location "${initialDir}")`
        : 'POSIX path of (choose folder)';
      selected = execFileSync('osascript', ['-e', script], {
        encoding: 'utf-8',
        timeout: 120000,
      }).trim();
    } else {
      // Linux: try zenity, then kdialog
      const args = ['--file-selection', '--directory'];
      if (initialDir) args.push(`--filename=${initialDir}/`);
      try {
        selected = execFileSync('zenity', args, { encoding: 'utf-8', timeout: 120000 }).trim();
      } catch {
        selected = execFileSync('kdialog', ['--getexistingdirectory', initialDir || '~'], {
          encoding: 'utf-8',
          timeout: 120000,
        }).trim();
      }
    }

    if (selected) {
      res.json({ path: selected.replace(/\\/g, '/') });
    } else {
      res.json({ path: null });
    }
  } catch {
    // User cancelled or dialog closed
    res.json({ path: null });
  }
});

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
    const enriched = projects.map((p) => {
      let pathExists = false;
      try {
        pathExists = fs.statSync(p.path).isDirectory();
      } catch { /* path missing */ }
      return { ...p, path_exists: pathExists };
    });
    res.json(enriched);
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

    const { name, path, default_branch, max_concurrent, claude_model, claude_options, cli_tool, gstack_enabled, gstack_skills, jira_enabled, jira_base_url, jira_email, jira_api_token, jira_project_key, cli_fallback_chain, default_max_turns, sandbox_mode, debug_logging, notion_enabled, notion_api_key, notion_database_id, github_enabled, github_token, github_owner, github_repo, use_worktree, show_token_usage } = req.body;
    const project = updateProject(req.params.id, { name, path, default_branch, max_concurrent, claude_model, claude_options, cli_tool, gstack_enabled, gstack_skills, jira_enabled, jira_base_url, jira_email, jira_api_token, jira_project_key, cli_fallback_chain, default_max_turns, sandbox_mode, debug_logging, notion_enabled, notion_api_key, notion_database_id, github_enabled, github_token, github_owner, github_repo, use_worktree, show_token_usage });

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
      if (!resolved.startsWith(worktreeBase + nodePath.sep) && resolved !== worktreeBase) {
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

// GET /api/projects/:id/git-log - get commit history
router.get('/:id/git-log', async (req: Request<{ id: string }>, res: Response) => {
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
      const resolved = nodePath.resolve(worktreePath);
      const worktreeBase = nodePath.resolve(project.path, '.worktrees');
      if (!resolved.startsWith(worktreeBase + nodePath.sep) && resolved !== worktreeBase) {
        res.status(400).json({ error: 'Invalid worktree path' });
        return;
      }
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        res.status(400).json({ error: 'Worktree path does not exist' });
        return;
      }
      targetPath = resolved;
    }

    const skip = parseInt(req.query.skip as string) || 0;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const result = await worktreeManager.getGitLog(targetPath, { skip, limit });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/git-refs - get branches, tags, stashes
router.get('/:id/git-refs', async (req: Request<{ id: string }>, res: Response) => {
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
      const resolved = nodePath.resolve(worktreePath);
      const worktreeBase = nodePath.resolve(project.path, '.worktrees');
      if (!resolved.startsWith(worktreeBase + nodePath.sep) && resolved !== worktreeBase) {
        res.status(400).json({ error: 'Invalid worktree path' });
        return;
      }
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        res.status(400).json({ error: 'Worktree path does not exist' });
        return;
      }
      targetPath = resolved;
    }

    const refs = await worktreeManager.getGitRefs(targetPath);
    res.json(refs);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// --- Git action helpers ---

function getProjectGitPath(req: Request<{ id: string }>, res: Response): string | null {
  const project = getProjectById(req.params.id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return null; }
  if (!project.is_git_repo) { res.status(400).json({ error: 'Not a git repository' }); return null; }
  return project.path;
}

// POST /api/projects/:id/git-stage
router.post('/:id/git-stage', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { files } = req.body;
    if (!files || !Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'files array is required' }); return;
    }
    await worktreeManager.gitStage(dirPath, files);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-unstage
router.post('/:id/git-unstage', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { files } = req.body;
    if (!files || !Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'files array is required' }); return;
    }
    await worktreeManager.gitUnstage(dirPath, files);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-commit
router.post('/:id/git-commit', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { message } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required' }); return;
    }
    const commit = await worktreeManager.gitCommit(dirPath, message.trim());
    res.json({ ok: true, commit });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-pull
router.post('/:id/git-pull', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { remote, branch } = req.body;
    const summary = await worktreeManager.gitPull(dirPath, remote, branch);
    res.json({ ok: true, summary });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-push
router.post('/:id/git-push', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { remote, branch, setUpstream } = req.body;
    await worktreeManager.gitPush(dirPath, remote, branch, setUpstream);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-fetch
router.post('/:id/git-fetch', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { remote, prune } = req.body;
    await worktreeManager.gitFetch(dirPath, remote, prune);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-branch
router.post('/:id/git-branch', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { name, startPoint } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' }); return;
    }
    await worktreeManager.gitCreateBranch(dirPath, name.trim(), startPoint);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-branch-delete
router.post('/:id/git-branch-delete', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { name, force } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' }); return;
    }
    await worktreeManager.gitDeleteBranch(dirPath, name.trim(), !!force);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-checkout
router.post('/:id/git-checkout', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { branch } = req.body;
    if (!branch || typeof branch !== 'string') {
      res.status(400).json({ error: 'branch is required' }); return;
    }
    await worktreeManager.gitCheckout(dirPath, branch.trim());
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-merge
router.post('/:id/git-merge', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { branch } = req.body;
    if (!branch || typeof branch !== 'string') {
      res.status(400).json({ error: 'branch is required' }); return;
    }
    const result = await worktreeManager.gitMerge(dirPath, branch.trim());
    res.json({ ok: true, result });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-stash
router.post('/:id/git-stash', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { message } = req.body;
    await worktreeManager.gitStashPush(dirPath, message);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-stash-pop
router.post('/:id/git-stash-pop', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { index } = req.body;
    await worktreeManager.gitStashPop(dirPath, index ?? 0);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/projects/:id/git-stash-list
router.get('/:id/git-stash-list', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const stashes = await worktreeManager.gitStashList(dirPath);
    res.json(stashes);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-discard
router.post('/:id/git-discard', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { files, all } = req.body;
    if (all) {
      await worktreeManager.gitDiscardAll(dirPath);
    } else if (files && Array.isArray(files) && files.length > 0) {
      await worktreeManager.gitDiscard(dirPath, files);
    } else {
      res.status(400).json({ error: 'files array or all flag is required' }); return;
    }
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-tag
router.post('/:id/git-tag', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { name, message, commit } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' }); return;
    }
    await worktreeManager.gitCreateTag(dirPath, name.trim(), message, commit);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-tag-delete
router.post('/:id/git-tag-delete', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' }); return;
    }
    await worktreeManager.gitDeleteTag(dirPath, name.trim());
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/projects/:id/git-diff
router.get('/:id/git-diff', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const file = req.query.file as string | undefined;
    const staged = req.query.staged === 'true';
    const diff = await worktreeManager.gitDiff(dirPath, file, staged);
    res.json({ diff });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
