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
  return queries.getProjectStatusCounts(projectId);
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
