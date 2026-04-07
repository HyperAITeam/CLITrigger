import { useState, useEffect } from 'react';
import type { Todo, TaskLog, DiffResult, TaskResult, ImageMeta } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import * as todosApi from '../api/todos';
import * as projectsApi from '../api/projects';
import StatusBadge from './StatusBadge';
import LogViewer from './LogViewer';
import TodoForm from './TodoForm';
import { useI18n } from '../i18n';
import { getToolConfig, type CliTool } from '../cli-tools';

interface TaskNodeDetailProps {
  todo: Todo;
  allTodos: Todo[];
  onClose: () => void;
  onEdit: (id: string, title: string, description: string, cliTool?: string, cliModel?: string, dependsOn?: string, maxTurns?: number) => Promise<void>;
  onStart: (id: string, mode?: 'headless' | 'interactive' | 'streaming' | 'verbose') => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onMerge: (id: string) => Promise<void>;
  onCleanup: (id: string) => Promise<void>;
  onRetry: (id: string, mode?: 'headless' | 'interactive' | 'streaming' | 'verbose') => Promise<void>;
  onFix?: (todo: Todo, errorLogs: TaskLog[]) => Promise<void>;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  isInteractive?: boolean;
  onSendInput?: (todoId: string, input: string) => void;
  debugLogging?: boolean;
}

export default function TaskNodeDetail({
  todo,
  allTodos,
  onClose,
  onEdit,
  onStart,
  onStop,
  onMerge,
  onCleanup,
  onRetry,
  onFix,
  onEvent,
  isInteractive,
  onSendInput,
  debugLogging,
}: TaskNodeDetailProps) {
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [diffData, setDiffData] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [resultData, setResultData] = useState<TaskResult | null>(null);
  const [resultLoaded, setResultLoaded] = useState(false);
  const { t } = useI18n();

  const canStart = todo.status === 'pending' || todo.status === 'failed' || todo.status === 'stopped';
  const canStop = todo.status === 'running';
  const canViewDiff = todo.status === 'completed' || todo.status === 'stopped' || todo.status === 'merged';
  const canMerge = todo.status === 'completed';
  const canRetry = todo.status === 'completed' || todo.status === 'failed' || todo.status === 'stopped';
  const canCleanup = todo.status !== 'running' && todo.status !== 'pending' && (todo.worktree_path || todo.branch_name);
  const hasResult = todo.status === 'completed' || todo.status === 'failed' || todo.status === 'stopped' || todo.status === 'merged';

  const existingImages: ImageMeta[] = todo.images ? JSON.parse(todo.images) : [];
  const parentTodo = todo.depends_on ? allTodos.find(t => t.id === todo.depends_on) : null;
  const hasUnsatisfiedDep = !!parentTodo && parentTodo.status !== 'completed';
  const childTodo = allTodos.find(t => t.depends_on === todo.id && t.merged_from_branch);

  // Load logs
  useEffect(() => {
    setLogs([]);
    setLogsLoaded(false);
    setResultData(null);
    setResultLoaded(false);
    setDiffData(null);
    setShowDiff(false);

    todosApi.getTodoLogs(todo.id)
      .then(data => { setLogs(data); setLogsLoaded(true); })
      .catch(() => { setLogsLoaded(true); });
  }, [todo.id]);

  // Load result
  useEffect(() => {
    if (hasResult && !resultLoaded) {
      todosApi.getTodoResult(todo.id)
        .then(data => { setResultData(data); setResultLoaded(true); })
        .catch(() => { setResultLoaded(true); });
    }
  }, [hasResult, resultLoaded, todo.id]);

  // WebSocket logs
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
        setLogs(prev => [...prev, newLog]);
      }
      if (event.type === 'todo:commit' && event.todoId === todo.id && event.message) {
        const newLog: TaskLog = {
          id: `ws-commit-${Date.now()}-${Math.random()}`,
          todo_id: todo.id,
          log_type: 'commit',
          message: `${event.commitHash ? `[${event.commitHash}] ` : ''}${event.message}`,
          created_at: new Date().toISOString(),
        };
        setLogs(prev => [...prev, newLog]);
      }
    });
  }, [onEvent, todo.id]);

  const handleViewDiff = async () => {
    if (showDiff) { setShowDiff(false); return; }
    setDiffLoading(true);
    try {
      const data = await todosApi.getTodoDiff(todo.id);
      setDiffData(data);
      setShowDiff(true);
    } catch { /* ignore */ }
    finally { setDiffLoading(false); }
  };

  const handleViewDebugLog = async () => {
    try {
      const { files } = await projectsApi.getDebugLogs(todo.project_id, todo.id);
      if (files.length > 0) {
        window.open(`/api/projects/${todo.project_id}/debug-logs/${encodeURIComponent(files[0].name)}`, '_blank');
      }
    } catch { /* ignore */ }
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

  if (editing) {
    return (
      <div className="w-[380px] border-l border-warm-200 bg-theme-card overflow-y-auto p-4">
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
          onDeleteImage={async (imageId) => { await todosApi.deleteTodoImage(todo.id, imageId); }}
          onSave={async (title, description, cliTool, cliModel, newImages, dependsOn, maxTurns) => {
            await onEdit(todo.id, title, description, cliTool, cliModel, dependsOn, maxTurns);
            if (newImages && newImages.length > 0) {
              await todosApi.uploadTodoImages(todo.id, newImages.map(img => ({ name: img.name, data: img.data })));
            }
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="w-[380px] border-l border-warm-200 bg-theme-card overflow-y-auto animate-slide-up">
      {/* Header */}
      <div className="sticky top-0 bg-theme-card border-b border-warm-200 px-4 py-3 flex items-center gap-2 z-10">
        <StatusBadge status={todo.status} />
        <span className="flex-1 text-sm font-medium text-warm-800 truncate">{todo.title}</span>
        <button
          onClick={() => setEditing(true)}
          className="p-1.5 text-warm-400 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors"
          title={t('todo.edit')}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        <button
          onClick={onClose}
          className="p-1.5 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-lg transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Action buttons */}
        <div className="flex flex-wrap gap-1.5">
          {canStart && (
            <>
              <button onClick={() => onStart(todo.id, 'headless')} className="btn-ghost text-xs py-1.5 text-status-success" title={hasUnsatisfiedDep ? t('todo.startWithDependency') : t('todo.startHeadless')}>
                {t('todo.startHeadless')}
              </button>
              <button onClick={() => onStart(todo.id, 'streaming')} className="btn-ghost text-xs py-1.5 text-amber-500" title={hasUnsatisfiedDep ? t('todo.startWithDependency') : t('todo.startStreaming')}>
                {t('todo.startStreaming')}
              </button>
            </>
          )}
          {canStop && (
            <button onClick={() => onStop(todo.id)} className="btn-ghost text-xs py-1.5 text-status-error">
              {t('todo.stop')}
            </button>
          )}
          {canViewDiff && (
            <button onClick={handleViewDiff} disabled={diffLoading} className="btn-ghost text-xs py-1.5 text-status-info disabled:opacity-30">
              {t('todo.viewDiff')}
            </button>
          )}
          {debugLogging && hasResult && (
            <button onClick={handleViewDebugLog} className="btn-ghost text-xs py-1.5 text-purple-600">
              {t('todo.viewDebugLog')}
            </button>
          )}
          {canMerge && (
            <button onClick={() => onMerge(todo.id)} className="btn-ghost text-xs py-1.5 text-status-merged">
              {t('todo.merge')}
            </button>
          )}
          {canCleanup && (
            <button onClick={() => onCleanup(todo.id)} className="btn-ghost text-xs py-1.5 text-orange-500">
              {t('todo.cleanup')}
            </button>
          )}
          {canRetry && (
            <button onClick={() => onRetry(todo.id, 'headless')} className="btn-ghost text-xs py-1.5 text-cyan-500">
              {t('todo.retry')}
            </button>
          )}
        </div>

        {/* Description */}
        <div>
          <h4 className="text-xs font-semibold text-warm-500 uppercase tracking-wider mb-1">{t('todo.description')}</h4>
          <p className="text-xs text-warm-600 whitespace-pre-wrap leading-relaxed">
            {todo.description || t('todo.noDescription')}
          </p>
        </div>

        {/* Images */}
        {existingImages.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-warm-500 uppercase tracking-wider mb-1">
              {t('todo.attachedImages')} ({existingImages.length})
            </h4>
            <div className="flex flex-wrap gap-2">
              {existingImages.map(img => (
                <a key={img.id} href={todosApi.getTodoImageUrl(todo.id, img.id)} target="_blank" rel="noopener noreferrer">
                  <img
                    src={todosApi.getTodoImageUrl(todo.id, img.id)}
                    alt={img.originalName}
                    className="h-16 w-16 object-cover rounded-lg border border-warm-200 hover:border-accent transition-colors"
                  />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Meta info */}
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[10px] font-mono text-warm-400 badge bg-warm-100">#{todo.priority}</span>
          {todo.cli_tool && (
            <span className="badge text-[10px] font-mono bg-status-merged/10 text-status-merged">
              {getToolConfig((todo.cli_tool as CliTool) || 'claude').label}
              {todo.cli_model && <span className="text-warm-400 ml-1">/ {todo.cli_model}</span>}
            </span>
          )}
          {parentTodo && (
            <span className="badge text-[10px] font-mono bg-cyan-500/10 text-cyan-600">
              {t('todo.dependsOn')}: {parentTodo.title.length > 20 ? parentTodo.title.slice(0, 20) + '...' : parentTodo.title}
            </span>
          )}
        </div>

        {/* Branch */}
        {todo.branch_name && (
          <div className="flex flex-wrap gap-1.5">
            <span className="badge text-[10px] bg-status-running/10 text-status-running">{t('todo.branch')}: {todo.branch_name}</span>
            {todo.merged_from_branch && (
              <span className="badge text-[10px] bg-purple-500/10 text-purple-600">{t('todo.mergedFrom')}: {todo.merged_from_branch}</span>
            )}
            {!todo.worktree_path && childTodo && (
              <span className="badge text-[10px] bg-amber-500/10 text-amber-600">{t('todo.transferredTo')}: {childTodo.title.length > 20 ? childTodo.title.slice(0, 20) + '...' : childTodo.title}</span>
            )}
          </div>
        )}

        {/* Failure panel */}
        {todo.status === 'failed' && logs.length > 0 && (() => {
          const errorLogs = logs.filter(l => l.log_type === 'error');
          if (errorLogs.length === 0) return null;
          return (
            <div className="rounded-lg border border-status-error/30 bg-status-error/5 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-status-error/10 border-b border-status-error/20">
                <h4 className="text-[10px] font-semibold text-status-error uppercase tracking-wider">{t('failure.title')}</h4>
                {onFix && (
                  <button
                    onClick={() => onFix(todo, errorLogs)}
                    className="text-[10px] font-medium text-amber-500 hover:text-amber-600"
                  >
                    {t('failure.fix')}
                  </button>
                )}
              </div>
              <div className="px-3 py-2 space-y-1 max-h-32 overflow-y-auto">
                {errorLogs.map(log => (
                  <div key={log.id} className="text-[10px] font-mono text-status-error whitespace-pre-wrap break-all">
                    {log.message}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Result */}
        {hasResult && resultData && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {resultData.duration_seconds !== null && (
                <span className="text-[10px] font-mono badge bg-warm-100 text-warm-600">{formatDuration(resultData.duration_seconds)}</span>
              )}
              {resultData.commits.length > 0 && (
                <span className="text-[10px] font-mono badge bg-status-success/10 text-status-success">{resultData.commits.length} commits</span>
              )}
              {resultData.diff_stats.files_changed > 0 && (
                <span className="text-[10px] font-mono badge bg-status-info/10 text-status-info">
                  {resultData.diff_stats.files_changed} files
                  <span className="text-status-success ml-1">+{resultData.diff_stats.insertions}</span>
                  <span className="text-status-error ml-1">-{resultData.diff_stats.deletions}</span>
                </span>
              )}
              {resultData.token_usage && resultData.token_usage.input_tokens !== null && (
                <span className="text-[10px] font-mono badge bg-purple-100 text-purple-700">
                  {formatTokenCount(resultData.token_usage.input_tokens)} in / {formatTokenCount(resultData.token_usage.output_tokens ?? 0)} out
                </span>
              )}
            </div>

            {/* Commits */}
            {resultData.commits.length > 0 && (
              <div>
                <h4 className="text-[10px] font-semibold text-warm-500 uppercase tracking-wider mb-1">{t('result.commitHistory')}</h4>
                <div className="space-y-0.5">
                  {resultData.commits.map((c, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[10px]">
                      <span className="font-mono text-status-info flex-shrink-0">{c.hash.slice(0, 7)}</span>
                      <span className="text-warm-700 truncate">{c.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Diff */}
        {showDiff && diffData && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-[10px] font-semibold text-warm-500 uppercase tracking-wider">{t('todo.diffOutput')}</h4>
              <div className="flex gap-2 text-[10px]">
                <span className="text-status-success">+{diffData.stats.insertions}</span>
                <span className="text-status-error">-{diffData.stats.deletions}</span>
              </div>
            </div>
            <pre className="h-48 overflow-auto bg-warm-800 rounded-lg p-3 font-mono text-[10px] leading-relaxed">
              {diffData.diff ? diffData.diff.split('\n').map((line, i) => {
                let cls = 'text-warm-400';
                if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-green-400';
                else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-red-400';
                else if (line.startsWith('@@')) cls = 'text-blue-400';
                else if (line.startsWith('diff ')) cls = 'text-amber-300 font-bold';
                return <div key={i} className={cls}>{line}</div>;
              }) : <span className="text-warm-500 italic">{t('log.noChanges')}</span>}
            </pre>
          </div>
        )}

        {/* Logs */}
        <div>
          <h4 className="text-[10px] font-semibold text-warm-500 uppercase tracking-wider mb-1">{t('todo.systemLog')}</h4>
          <LogViewer
            logs={logs}
            interactive={isInteractive && todo.status === 'running'}
            todoId={todo.id}
            onSendInput={onSendInput}
          />
        </div>
      </div>
    </div>
  );
}
