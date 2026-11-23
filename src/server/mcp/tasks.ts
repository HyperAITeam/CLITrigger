import { randomUUID } from 'crypto';
import { z } from 'zod';
import { ProtocolError, ProtocolErrorCode, type McpServer } from '@modelcontextprotocol/server';

// MCP Tasks extension (protocol 2026-07-28). A tool call answers at once with
// a task handle; the client polls tasks/get until the work settles, so a long
// wait costs the model one tool call instead of a retry loop. A task may only
// go to a client that declared the extension on that request.

export const TASKS_EXTENSION = 'io.modelcontextprotocol/tasks';
const CLIENT_CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';
const TASK_TTL_MS = 60 * 60_000;
const POLL_INTERVAL_MS = 2_000;

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

interface StoredTask {
  status: 'working' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  lastUpdatedAt: string;
  result?: ToolResult;
  error?: { code: number; message: string };
  abort: AbortController;
}

// ponytail: in-memory store; CLITrigger is one process, so tasks die with it and a poll after restart gets "not found"
const tasks = new Map<string, StoredTask>();

/** Whether the request's per-request envelope declares the tasks extension. */
export function clientSupportsTasks(envelope: unknown): boolean {
  const capabilities = (envelope as Record<string, unknown> | undefined)?.[CLIENT_CAPABILITIES_KEY] as
    | { extensions?: Record<string, unknown> }
    | undefined;
  return !!capabilities?.extensions?.[TASKS_EXTENSION];
}

function view(taskId: string, task: StoredTask) {
  return {
    taskId,
    status: task.status,
    createdAt: task.createdAt,
    lastUpdatedAt: task.lastUpdatedAt,
    ttlMs: TASK_TTL_MS,
    pollIntervalMs: POLL_INTERVAL_MS,
    ...(task.result ? { result: task.result } : {}),
    ...(task.error ? { error: task.error } : {}),
  };
}

function settle(task: StoredTask, patch: Partial<StoredTask>): void {
  if (task.status !== 'working') return;
  Object.assign(task, patch, { lastUpdatedAt: new Date().toISOString() });
}

/**
 * Starts `work` in the background and returns the task-creation result for
 * tools/call. A tool error (isError) still completes the task, so the model
 * sees the error text as the tool result.
 */
export function startTask(work: (signal: AbortSignal) => Promise<ToolResult>) {
  const taskId = randomUUID();
  const now = new Date().toISOString();
  const task: StoredTask = { status: 'working', createdAt: now, lastUpdatedAt: now, abort: new AbortController() };
  tasks.set(taskId, task);
  setTimeout(() => {
    task.abort.abort();
    tasks.delete(taskId);
  }, TASK_TTL_MS).unref();
  work(task.abort.signal).then(
    (result) => settle(task, { status: 'completed', result }),
    (err: unknown) => settle(task, {
      status: 'failed',
      error: { code: ProtocolErrorCode.InternalError, message: err instanceof Error ? err.message : String(err) },
    }),
  );
  return { resultType: 'task' as const, ...view(taskId, task) };
}

function getStoredTask(taskId: string): StoredTask {
  const task = tasks.get(taskId);
  if (!task) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Task not found: ${taskId}`);
  return task;
}

function requireTasksCapability(envelope: unknown): void {
  if (!clientSupportsTasks(envelope)) {
    throw new ProtocolError(ProtocolErrorCode.MissingRequiredClientCapability, `Request must declare the ${TASKS_EXTENSION} extension`);
  }
}

export function registerTaskHandlers(server: McpServer): void {
  const params = z.object({ taskId: z.string() });
  server.server.setRequestHandler('tasks/get', { params }, ({ taskId }, ctx) => {
    requireTasksCapability(ctx.mcpReq.envelope);
    return view(taskId, getStoredTask(taskId));
  });
  server.server.setRequestHandler('tasks/cancel', { params }, ({ taskId }, ctx) => {
    requireTasksCapability(ctx.mcpReq.envelope);
    const task = getStoredTask(taskId);
    settle(task, { status: 'cancelled' });
    task.abort.abort();
    return {};
  });
}
