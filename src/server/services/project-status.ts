// Shared project status summary + broadcast. Counts background activity
// across todos, sessions, and discussions so the sidebar dot can pulse
// whenever any of them is running.

import { broadcaster } from '../websocket/broadcaster.js';
import * as queries from '../db/queries.js';

export interface ProjectStatusSummary {
  total: number;
  running: number;
  completed: number;
  running_sessions: number;
  running_discussions: number;
}

export function getProjectStatusSummary(projectId: string): ProjectStatusSummary {
  const todos = queries.getTodosByProjectId(projectId);
  const running = todos.filter((t) => t.status === 'running').length;
  const completed = todos.filter((t) => t.status === 'completed').length;
  const sessions = queries.getSessionsByProjectId(projectId);
  const running_sessions = sessions.filter((s) => s.status === 'running').length;
  const discussions = queries.getDiscussionsByProjectId(projectId);
  const running_discussions = discussions.filter((d) => d.status === 'running').length;
  return {
    total: todos.length,
    running,
    completed,
    running_sessions,
    running_discussions,
  };
}

export function broadcastProjectStatus(projectId: string): void {
  const s = getProjectStatusSummary(projectId);
  broadcaster.broadcast({
    type: 'project:status-changed',
    projectId,
    running: s.running,
    completed: s.completed,
    total: s.total,
    running_sessions: s.running_sessions,
    running_discussions: s.running_discussions,
  });
}
