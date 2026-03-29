export type WSEvent =
  | { type: 'todo:status-changed'; todoId: string; status: string; mode?: string; worktree_path?: string | null; branch_name?: string | null }
  | { type: 'todo:log'; todoId: string; message: string; logType: string }
  | { type: 'project:status-changed'; projectId: string; running: number; completed: number; total: number }
  | { type: 'todo:commit'; todoId: string; commitHash: string; message: string }
  | { type: 'pipeline:status-changed'; pipelineId: string; status: string; currentPhase: string | null }
  | { type: 'pipeline:phase-changed'; pipelineId: string; phaseType: string; status: string }
  | { type: 'pipeline:log'; pipelineId: string; phaseType: string; message: string; logType: string }
  | { type: 'pipeline:commit'; pipelineId: string; phaseType: string; commitHash: string; message: string }
  | { type: 'schedule:status-changed'; scheduleId: string; isActive: boolean }
  | { type: 'schedule:run-triggered'; scheduleId: string; runId: string; todoId: string }
  | { type: 'schedule:run-skipped'; scheduleId: string; runId: string; reason: string };
