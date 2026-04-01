import { useState, useEffect } from 'react';
import type { Todo, TaskLog, DiffResult, TaskResult, ImageMeta } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import * as todosApi from '../api/todos';
import StatusBadge from './StatusBadge';
import LogViewer from './LogViewer';
import TodoForm from './TodoForm';
import { useI18n } from '../i18n';
import { getToolConfig, type CliTool } from '../cli-tools';

interface TodoItemProps {
  todo: Todo;
  allTodos?: Todo[];
  onStart: (id: string, mode?: 'headless' | 'interactive' | 'streaming' | 'verbose') => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onEdit: (id: string, title: string, description: string, cliTool?: string, cliModel?: string, dependsOn?: string, maxTurns?: number) => Promise<void>;
  onMerge: (id: string) => Promise<void>;
  onCleanup: (id: string) => Promise<void>;
  onRetry: (id: string, mode?: 'headless' | 'interactive' | 'streaming' | 'verbose') => Promise<void>;
  onFix?: (todo: Todo, errorLogs: TaskLog[]) => Promise<void>;
  onSchedule?: (todoId: string, runAt: string, keepOriginal?: boolean) => Promise<void>;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  isInteractive?: boolean;
  onSendInput?: (todoId: string, input: string) => void;
  // Drag & Drop dependency props
  isDragSource?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  isValidDropTarget?: boolean;
  onDragStart?: (todoId: string) => void;
  onDragEnd?: () => void;
  onDragOverTarget?: (todoId: string) => void;
  onDragLeaveTarget?: (todoId: string) => void;
  onDropTarget?: (todoId: string) => void;
  onRemoveDependency?: (todoId: string) => void;
}

export default function TodoItem({ todo, allTodos = [], onStart, onStop, onDelete, onEdit, onMerge, onCleanup, onRetry, onFix, onSchedule, onEvent, isInteractive, onSendInput, isDragSource, isDragging, isDragOver, isValidDropTarget, onDragStart, onDragEnd, onDragOverTarget, onDragLeaveTarget, onDropTarget, onRemoveDependency }: TodoItemProps) {
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
  const [cleaning, setCleaning] = useState(false);
  const [cleanError, setCleanError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [resultData, setResultData] = useState<TaskResult | null>(null);
  const [resultLoaded, setResultLoaded] = useState(false);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [keepOriginalOnSchedule, setKeepOriginalOnSchedule] = useState(false);
  const [scheduleRunAt, setScheduleRunAt] = useState(() => {
    const now = new Date();
    now.setHours(now.getHours() + 1);
    now.setMinutes(0, 0, 0);
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    return `${y}-${mo}-${d}T${h}:${mi}`;
  });
  const [scheduling, setScheduling] = useState(false);
  const { t } = useI18n();

  const canStart = todo.status === 'pending' || todo.status === 'failed' || todo.status === 'stopped';
  const canSchedule = (todo.status === 'pending' || todo.status === 'failed' || todo.status === 'stopped') && !!onSchedule;
  const canStop = todo.status === 'running';
  const canViewDiff = todo.status === 'completed' || todo.status === 'stopped' || todo.status === 'merged';
  const canMerge = todo.status === 'completed';
  const canRetry = todo.status === 'completed' || todo.status === 'failed' || todo.status === 'stopped';
  const canCleanup = todo.status !== 'running' && todo.status !== 'pending' && (todo.worktree_path || todo.branch_name);

  const hasResult = todo.status === 'completed' || todo.status === 'failed' || todo.status === 'stopped' || todo.status === 'merged';

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
    if (expanded && hasResult && !resultLoaded) {
      todosApi.getTodoResult(todo.id)
        .then((data) => {
          setResultData(data);
          setResultLoaded(true);
        })
        .catch(() => { setResultLoaded(true); });
    }
  }, [expanded, hasResult, resultLoaded, todo.id]);

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

  const handleCleanup = async () => {
    setCleaning(true);
    setCleanError(null);
    try {
      await onCleanup(todo.id);
    } catch (err) {
      setCleanError(err instanceof Error ? err.message : 'Cleanup failed');
    } finally {
      setCleaning(false);
    }
  };

  const handleRetry = async (mode: 'headless' | 'interactive' | 'streaming' | 'verbose' = 'headless') => {
    setRetrying(true);
    setRetryError(null);
    setLogs([]);
    setLogsLoaded(false);
    setDiffData(null);
    setShowDiff(false);
    setResultData(null);
    setResultLoaded(false);
    try {
      await onRetry(todo.id, mode);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  };

  const handleSchedule = async () => {
    if (!onSchedule || !scheduleRunAt) return;
    setScheduling(true);
    try {
      await onSchedule(todo.id, new Date(scheduleRunAt).toISOString(), keepOriginalOnSchedule);
      setShowSchedulePicker(false);
    } catch {
      // ignore
    } finally {
      setScheduling(false);
    }
  };

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
  };

  const formatTokenCount = (tokens: number): string => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
    return String(tokens);
  };

  const fileStatusLabel: Record<string, { label: string; color: string }> = {
    A: { label: 'Added', color: 'text-green-500' },
    M: { label: 'Modified', color: 'text-amber-500' },
    D: { label: 'Deleted', color: 'text-red-500' },
    R: { label: 'Renamed', color: 'text-blue-500' },
    C: { label: 'Copied', color: 'text-purple-500' },
  };

  const existingImages: ImageMeta[] = todo.images ? JSON.parse(todo.images) : [];
  const parentTodo = todo.depends_on ? allTodos.find(t => t.id === todo.depends_on) : null;
  const childTodo = allTodos.find(t => t.depends_on === todo.id && t.merged_from_branch);

  if (editing) {
    return (
      <TodoForm
        initialTitle={todo.title}
        initialDescription={todo.description ?? undefined}
        initialCliTool={todo.cli_tool ?? undefined}
        initialCliModel={todo.cli_model ?? undefined}
        initialDependsOn={todo.depends_on ?? undefined}
        initialMaxTurns={todo.max_turns ?? undefined}
        existingImages={existingImages}
        todoId={todo.id}
        availableTodos={allTodos.filter(t => t.id !== todo.id)}
        onDeleteImage={async (imageId) => {
          await todosApi.deleteTodoImage(todo.id, imageId);
        }}
        onSave={async (title, description, cliTool, cliModel, newImages, dependsOn, maxTurns) => {
          await onEdit(todo.id, title, description, cliTool, cliModel, dependsOn, maxTurns);
          if (newImages && newImages.length > 0) {
            await todosApi.uploadTodoImages(todo.id, newImages.map(img => ({ name: img.name, data: img.data })));
          }
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const borderColor = {
    pending: 'border-l-warm-300',
    running: 'border-l-status-running',
    completed: 'border-l-status-success',
    failed: 'border-l-status-error',
    stopped: 'border-l-status-warning',
    merged: 'border-l-status-merged',
  }[todo.status];

  const handleItemDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', todo.id);
    e.dataTransfer.effectAllowed = 'link';
    onDragStart?.(todo.id);
  };

  const handleItemDragEnd = () => {
    onDragEnd?.();
  };

  const handleItemDragOver = (e: React.DragEvent) => {
    if (!isDragging || isDragSource) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = isValidDropTarget ? 'link' : 'none';
    onDragOverTarget?.(todo.id);
  };

  const handleItemDragLeave = () => {
    onDragLeaveTarget?.(todo.id);
  };

  const handleItemDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isDragging || isDragSource || !isValidDropTarget) return;
    onDropTarget?.(todo.id);
  };

  const dropZoneActive = isDragging && !isDragSource && isDragOver && isValidDropTarget;
  const dropZoneInvalid = isDragging && !isDragSource && isDragOver && !isValidDropTarget;

  return (
    <div
      className={`relative transition-all duration-200 ${isDragSource ? 'opacity-40 scale-[0.98]' : ''} ${isDragging && !isDragSource ? '' : ''}`}
      onDragOver={handleItemDragOver}
      onDragLeave={handleItemDragLeave}
      onDrop={handleItemDrop}
    >
      <div className={`card border-l-4 ${borderColor} overflow-hidden transition-all duration-200 ${dropZoneActive ? 'ring-2 ring-cyan-400 ring-offset-1' : ''} ${dropZoneInvalid ? 'ring-2 ring-red-300 ring-offset-1' : ''}`}>
      {/* Header row */}
      <div
        className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 sm:py-3.5 cursor-pointer hover:bg-warm-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Drag Handle */}
        <div
          draggable
          onDragStart={handleItemDragStart}
          onDragEnd={handleItemDragEnd}
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0 cursor-grab active:cursor-grabbing text-warm-300 hover:text-warm-500 transition-colors p-0.5 -ml-1"
          title={t('dnd.dropHint')}
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="5" cy="3" r="1.2" />
            <circle cx="11" cy="3" r="1.2" />
            <circle cx="5" cy="8" r="1.2" />
            <circle cx="11" cy="8" r="1.2" />
            <circle cx="5" cy="13" r="1.2" />
            <circle cx="11" cy="13" r="1.2" />
          </svg>
        </div>

        {/* Expand arrow */}
        <button className="text-warm-400 hover:text-accent-gold flex-shrink-0 transition-colors">
          <svg
            className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>

        {/* Priority */}
        <span className="text-[10px] font-mono text-warm-400 w-6">#{todo.priority}</span>

        {/* Title */}
        <span className="flex-1 text-sm text-warm-800 font-medium truncate">{todo.title}</span>

        {/* Image count badge */}
        {existingImages.length > 0 && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-mono text-warm-400 bg-warm-100 flex-shrink-0">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {existingImages.length}
          </span>
        )}

        {/* Dependency Badge */}
        {parentTodo && (
          <span
            className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-cyan-500/10 text-cyan-600 flex-shrink-0 group/dep"
            title={`${t('todo.dependsOn')}: ${parentTodo.title}`}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            {parentTodo.title.length > 20 ? parentTodo.title.slice(0, 20) + '...' : parentTodo.title}
            {onRemoveDependency && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemoveDependency(todo.id); }}
                className="ml-0.5 h-3.5 w-3.5 rounded-full hover:bg-cyan-500/20 inline-flex items-center justify-center opacity-0 group-hover/dep:opacity-100 transition-opacity"
                title={t('dnd.removeDep')}
              >
                <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </span>
        )}

        {/* CLI Tool Badge */}
        {todo.cli_tool && (
          <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-status-merged/10 text-status-merged flex-shrink-0">
            {getToolConfig((todo.cli_tool as CliTool) || 'claude').label}
            {todo.cli_model && <span className="text-warm-400">/ {todo.cli_model}</span>}
          </span>
        )}

        <StatusBadge status={todo.status} />

        {/* Actions */}
        <div className="flex items-center gap-0.5 ml-1 sm:ml-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {canStart && (
            <>
              <button
                onClick={() => onStart(todo.id, 'headless')}
                className="p-1.5 text-status-success/60 hover:text-status-success hover:bg-status-success/10 rounded-lg transition-colors"
                title={t('todo.startHeadless')}
              >
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
              <button
                onClick={() => onStart(todo.id, 'streaming')}
                className="p-1.5 text-amber-500/60 hover:text-amber-500 hover:bg-amber-500/10 rounded-lg transition-colors"
                title={t('todo.startStreaming')}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </button>
              <button
                onClick={() => onStart(todo.id, 'interactive')}
                className="p-1.5 text-blue-500/60 hover:text-blue-500 hover:bg-blue-500/10 rounded-lg transition-colors"
                title={t('todo.startInteractive')}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
              <button
                onClick={() => onStart(todo.id, 'verbose')}
                className="p-1.5 text-purple-500/60 hover:text-purple-500 hover:bg-purple-500/10 rounded-lg transition-colors"
                title={t('todo.startVerbose')}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
            </>
          )}
          {canSchedule && (
            <button
              onClick={() => setShowSchedulePicker(!showSchedulePicker)}
              className="p-1.5 text-blue-500/60 hover:text-blue-500 hover:bg-blue-500/10 rounded-lg transition-colors"
              title={t('todo.schedule')}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
          )}
          {canStop && (
            <button
              onClick={() => onStop(todo.id)}
              className="p-1.5 text-status-error/60 hover:text-status-error hover:bg-status-error/10 rounded-lg transition-colors"
              title={t('todo.stop')}
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
              className="p-1.5 text-status-info/60 hover:text-status-info hover:bg-status-info/10 rounded-lg transition-colors disabled:opacity-30"
              title={t('todo.viewDiff')}
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
              className="p-1.5 text-status-merged/60 hover:text-status-merged hover:bg-status-merged/10 rounded-lg transition-colors disabled:opacity-30"
              title={t('todo.merge')}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>
          )}
          {canCleanup && (
            <button
              onClick={handleCleanup}
              disabled={cleaning}
              className="p-1.5 text-orange-500/60 hover:text-orange-500 hover:bg-orange-500/10 rounded-lg transition-colors disabled:opacity-30"
              title={t('todo.cleanup')}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </button>
          )}
          {canRetry && (
            <button
              onClick={() => handleRetry('headless')}
              disabled={retrying}
              className="p-1.5 text-cyan-500/60 hover:text-cyan-500 hover:bg-cyan-500/10 rounded-lg transition-colors disabled:opacity-30"
              title={t('todo.retry')}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h4.586M20 20v-5h-4.586M4.929 9A8 8 0 0119.071 9M19.071 15A8 8 0 014.929 15" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setEditing(true)}
            className="p-1.5 text-warm-400 hover:text-accent-gold hover:bg-accent-gold/10 rounded-lg transition-colors"
            title={t('todo.edit')}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(todo.id)}
            className="p-1.5 text-warm-400 hover:text-status-error hover:bg-status-error/10 rounded-lg transition-colors"
            title={t('todo.delete')}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Schedule Picker (inline, below header) */}
      {showSchedulePicker && (
        <div className="border-t border-blue-200 px-5 py-3 bg-blue-50/50 animate-fade-in">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-medium text-blue-600">{t('todo.scheduleAt')}</label>
            <input
              type="datetime-local"
              value={scheduleRunAt}
              onChange={(e) => setScheduleRunAt(e.target.value)}
              className="bg-white border border-blue-200 rounded-lg px-2 py-1.5 text-sm font-mono text-warm-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20"
              min={new Date().toISOString().slice(0, 16)}
            />
            <button
              onClick={handleSchedule}
              disabled={scheduling || !scheduleRunAt}
              className="btn-primary text-xs py-1.5 !bg-blue-500 hover:!bg-blue-600 disabled:opacity-30"
            >
              {scheduling ? t('todo.scheduling') : t('todo.confirmSchedule')}
            </button>
            <button
              onClick={() => setShowSchedulePicker(false)}
              className="btn-ghost text-xs py-1.5"
            >
              {t('scheduleForm.cancel')}
            </button>
            <label className="flex items-center gap-2 text-xs text-blue-700">
              <input
                type="checkbox"
                checked={keepOriginalOnSchedule}
                onChange={(e) => setKeepOriginalOnSchedule(e.target.checked)}
                className="rounded border-blue-300 text-blue-500 focus:ring-blue-400"
              />
              {t('todo.scheduleKeepOriginal')}
            </label>
          </div>
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-warm-200 px-3 sm:px-5 py-4 sm:py-5 space-y-4 sm:space-y-5 animate-fade-in bg-warm-50/50">
          {/* Description */}
          <div>
            <h4 className="text-xs font-semibold text-warm-500 uppercase tracking-wider mb-2">
              {t('todo.description')}
            </h4>
            <p className="text-sm text-warm-600 whitespace-pre-wrap leading-relaxed">
              {todo.description || t('todo.noDescription')}
            </p>
          </div>

          {/* Attached Images */}
          {existingImages.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-warm-500 uppercase tracking-wider mb-2">
                {t('todo.attachedImages')} ({existingImages.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {existingImages.map(img => (
                  <a
                    key={img.id}
                    href={todosApi.getTodoImageUrl(todo.id, img.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <img
                      src={todosApi.getTodoImageUrl(todo.id, img.id)}
                      alt={img.originalName}
                      className="h-24 w-24 object-cover rounded-lg border border-warm-200 hover:border-accent-gold transition-colors cursor-pointer"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Dependency info */}
          {parentTodo && (
            <div className="flex items-center gap-2 text-xs">
              <span className="badge bg-cyan-500/10 text-cyan-600">
                {t('todo.dependsOn')}: {parentTodo.title}
              </span>
            </div>
          )}

          {/* Branch info */}
          {todo.branch_name && (
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="badge bg-status-running/10 text-status-running">
                {t('todo.branch')}: {todo.branch_name}
              </span>
              {todo.worktree_path && (
                <span className="badge bg-warm-200 text-warm-600 font-mono">
                  {t('todo.path')}: {todo.worktree_path}
                </span>
              )}
              {todo.merged_from_branch && (
                <span className="badge bg-purple-500/10 text-purple-600">
                  {t('todo.mergedFrom')}: {todo.merged_from_branch}
                </span>
              )}
              {!todo.worktree_path && childTodo && (
                <span className="badge bg-amber-500/10 text-amber-600">
                  {t('todo.transferredTo')}: {childTodo.title.length > 20 ? childTodo.title.slice(0, 20) + '...' : childTodo.title}
                </span>
              )}
            </div>
          )}

          {/* Failure Reason Panel */}
          {todo.status === 'failed' && logs.length > 0 && (() => {
            const errorLogs = logs.filter(l => l.log_type === 'error');
            if (errorLogs.length === 0) return null;
            // Extract exit code from error messages
            const exitCodeMatch = errorLogs.find(l => /exited with code (\d+)/.test(l.message));
            const exitCode = exitCodeMatch ? exitCodeMatch.message.match(/exited with code (\d+)/)?.[1] : null;
            return (
              <div className="rounded-xl border border-status-error/30 bg-status-error/5 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-status-error/10 border-b border-status-error/20">
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-status-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <h4 className="text-xs font-semibold text-status-error uppercase tracking-wider">
                      {t('failure.title')}
                    </h4>
                    {exitCode && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-status-error/15 text-status-error">
                        {t('failure.exitCode')}: {exitCode}
                      </span>
                    )}
                  </div>
                  {onFix && (
                    <button
                      onClick={() => onFix(todo, errorLogs)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 border border-amber-500/30 transition-colors"
                      title={t('failure.fix')}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {t('failure.fix')}
                    </button>
                  )}
                </div>
                <div className="px-4 py-3 space-y-1.5 max-h-48 overflow-y-auto">
                  {errorLogs.map((log) => (
                    <div key={log.id} className="flex items-start gap-2 text-xs">
                      <span className="text-warm-500 font-mono flex-shrink-0">
                        {new Date(log.created_at).toLocaleTimeString()}
                      </span>
                      <span className="text-status-error font-mono whitespace-pre-wrap break-all">
                        {log.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Result Summary */}
          {hasResult && resultData && (
            <div className="space-y-4">
              {/* Stats bar */}
              <div className="flex flex-wrap gap-3">
                {resultData.duration_seconds !== null && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-warm-100 text-warm-700">
                    <svg className="h-3.5 w-3.5 text-warm-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-xs font-medium">{t('result.duration')}</span>
                    <span className="text-xs font-mono">{formatDuration(resultData.duration_seconds)}</span>
                  </div>
                )}
                {resultData.commits.length > 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-status-success/10 text-status-success">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-xs font-medium">{resultData.commits.length} {t('result.commits')}</span>
                  </div>
                )}
                {resultData.diff_stats.files_changed > 0 && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-status-info/10 text-status-info">
                    <span className="text-xs font-medium">{resultData.diff_stats.files_changed} {t('result.filesChanged')}</span>
                    <span className="text-xs text-status-success font-mono">+{resultData.diff_stats.insertions}</span>
                    <span className="text-xs text-status-error font-mono">-{resultData.diff_stats.deletions}</span>
                  </div>
                )}
                {resultData.token_usage && (() => {
                  const tu = resultData.token_usage;
                  const totalInput = (tu.input_tokens ?? 0) + (tu.cache_read_input_tokens ?? 0) + (tu.cache_creation_input_tokens ?? 0);
                  const totalAll = totalInput + (tu.output_tokens ?? 0);

                  // Usage level label based on total tokens
                  let levelLabel: string;
                  let levelColor: string;
                  if (totalAll >= 500000) {
                    levelLabel = t('result.levelHeavy');
                    levelColor = 'text-status-error font-semibold';
                  } else if (totalAll >= 300000) {
                    levelLabel = t('result.levelHigh');
                    levelColor = 'text-orange-600 font-semibold';
                  } else if (totalAll >= 100000) {
                    levelLabel = t('result.levelModerate');
                    levelColor = 'text-amber-600';
                  } else {
                    levelLabel = t('result.levelLight');
                    levelColor = 'text-purple-500';
                  }

                  return (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-100 text-purple-700">
                      <svg className="h-3.5 w-3.5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      {totalInput > 0 && (
                        <span className="text-xs font-mono">{t('result.inputTokens')} {formatTokenCount(totalInput)}</span>
                      )}
                      {totalInput > 0 && tu.output_tokens !== null && <span className="text-xs text-purple-300">·</span>}
                      {tu.output_tokens !== null && (
                        <span className="text-xs font-mono">{t('result.outputTokens')} {formatTokenCount(tu.output_tokens)}</span>
                      )}
                      {tu.num_turns != null && tu.num_turns > 1 && <span className="text-xs text-purple-300">·</span>}
                      {tu.num_turns != null && tu.num_turns > 1 && (
                        <span className="text-xs font-mono">{tu.num_turns}{t('result.turns')}</span>
                      )}
                      <span className="text-xs text-purple-300">·</span>
                      <span className={`text-xs font-mono ${levelColor}`}>{levelLabel}</span>
                    </div>
                  );
                })()}
              </div>

              {/* Commits list */}
              {resultData.commits.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-warm-500 uppercase tracking-wider mb-2">
                    {t('result.commitHistory')}
                  </h4>
                  <div className="space-y-1">
                    {resultData.commits.map((c, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs py-1 px-2 rounded hover:bg-warm-100 transition-colors">
                        <span className="font-mono text-status-info flex-shrink-0">{c.hash.slice(0, 7) || '-------'}</span>
                        <span className="text-warm-700 flex-1">{c.message}</span>
                        <span className="text-warm-400 flex-shrink-0">{new Date(c.date).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Changed files list */}
              {resultData.changed_files.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-warm-500 uppercase tracking-wider mb-2">
                    {t('result.changedFiles')}
                  </h4>
                  <div className="space-y-0.5">
                    {resultData.changed_files.map((f, i) => {
                      const info = fileStatusLabel[f.status] || { label: f.status, color: 'text-warm-500' };
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-warm-100 transition-colors">
                          <span className={`font-mono font-bold w-4 text-center flex-shrink-0 ${info.color}`}>{f.status}</span>
                          <span className="font-mono text-warm-700 flex-1 truncate" title={f.file}>{f.file}</span>
                          {f.renamedFrom && (
                            <span className="text-warm-400 truncate" title={f.renamedFrom}>&larr; {f.renamedFrom}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Errors */}
          {mergeError && (
            <div className="py-2.5 px-4 bg-status-error/5 border border-status-error/20 rounded-xl text-xs text-status-error">
              {t('todo.mergeFailed')}: {mergeError}
            </div>
          )}

          {cleanError && (
            <div className="py-2.5 px-4 bg-status-error/5 border border-status-error/20 rounded-xl text-xs text-status-error">
              {t('todo.cleanupFailed')}: {cleanError}
            </div>
          )}

          {retryError && (
            <div className="py-2.5 px-4 bg-status-error/5 border border-status-error/20 rounded-xl text-xs text-status-error">
              {t('todo.retryFailed')}: {retryError}
            </div>
          )}

          {diffError && (
            <div className="py-2.5 px-4 bg-status-error/5 border border-status-error/20 rounded-xl text-xs text-status-error">
              {t('todo.diffError')}: {diffError}
            </div>
          )}

          {/* Diff viewer */}
          {showDiff && diffData && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-warm-500 uppercase tracking-wider">
                  {t('todo.diffOutput')}
                </h4>
                <div className="flex gap-3 text-xs">
                  <span className="text-warm-400">{diffData.stats.files_changed} {t('todo.files')}</span>
                  <span className="text-status-success">+{diffData.stats.insertions}</span>
                  <span className="text-status-error">-{diffData.stats.deletions}</span>
                </div>
              </div>
              <pre className="h-60 sm:h-80 overflow-auto bg-warm-800 rounded-xl border border-warm-700 p-3 sm:p-4 font-mono text-xs leading-relaxed">
                {diffData.diff ? diffData.diff.split('\n').map((line, i) => {
                  let className = 'text-warm-400';
                  if (line.startsWith('+') && !line.startsWith('+++')) className = 'text-green-400';
                  else if (line.startsWith('-') && !line.startsWith('---')) className = 'text-red-400';
                  else if (line.startsWith('@@')) className = 'text-blue-400';
                  else if (line.startsWith('diff ')) className = 'text-amber-300 font-bold';
                  return <div key={i} className={className}>{line}</div>;
                }) : <span className="text-warm-500 italic">{t('log.noChanges')}</span>}
              </pre>
            </div>
          )}

          {/* Logs */}
          <div>
            <h4 className="text-xs font-semibold text-warm-500 uppercase tracking-wider mb-2">
              {t('todo.systemLog')}
            </h4>
            <LogViewer
              logs={logs}
              interactive={isInteractive && todo.status === 'running'}
              todoId={todo.id}
              onSendInput={onSendInput}
            />
          </div>
        </div>
      )}
      </div>

      {/* Drop zone indicator */}
      {dropZoneActive && (
        <div className="mt-1.5 flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-cyan-400 bg-cyan-50/50 animate-fade-in">
          <svg className="h-3.5 w-3.5 text-cyan-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span className="text-xs font-medium text-cyan-600">{t('dnd.dropHint')}</span>
        </div>
      )}
      {dropZoneInvalid && (
        <div className="mt-1.5 flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-red-300 bg-red-50/50 animate-fade-in">
          <svg className="h-3.5 w-3.5 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
          <span className="text-xs font-medium text-red-400">{t('dnd.cyclicWarning')}</span>
        </div>
      )}
    </div>
  );
}
