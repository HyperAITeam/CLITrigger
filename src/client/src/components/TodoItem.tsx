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

  // Left border color based on status
  const borderColor = {
    pending: 'border-l-street-500',
    running: 'border-l-neon-cyan',
    completed: 'border-l-neon-green',
    failed: 'border-l-neon-pink',
    stopped: 'border-l-neon-yellow',
    merged: 'border-l-neon-purple',
  }[todo.status];

  return (
    <div className={`bg-street-800 border-2 border-street-600 border-l-4 ${borderColor} overflow-hidden transition-all hover:border-street-500`}>
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-street-700/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Expand arrow */}
        <button className="text-street-500 hover:text-neon-green flex-shrink-0 transition-colors">
          <svg
            className={`h-3 w-3 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>

        {/* Priority */}
        <span className="text-[10px] font-mono text-street-500 w-6">#{todo.priority}</span>

        {/* Title */}
        <span className="flex-1 text-sm text-white font-mono truncate">{todo.title}</span>

        <StatusBadge status={todo.status} />

        {/* Actions */}
        <div className="flex items-center gap-0.5 ml-2" onClick={(e) => e.stopPropagation()}>
          {canStart && (
            <button
              onClick={() => onStart(todo.id)}
              className="p-1.5 text-neon-green/70 hover:text-neon-green hover:bg-neon-green/10 transition-colors"
              title="Start"
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          )}
          {canStop && (
            <button
              onClick={() => onStop(todo.id)}
              className="p-1.5 text-neon-pink/70 hover:text-neon-pink hover:bg-neon-pink/10 transition-colors"
              title="Stop"
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h12v12H6z" />
              </svg>
            </button>
          )}
          {canViewDiff && (
            <button
              onClick={handleViewDiff}
              disabled={diffLoading}
              className="p-1.5 text-neon-cyan/70 hover:text-neon-cyan hover:bg-neon-cyan/10 transition-colors disabled:opacity-30"
              title="View Diff"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>
          )}
          {canMerge && (
            <button
              onClick={handleMerge}
              disabled={merging}
              className="p-1.5 text-neon-purple/70 hover:text-neon-purple hover:bg-neon-purple/10 transition-colors disabled:opacity-30"
              title="Merge"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setEditing(true)}
            className="p-1.5 text-street-500 hover:text-neon-yellow hover:bg-neon-yellow/10 transition-colors"
            title="Edit"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(todo.id)}
            className="p-1.5 text-street-500 hover:text-neon-pink hover:bg-neon-pink/10 transition-colors"
            title="Delete"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t-2 border-street-600 px-5 py-5 space-y-5 animate-slide-up">
          {/* Description */}
          <div>
            <h4 className="text-[10px] font-mono font-bold text-street-500 tracking-[0.2em] uppercase mb-2">
              DESCRIPTION
            </h4>
            <p className="text-sm text-street-300 font-mono whitespace-pre-wrap leading-relaxed">
              {todo.description || '// No description provided.'}
            </p>
          </div>

          {/* Branch info */}
          {todo.branch_name && (
            <div className="flex flex-wrap gap-3 text-xs font-mono">
              <span className="px-2 py-1 bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan">
                BRANCH: {todo.branch_name}
              </span>
              {todo.worktree_path && (
                <span className="px-2 py-1 bg-street-700 border border-street-600 text-street-300">
                  PATH: {todo.worktree_path}
                </span>
              )}
            </div>
          )}

          {/* Errors */}
          {mergeError && (
            <div className="py-2 px-3 bg-neon-pink/10 border border-neon-pink/30 font-mono text-xs text-neon-pink">
              ! MERGE FAILED: {mergeError}
            </div>
          )}

          {diffError && (
            <div className="py-2 px-3 bg-neon-pink/10 border border-neon-pink/30 font-mono text-xs text-neon-pink">
              ! DIFF ERROR: {diffError}
            </div>
          )}

          {/* Diff viewer */}
          {showDiff && diffData && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[10px] font-mono font-bold text-street-500 tracking-[0.2em] uppercase">
                  DIFF OUTPUT
                </h4>
                <div className="flex gap-4 text-[10px] font-mono tracking-wider">
                  <span className="text-street-400">{diffData.stats.files_changed} FILES</span>
                  <span className="text-neon-green">+{diffData.stats.insertions}</span>
                  <span className="text-neon-pink">-{diffData.stats.deletions}</span>
                </div>
              </div>
              <pre className="h-80 overflow-auto bg-street-900 border-2 border-street-600 p-4 font-mono text-xs leading-relaxed">
                {diffData.diff ? diffData.diff.split('\n').map((line, i) => {
                  let className = 'text-street-400';
                  if (line.startsWith('+') && !line.startsWith('+++')) className = 'text-neon-green';
                  else if (line.startsWith('-') && !line.startsWith('---')) className = 'text-neon-pink';
                  else if (line.startsWith('@@')) className = 'text-neon-cyan';
                  else if (line.startsWith('diff ')) className = 'text-neon-yellow font-bold';
                  return <div key={i} className={className}>{line}</div>;
                }) : <span className="text-street-500 italic">// No changes detected.</span>}
              </pre>
            </div>
          )}

          {/* Logs */}
          <div>
            <h4 className="text-[10px] font-mono font-bold text-street-500 tracking-[0.2em] uppercase mb-2">
              SYSTEM LOG
            </h4>
            <LogViewer logs={logs} />
          </div>
        </div>
      )}
    </div>
  );
}
