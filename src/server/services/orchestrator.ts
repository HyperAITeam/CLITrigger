import { worktreeManager } from './worktree-manager.js';
import { claudeManager, type ClaudeMode } from './claude-manager.js';
import { getAdapter, type CliTool } from './cli-adapters.js';
import { logStreamer } from './log-streamer.js';
import { injectSkills, parseSkillConfig } from './skill-injector.js';
import { broadcaster } from '../websocket/broadcaster.js';
import * as queries from '../db/queries.js';

export class Orchestrator {
  /**
   * Get the max concurrent setting for a project.
   */
  private getMaxConcurrent(projectId: string): number {
    const project = queries.getProjectById(projectId);
    return project?.max_concurrent ?? 3;
  }

  /**
   * Broadcast the current project status summary via WebSocket.
   */
  private broadcastProjectStatus(projectId: string): void {
    const todos = queries.getTodosByProjectId(projectId);
    const running = todos.filter((t) => t.status === 'running').length;
    const completed = todos.filter((t) => t.status === 'completed').length;
    broadcaster.broadcast({
      type: 'project:status-changed',
      projectId,
      running,
      completed,
      total: todos.length,
    });
  }

  /**
   * Start all pending todos for a project.
   * Respects maxConcurrent limit. When a Claude process exits,
   * the next queued todo is started automatically.
   */
  async startProject(projectId: string): Promise<void> {
    const project = queries.getProjectById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const todos = queries.getTodosByProjectId(projectId);
    const pending = todos.filter((t) => t.status === 'pending');
    const running = todos.filter((t) => t.status === 'running');
    const maxConcurrent = this.getMaxConcurrent(projectId);

    // Prevent starting if there are already running todos
    if (running.length >= maxConcurrent) {
      throw new Error(`Project already has ${running.length} running tasks (max ${maxConcurrent})`);
    }

    const slotsAvailable = Math.max(0, maxConcurrent - running.length);
    const todosToStart = pending.slice(0, slotsAvailable);

    for (const todo of todosToStart) {
      await this.startSingleTodo(todo.id, project.path, projectId);
    }
  }

  /**
   * Stop all running todos for a project.
   * Keeps worktrees so users can inspect results.
   */
  async stopProject(projectId: string): Promise<void> {
    const todos = queries.getTodosByProjectId(projectId);
    const running = todos.filter((t) => t.status === 'running');

    for (const todo of running) {
      await this.stopTodo(todo.id);
    }
  }

  /**
   * Start a single todo by ID.
   */
  async startTodo(todoId: string, mode: ClaudeMode = 'headless'): Promise<void> {
    const todo = queries.getTodoById(todoId);
    if (!todo) {
      throw new Error('Todo not found');
    }

    // Prevent starting an already running todo
    if (todo.status === 'running') {
      throw new Error('Todo is already running');
    }

    const project = queries.getProjectById(todo.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    await this.startSingleTodo(todoId, project.path, project.id, mode);
  }

  /**
   * Stop a single todo by ID.
   */
  async stopTodo(todoId: string): Promise<void> {
    const todo = queries.getTodoById(todoId);
    if (!todo) {
      throw new Error('Todo not found');
    }

    if (todo.process_pid) {
      await claudeManager.stopClaude(todo.process_pid);
    }

    queries.updateTodoStatus(todoId, 'stopped');
    queries.updateTodo(todoId, { process_pid: 0 });
    queries.createTaskLog(todoId, 'output', 'Task stopped by user.');

    broadcaster.broadcast({ type: 'todo:status-changed', todoId, status: 'stopped' });
    this.broadcastProjectStatus(todo.project_id);
  }

  /**
   * Internal: start a single todo with all the setup.
   */
  private async startSingleTodo(todoId: string, projectPath: string, projectId: string, mode: ClaudeMode = 'headless'): Promise<void> {
    const todo = queries.getTodoById(todoId);
    if (!todo) return;

    const project = queries.getProjectById(projectId);
    if (!project) return;

    // Mark as running BEFORE any async work to prevent deletion during setup
    queries.updateTodoStatus(todoId, 'running');

    const isGitRepo = !!project.is_git_repo;
    let worktreePath: string | null = null;
    let branchName: string | null = null;
    let workDir: string;
    let prompt: string;

    if (isGitRepo) {
      branchName = worktreeManager.sanitizeBranchName(todo.title);
      try {
        worktreePath = await worktreeManager.createWorktree(projectPath, branchName);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        queries.updateTodoStatus(todoId, 'failed');
        queries.createTaskLog(todoId, 'error', `Failed to create worktree: ${message}`);
        return;
      }
      workDir = worktreePath;
      prompt = `You are working in a git worktree. Your task is:\n\n${todo.description || todo.title}\n\nAfter completing the task, commit all changes with a descriptive commit message.`;

      // Save worktree info to DB immediately so cleanup button is available on failure
      queries.updateTodo(todoId, { branch_name: branchName, worktree_path: worktreePath });
    } else {
      workDir = projectPath;
      prompt = `Your task is:\n\n${todo.description || todo.title}\n\nComplete the task in the current directory.`;
      queries.createTaskLog(todoId, 'output', 'Project is not a git repository. Running directly without worktree isolation.');
    }

    // Inject gstack skills if enabled (Claude CLI only)
    const cliTool = (project.cli_tool as CliTool) || 'claude';
    if (cliTool === 'claude' && project.gstack_enabled && project.gstack_skills) {
      const skillIds = parseSkillConfig(project.gstack_skills);
      if (skillIds.length > 0) {
        try {
          await injectSkills(workDir, skillIds);
          queries.createTaskLog(todoId, 'output', `Injected gstack skills: ${skillIds.join(', ')}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          queries.createTaskLog(todoId, 'error', `Failed to inject gstack skills: ${msg}`);
        }
      }
    }

    const claudeModel = project.claude_model || undefined;
    const claudeOptions = project.claude_options ? project.claude_options : undefined;
    const adapter = getAdapter(cliTool);

    let pid: number;
    let exitPromise: Promise<number>;

    try {
      const result = await claudeManager.startClaude(workDir, prompt, claudeModel, claudeOptions, mode, cliTool);
      pid = result.pid;
      exitPromise = result.exitPromise;

      // Start streaming logs to DB
      logStreamer.streamToDb(todoId, result.stdout, result.stderr);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      queries.updateTodoStatus(todoId, 'failed');
      queries.createTaskLog(todoId, 'error', `Failed to start ${adapter.displayName}: ${message}`);
      if (isGitRepo && worktreePath) {
        try {
          await worktreeManager.removeWorktree(projectPath, worktreePath);
          queries.updateTodo(todoId, { worktree_path: null, branch_name: null });
        } catch {
          // Cleanup failed — worktree info stays in DB so user can manually clean up via UI
        }
      }
      return;
    }

    // Update todo with process info (status already set to 'running' above)
    queries.updateTodo(todoId, { process_pid: pid });

    const logMsg = isGitRepo
      ? `Started ${adapter.displayName} (PID: ${pid}) on branch ${branchName} [${mode}]`
      : `Started ${adapter.displayName} (PID: ${pid}) in project directory [${mode}]`;
    queries.createTaskLog(todoId, 'output', logMsg);

    // Broadcast status change with mode and worktree info
    broadcaster.broadcast({ type: 'todo:status-changed', todoId, status: 'running', mode, worktree_path: worktreePath, branch_name: branchName });
    this.broadcastProjectStatus(projectId);

    // Handle process exit asynchronously
    exitPromise.then((exitCode) => {
      const currentTodo = queries.getTodoById(todoId);
      // Only update if still in running state (not manually stopped)
      if (currentTodo && currentTodo.status === 'running') {
        const newStatus = exitCode === 0 ? 'completed' : 'failed';
        try {
          if (exitCode === 0) {
            queries.updateTodoStatus(todoId, 'completed');
            queries.createTaskLog(todoId, 'output', `${adapter.displayName} completed successfully.`);
          } else {
            queries.updateTodoStatus(todoId, 'failed');
            queries.createTaskLog(todoId, 'error', `${adapter.displayName} exited with code ${exitCode}.`);
          }
          queries.updateTodo(todoId, { process_pid: 0 });
        } catch {
          // Ensure status is updated even if logging fails
          try { queries.updateTodoStatus(todoId, newStatus); } catch { /* ignore */ }
        }

        // Always broadcast status change on exit
        broadcaster.broadcast({ type: 'todo:status-changed', todoId, status: newStatus });
        this.broadcastProjectStatus(projectId);
      }

      // Try to start the next pending todo for this project
      this.startNextPending(projectId).catch(() => {
        // Ignore errors when starting next todo
      });
    }).catch(() => {
      // Fallback: ensure status is updated if exitPromise handler fails
      try {
        queries.updateTodoStatus(todoId, 'failed');
        queries.updateTodo(todoId, { process_pid: 0 });
      } catch { /* ignore */ }
      broadcaster.broadcast({ type: 'todo:status-changed', todoId, status: 'failed' });
      this.broadcastProjectStatus(projectId);
    });
  }

  /**
   * Start the next pending todo if there are available slots.
   */
  private async startNextPending(projectId: string): Promise<void> {
    const todos = queries.getTodosByProjectId(projectId);
    const running = todos.filter((t) => t.status === 'running');
    const pending = todos.filter((t) => t.status === 'pending');
    const maxConcurrent = this.getMaxConcurrent(projectId);

    if (running.length < maxConcurrent && pending.length > 0) {
      const project = queries.getProjectById(projectId);
      if (project) {
        await this.startSingleTodo(pending[0].id, project.path, projectId);
      }
    }
  }
}

export const orchestrator = new Orchestrator();
