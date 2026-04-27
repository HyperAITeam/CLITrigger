import fs from 'fs';
import { createGit } from '../lib/git.js';
import * as queries from '../db/queries.js';

const SUMMARY_MAX_LEN = 240;

function trimSummary(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= SUMMARY_MAX_LEN) return collapsed;
  return collapsed.slice(0, SUMMARY_MAX_LEN - 1).trimEnd() + '…';
}

/**
 * Pick a one-line summary for a completed todo from its task_logs.
 * Prefers the latest assistant message in the most recent round; falls back
 * to the latest non-empty plain output line.
 */
export function pickSummaryFromLogs(todoId: string): string | null {
  const logs = queries.getTaskLogsByTodoId(todoId);
  if (logs.length === 0) return null;

  const latestRound = logs.reduce((max, l) => Math.max(max, l.round_number ?? 1), 1);
  const inRound = logs.filter((l) => (l.round_number ?? 1) === latestRound);

  for (let i = inRound.length - 1; i >= 0; i--) {
    const log = inRound[i];
    if (log.log_type === 'assistant' && log.message.trim()) {
      return trimSummary(log.message);
    }
  }
  for (let i = inRound.length - 1; i >= 0; i--) {
    const log = inRound[i];
    if (log.log_type === 'output' && log.message.trim() && !/^[─-]+/.test(log.message)) {
      return trimSummary(log.message);
    }
  }
  return null;
}

/**
 * Compute diff stats for a worktree against its project's default branch.
 * Returns null if the worktree is missing or git fails.
 */
export async function computeDiffStats(
  worktreePath: string | null,
  defaultBranch: string,
): Promise<{ files: number; lines: number } | null> {
  if (!worktreePath || !fs.existsSync(worktreePath)) return null;
  try {
    const git = createGit(worktreePath);
    const stat = await git.diff([`${defaultBranch}...HEAD`, '--shortstat']);
    const m = stat.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
    if (!m) return { files: 0, lines: 0 };
    const files = parseInt(m[1], 10) || 0;
    const ins = parseInt(m[2] ?? '0', 10) || 0;
    const del = parseInt(m[3] ?? '0', 10) || 0;
    return { files, lines: ins + del };
  } catch {
    return null;
  }
}

/**
 * Persist review-queue metadata (summary + diff stats) for a finished todo.
 * Best-effort: any failure is swallowed so it never blocks the orchestrator.
 */
export async function captureReviewMetadata(todoId: string): Promise<void> {
  try {
    const todo = queries.getTodoById(todoId);
    if (!todo) return;
    const project = queries.getProjectById(todo.project_id);
    const defaultBranch = project?.default_branch || 'main';

    const summary = pickSummaryFromLogs(todoId);
    const diff = await computeDiffStats(todo.worktree_path, defaultBranch);

    const updates: Parameters<typeof queries.updateTodo>[1] = {};
    if (summary !== null) updates.summary = summary;
    if (diff) {
      updates.diff_files = diff.files;
      updates.diff_lines = diff.lines;
    }
    if (Object.keys(updates).length > 0) {
      queries.updateTodo(todoId, updates);
    }
  } catch {
    // best-effort
  }
}
