import { Router, Request, Response } from 'express';
import simpleGit from 'simple-git';
import { getTodosByProjectId, getTodoById, updateTodoStatus, updateTodo, deleteTaskLogsByTodoId } from '../db/queries.js';
import { getProjectById } from '../db/queries.js';
import { orchestrator } from '../services/orchestrator.js';
import { worktreeManager } from '../services/worktree-manager.js';
import { supportsInteractiveMode, type CliTool } from '../services/cli-adapters.js';

const router = Router();

// POST /api/projects/:id/start - start all pending todos for project
router.post('/projects/:id/start', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await orchestrator.startProject(req.params.id);

    // Re-fetch todos to return current state
    const todos = getTodosByProjectId(req.params.id);
    const running = todos.filter(t => t.status === 'running');
    res.json({ started: running.length, todos: running });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/projects/:id/stop - stop all running todos for project
router.post('/projects/:id/stop', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await orchestrator.stopProject(req.params.id);

    // Re-fetch todos to return current state
    const todos = getTodosByProjectId(req.params.id);
    const stopped = todos.filter(t => t.status === 'stopped');
    res.json({ stopped: stopped.length, todos: stopped });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/todos/:id/start - start single todo
router.post('/todos/:id/start', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    const validModes = ['headless', 'interactive', 'verbose'] as const;
    const mode = validModes.includes(req.body.mode) ? req.body.mode : 'headless';
    const project = getProjectById(todo.project_id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const cliTool = ((todo.cli_tool || project.cli_tool || 'claude') as CliTool);
    if (mode === 'interactive' && !supportsInteractiveMode(cliTool)) {
      res.status(400).json({ error: `${cliTool} does not support interactive mode in CLITrigger. Use headless or verbose mode.` });
      return;
    }

    await orchestrator.startTodo(todo.id, mode);

    // Re-fetch to return current state
    const updated = getTodoById(todo.id);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/todos/:id/stop - stop single todo
router.post('/todos/:id/stop', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    await orchestrator.stopTodo(todo.id);

    // Re-fetch to return current state
    const updated = getTodoById(todo.id);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/todos/:id/merge - merge todo branch to main
router.post('/todos/:id/merge', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    if (todo.status !== 'completed') {
      res.status(400).json({ error: 'Can only merge completed todos' });
      return;
    }

    if (!todo.branch_name) {
      res.status(400).json({ error: 'Todo has no branch to merge' });
      return;
    }

    const project = getProjectById(todo.project_id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const git = simpleGit(project.path);
    const defaultBranch = project.default_branch || 'main';

    // Resolve actual branch (handle main vs master mismatch)
    const localBranches = await git.branchLocal();
    const targetBranch = localBranches.all.includes(defaultBranch)
      ? defaultBranch
      : (localBranches.all.find(b => b === 'master' || b === 'main') ?? defaultBranch);

    // Checkout main branch
    await git.checkout(targetBranch);

    // Verify todo branch exists
    if (!localBranches.all.includes(todo.branch_name)) {
      res.status(400).json({ error: `Branch not found: ${todo.branch_name}` });
      return;
    }

    // Attempt merge
    try {
      const mergeResult = await git.merge([todo.branch_name]);
      updateTodoStatus(todo.id, 'merged');

      // Auto-cleanup worktree and branch after successful merge
      if (todo.worktree_path) {
        try {
          await worktreeManager.cleanupWorktree(project.path, todo.worktree_path, todo.branch_name);
          updateTodo(todo.id, { worktree_path: null, branch_name: null });
        } catch {
          // Non-fatal: merge succeeded even if cleanup fails
        }
      }

      res.json({ success: true, result: mergeResult });
    } catch (mergeErr: unknown) {
      // Merge conflict - abort the merge and report
      try {
        await git.merge(['--abort']);
      } catch {
        // May fail if no merge in progress
      }
      const message = mergeErr instanceof Error ? mergeErr.message : 'Merge failed';
      res.status(409).json({ error: 'Merge conflict', details: message });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/todos/:id/merge-chain - merge an entire dependency chain to main
router.post('/todos/:id/merge-chain', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    const project = getProjectById(todo.project_id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Collect all chain members by walking up to root and then collecting all descendants
    const allTodos = getTodosByProjectId(todo.project_id);

    // Walk up to find chain root
    let rootId = todo.id;
    const visited = new Set<string>();
    while (true) {
      visited.add(rootId);
      const current = allTodos.find(t => t.id === rootId);
      if (!current?.depends_on) break;
      if (visited.has(current.depends_on)) break; // circular guard
      rootId = current.depends_on;
    }

    // Walk down from root to collect all chain members
    const chainMembers: typeof allTodos = [];
    const collectChain = (parentId: string) => {
      const member = allTodos.find(t => t.id === parentId);
      if (!member) return;
      chainMembers.push(member);
      const children = allTodos.filter(t => t.depends_on === parentId);
      for (const child of children) {
        collectChain(child.id);
      }
    };
    collectChain(rootId);

    if (chainMembers.length < 2) {
      res.status(400).json({ error: 'Not a chain. Use single merge instead.' });
      return;
    }

    // Verify all chain members are completed (or already merged)
    const nonCompleted = chainMembers.filter(t => t.status !== 'completed' && t.status !== 'merged');
    if (nonCompleted.length > 0) {
      res.status(400).json({
        error: 'All tasks in the chain must be completed before merging',
        pending: nonCompleted.map(t => ({ id: t.id, title: t.title, status: t.status })),
      });
      return;
    }

    // Find the leaf task (no other chain member depends on it) — this is the bottommost task
    const leafTask = chainMembers.find(t =>
      !chainMembers.some(other => other.depends_on === t.id)
    );

    if (!leafTask?.branch_name) {
      res.status(400).json({ error: 'No branch found in chain to merge' });
      return;
    }

    const git = simpleGit(project.path);
    const defaultBranch = project.default_branch || 'main';

    // Resolve actual branch (handle main vs master mismatch)
    const localBranches = await git.branchLocal();
    const targetBranch = localBranches.all.includes(defaultBranch)
      ? defaultBranch
      : (localBranches.all.find(b => b === 'master' || b === 'main') ?? defaultBranch);

    // Verify leaf branch exists before attempting merge
    if (!localBranches.all.includes(leafTask.branch_name!)) {
      res.status(400).json({ error: `Branch not found: ${leafTask.branch_name}` });
      return;
    }

    await git.checkout(targetBranch);

    try {
      const mergeResult = await git.merge([leafTask.branch_name!]);

      // Mark all chain members as merged and cleanup
      for (const member of chainMembers) {
        updateTodoStatus(member.id, 'merged');
        if (member.worktree_path || member.branch_name) {
          try {
            await worktreeManager.cleanupWorktree(
              project.path,
              member.worktree_path || '',
              member.branch_name || ''
            );
          } catch { /* non-fatal */ }
          updateTodo(member.id, { worktree_path: null, branch_name: null });
        }
      }

      res.json({
        success: true,
        result: mergeResult,
        mergedCount: chainMembers.length,
        mergedIds: chainMembers.map(t => t.id),
      });
    } catch (mergeErr: unknown) {
      try { await git.merge(['--abort']); } catch { /* ignore */ }
      const message = mergeErr instanceof Error ? mergeErr.message : 'Merge failed';
      res.status(409).json({ error: 'Merge conflict', details: message });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/todos/:id/cleanup - remove worktree and branch for a todo
router.post('/todos/:id/cleanup', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    if (todo.status === 'running') {
      res.status(400).json({ error: 'Cannot cleanup a running todo. Stop it first.' });
      return;
    }

    const project = getProjectById(todo.project_id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const deleteBranch = req.body.delete_branch !== false;
    const result = { worktreeRemoved: false, branchDeleted: false };

    if (todo.worktree_path || todo.branch_name) {
      const cleanup = await worktreeManager.cleanupWorktree(
        project.path,
        todo.worktree_path || '',
        todo.branch_name || '',
        deleteBranch
      );
      result.worktreeRemoved = cleanup.worktreeRemoved;
      result.branchDeleted = cleanup.branchDeleted;

      // Clear worktree info from DB
      const dbUpdate: Record<string, null> = { worktree_path: null };
      if (deleteBranch) dbUpdate.branch_name = null;
      updateTodo(todo.id, dbUpdate);
    }

    res.json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/todos/:id/retry - cleanup and restart a todo from scratch
router.post('/todos/:id/retry', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    if (todo.status === 'running') {
      res.status(400).json({ error: 'Cannot retry a running todo. Stop it first.' });
      return;
    }

    if (todo.status === 'pending') {
      res.status(400).json({ error: 'Todo has not been run yet. Use start instead.' });
      return;
    }

    const project = getProjectById(todo.project_id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const validModes = ['headless', 'interactive', 'verbose'] as const;
    const mode = validModes.includes(req.body.mode) ? req.body.mode : 'headless';
    const cliTool = ((todo.cli_tool || project.cli_tool || 'claude') as CliTool);
    if (mode === 'interactive' && !supportsInteractiveMode(cliTool)) {
      res.status(400).json({ error: `${cliTool} does not support interactive mode in CLITrigger. Use headless or verbose mode.` });
      return;
    }

    // 1. Cleanup worktree and branch if they exist
    if (todo.worktree_path || todo.branch_name) {
      try {
        await worktreeManager.cleanupWorktree(
          project.path,
          todo.worktree_path || '',
          todo.branch_name || ''
        );
      } catch {
        // Non-fatal: continue with retry even if cleanup fails
      }
    }

    // 2. Clear previous logs
    deleteTaskLogsByTodoId(todo.id);

    // 3. Reset todo state (including round count)
    updateTodoStatus(todo.id, 'pending');
    updateTodo(todo.id, { worktree_path: null, branch_name: null, process_pid: 0, round_count: 1 });

    // 4. Start fresh
    await orchestrator.startTodo(todo.id, mode);

    // Re-fetch to return current state
    const updated = getTodoById(todo.id);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/todos/:id/continue - run a follow-up prompt in the same worktree (new round)
router.post('/todos/:id/continue', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    if (todo.status !== 'completed') {
      res.status(400).json({ error: 'Only completed todos can be continued' });
      return;
    }

    const project = getProjectById(todo.project_id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) {
      res.status(400).json({ error: 'Follow-up prompt is required' });
      return;
    }
    // Follow-up prompts are contextual (user is already in a running worktree),
    // so skip the strict action-keyword validation used for new tasks.
    if (prompt.length < 2) {
      res.status(400).json({ error: 'Follow-up prompt is too short.' });
      return;
    }

    const validModes = ['headless', 'interactive', 'verbose'] as const;
    const mode = validModes.includes(req.body.mode) ? req.body.mode : 'headless';
    const cliTool = ((todo.cli_tool || project.cli_tool || 'claude') as CliTool);
    if (mode === 'interactive' && !supportsInteractiveMode(cliTool)) {
      res.status(400).json({ error: `${cliTool} does not support interactive mode in CLITrigger. Use headless or verbose mode.` });
      return;
    }

    await orchestrator.continueTodo(todo.id, prompt, mode);

    const updated = getTodoById(todo.id);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
