import * as queries from '../db/queries.js';

// raw-shell excluded: it is a terminal, not a delegatable agent.
const DELEGATABLE_TOOLS = new Set(['claude', 'antigravity', 'codex']);

export interface AutoDelegateRule {
  from: string;
  to: string;
}

/** Parse a project's auto_delegate column. Malformed or invalid JSON means disabled. */
export function parseAutoDelegate(raw: string | null): AutoDelegateRule | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (
      value && typeof value.from === 'string' && typeof value.to === 'string'
      && DELEGATABLE_TOOLS.has(value.from) && DELEGATABLE_TOOLS.has(value.to)
    ) {
      return { from: value.from, to: value.to };
    }
  } catch {
    // Malformed JSON = disabled
  }
  return null;
}

/**
 * Auto-delegation: when a todo completes successfully and the project rule's
 * `from` matches its resolved CLI, create a pending review todo assigned to
 * `to`, chained via depends_on so the orchestrator's existing auto-chain
 * machinery starts it and inherits the parent's branch (squash-merge).
 * Returns the created todo, or null when no delegation applies.
 */
export function maybeCreateReviewTodo(projectId: string, parentTodoId: string): queries.Todo | null {
  const parent = queries.getTodoById(parentTodoId);
  // Loop guard: a delegated review todo never spawns another review (covers from === to).
  if (!parent || parent.delegated_from) return null;

  // Re-fetch: callers hold a project row from task start, stale by completion time.
  const project = queries.getProjectById(projectId);
  if (!project) return null;
  const rule = parseAutoDelegate(project.auto_delegate);
  if (!rule) return null;

  // Same resolution as the orchestrator's launch path.
  const resolvedCliTool = parent.cli_tool || project.cli_tool || 'claude';
  if (resolvedCliTool !== rule.from) return null;

  // Dedupe: retry/continue completions must not create a second review todo.
  if (queries.getTodosByProjectId(projectId).some((todo) => todo.delegated_from === parentTodoId)) {
    return null;
  }

  const description =
    `Review the changes made by the completed task "${parent.title}".\n` +
    `If this task runs in a git worktree, the parent's work was squash-merged into this branch as a single commit; ` +
    `otherwise the parent's commits are already on the current branch. ` +
    `Diff against the project default branch to see all changes (e.g. \`git diff ${project.default_branch}...HEAD\`).\n` +
    `Review for correctness, bugs, and regressions. Fix any critical issues you find and commit the fixes. ` +
    `Summarize your findings in your final message.`;

  return queries.createTodo(
    projectId,
    `Review: ${parent.title}`,
    description,
    parent.priority,
    rule.to,
    undefined,
    undefined,
    parentTodoId, // depends_on → auto-start + branch inheritance
    undefined,
    parent.use_worktree,
    undefined,
    undefined,
    undefined,
    parentTodoId, // delegated_from
  );
}
