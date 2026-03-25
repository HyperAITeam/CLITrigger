export type WSEvent =
  | { type: 'todo:status-changed'; todoId: string; status: string; mode?: string }
  | { type: 'todo:log'; todoId: string; message: string; logType: string }
  | { type: 'project:status-changed'; projectId: string; running: number; completed: number; total: number }
  | { type: 'todo:commit'; todoId: string; commitHash: string; message: string };
