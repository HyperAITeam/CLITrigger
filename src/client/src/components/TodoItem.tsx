import { useState, useEffect } from 'react';
import type { Todo, TaskLog, DiffResult } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import * as todosApi from '../api/todos';
import StatusBadge from './StatusBadge';
import LogViewer from './LogViewer';
import TodoForm from './TodoForm';

interface TodoItemProps {
  todo: Todo;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onEdit: (id: string, title: string, description: string) => Promise<void>;
  onMerge: (id: string) => Promise<void>;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
}

export default function TodoItem({ todo, onStart, onStop, onDelete, onEdit, onMerge, onEvent }: TodoItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [diffData, setDiffData] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const canStart = todo.status === 'pending' || todo.status === 'failed' || todo.status === 'stopped';
  const canStop = todo.status === 'running';
  const canViewDiff = todo.status === 'completed' || todo.status === 'stopped' || todo.status === 'merged';
  const canMerge = todo.status === 'completed';

  // Fetch logs when expanded
  useEffect(() => {
    if (expanded && !logsLoaded) {
      todosApi.getTodoLogs(todo.id)
        .then((data) => {
          setLogs(data);
          setLogsLoaded(true);
        })
        .catch(() => { /* ignore */ });
    }
  }, [expanded, logsLoaded, todo.id]);

  // Listen for real-time log events
  useEffect(() => {
    return onEvent((event) => {
      if (event.type === 'todo:log' && event.todoId === todo.id && event.message) {
        const newLog: TaskLog = {
          id: `ws-${Date.now()}-${Math.random()}`,
          todo_id: todo.id,
          log_type: (event.logType as TaskLog['log_type']) || 'output',
          message: event.message,
          created_at: new Date().toISOString(),
        };
        setLogs((prev) => [...prev, newLog]);
      }
      if (event.type === 'todo:commit' && event.todoId === todo.id && event.message) {
        const newLog: TaskLog = {
          id: `ws-commit-${Date.now()}-${Math.random()}`,
          todo_id: todo.id,
          log_type: 'commit',
          message: `${event.commitHash ? `[${event.commitHash}] ` : ''}${event.message}`,
          created_at: new Date().toISOString(),
        };
        setLogs((prev) => [...prev, newLog]);
      }
    });
  }, [onEvent, todo.id]);

  const handleViewDiff = async () => {
    if (showDiff) {
      setShowDiff(false);
      return;
    }
    setDiffLoading(true);
    setDiffError(null);
    try {
      const data = await todosApi.getTodoDiff(todo.id);
      setDiffData(data);
      setShowDiff(true);
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : 'Failed to load diff');
    } finally {
      setDiffLoading(false);
    }
  };

  const handleMerge = async () => {
    setMerging(true);
    setMergeError(null);
    try {
      await onMerge(todo.id);
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setMerging(false);
    }
  };

  if (editing) {
    return (
      <TodoForm
        initialTitle={todo.title}
        initialDescription={todo.description ?? undefined}
        onSave={async (title, description) => {
          await onEdit(todo.id, title, description);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="rounded-lg bg-gray-800 border border-gray-700 overflow-hidden transition-all">
      {/* Collapsed header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-750"
        onClick={() => setExpanded(!expanded)}
      >
        <button
          className="text-gray-400 hover:text-gray-200 flex-shrink-0 transition-transform"
          aria-label="Toggle details"
        >
          <svg
            className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <span className="text-sm text-gray-500 font-mono w-6">#{todo.priority}</span>

        <span className="flex-1 text-gray-100 font-medium truncate">{todo.title}</span>

        <StatusBadge status={todo.status} />

        {/* Action buttons */}
        <div className="flex items-center gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
          {canStart && (
            <button
              onClick={() => onStart(todo.id)}
              className="rounded p-1.5 text-green-400 hover:bg-green-900/40 hover:text-green-300 transition-colors"
              title="Start"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          )}
          {canStop && (
            <button
              onClick={() => onStop(todo.id)}
              className="rounded p-1.5 text-red-400 hover:bg-red-900/40 hover:text-red-300 transition-colors"
              title="Stop"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h12v12H6z" />
              </svg>
            </button>
          )}
          {canViewDiff && (
            <button
              onClick={handleViewDiff}
              disabled={diffLoading}
              className="rounded p-1.5 text-cyan-400 hover:bg-cyan-900/40 hover:text-cyan-300 transition-colors disabled:opacity-50"
              title="View Diff"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>
          )}
          {canMerge && (
            <button
              onClick={handleMerge}
              disabled={merging}
              className="rounded p-1.5 text-purple-400 hover:bg-purple-900/40 hover:text-purple-300 transition-colors disabled:opacity-50"
              title="Merge to Main"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setEditing(true)}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors"
            title="Edit"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
          <button
            onClick={() => onDelete(todo.id)}
            className="rounded p-1.5 text-gray-400 hover:bg-red-900/40 hover:text-red-300 transition-colors"
            title="Delete"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-gray-700 px-4 py-4 space-y-4">
          <div>
            <h4 className="text-xs font-semibold uppercase text-gray-400 mb-1">Description</h4>
            <p className="text-sm text-gray-300 whitespace-pre-wrap">
              {todo.description || 'No description provided.'}
            </p>
          </div>

          {todo.branch_name && (
            <div className="flex gap-4 text-xs text-gray-400">
              <span>
                Branch: <code className="text-blue-400">{todo.branch_name}</code>
              </span>
              {todo.worktree_path && (
                <span>
                  Worktree: <code className="text-gray-300">{todo.worktree_path}</code>
                </span>
              )}
            </div>
          )}

          {mergeError && (
            <div className="rounded-lg bg-red-900/30 border border-red-700 p-3 text-sm text-red-300">
              Merge failed: {mergeError}
            </div>
          )}

          {diffError && (
            <div className="rounded-lg bg-red-900/30 border border-red-700 p-3 text-sm text-red-300">
              Diff error: {diffError}
            </div>
          )}

          {showDiff && diffData && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold uppercase text-gray-400">Diff</h4>
                <div className="flex gap-3 text-xs text-gray-400">
                  <span>{diffData.stats.files_changed} file(s) changed</span>
                  <span className="text-green-400">+{diffData.stats.insertions}</span>
                  <span className="text-red-400">-{diffData.stats.deletions}</span>
                </div>
              </div>
              <pre className="h-80 overflow-auto rounded-lg bg-gray-950 border border-gray-700 p-4 font-mono text-xs leading-relaxed">
                {diffData.diff ? diffData.diff.split('\n').map((line, i) => {
                  let className = 'text-gray-400';
                  if (line.startsWith('+') && !line.startsWith('+++')) className = 'text-green-400';
                  else if (line.startsWith('-') && !line.startsWith('---')) className = 'text-red-400';
                  else if (line.startsWith('@@')) className = 'text-cyan-400';
                  else if (line.startsWith('diff ')) className = 'text-yellow-400 font-bold';
                  return <div key={i} className={className}>{line}</div>;
                }) : <span className="text-gray-500 italic">No changes detected.</span>}
              </pre>
            </div>
          )}

          <div>
            <h4 className="text-xs font-semibold uppercase text-gray-400 mb-2">Logs</h4>
            <LogViewer logs={logs} />
          </div>
        </div>
      )}
    </div>
  );
}
