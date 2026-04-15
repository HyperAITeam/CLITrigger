export type WSEvent =
  | { type: 'todo:status-changed'; todoId: string; status: string; mode?: string; worktree_path?: string | null; branch_name?: string | null }
  | { type: 'todo:log'; todoId: string; message: string; logType: string }
  | { type: 'project:status-changed'; projectId: string; running: number; completed: number; total: number }
  | { type: 'todo:commit'; todoId: string; commitHash: string; message: string }
  | { type: 'schedule:status-changed'; scheduleId: string; isActive: boolean }
  | { type: 'schedule:run-triggered'; scheduleId: string; runId: string; todoId: string }
  | { type: 'schedule:run-skipped'; scheduleId: string; runId: string; reason: string }
  | { type: 'todo:context-switch'; todoId: string; fromCli: string; toCli: string; switchCount: number }
  | { type: 'discussion:status-changed'; discussionId: string; status: string; currentRound: number; currentAgentId: string | null }
  | { type: 'discussion:message-changed'; discussionId: string; messageId: string; agentId: string; agentName: string; round: number; status: string }
  | { type: 'discussion:log'; discussionId: string; messageId: string; message: string; logType: string; agentName: string }
  | { type: 'discussion:commit'; discussionId: string; messageId: string; commitHash: string; message: string }
  | { type: 'rate-limit:updated'; resetsAt: number; status: string | null };
