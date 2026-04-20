import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Todo, TaskLog, DiffResult, TaskResult, ImageMeta } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import * as todosApi from '../api/todos';
import * as projectsApi from '../api/projects';
import StatusBadge from './StatusBadge';
import LogViewer from './LogViewer';
import TodoForm from './TodoForm';
import { useI18n } from '../i18n';
import { getToolConfig, type CliTool } from '../cli-tools';
import {
  MoreVertical,
  GripVertical,
  ChevronRight,
  Play,
  Square,
  GitMerge,
  ChevronsRight,
  RotateCcw,
  Terminal,
  Eye,
  Calendar,
  Clock,
  FileText,
  SlidersHorizontal,
  Archive,
  Pencil,
  Trash2,
  Image as ImageIcon,
  Link,
  X,
  AlertTriangle,
  Settings,
  CheckCircle,
  Zap,
  Ban,
  GitBranch,
  GitCommit,
} from 'lucide-react';
import { CMD, CMD_FONT } from './terminal-theme';

function MoreMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = r.bottom + 4;
    const drop = dropRef.current;
    if (drop) {
      const dw = drop.offsetWidth;
      const dh = drop.offsetHeight;
      // Right-align to button, then clamp within viewport
      let left = r.right - dw;
      if (left < 8) left = 8;
      if (left + dw > vw - 8) left = vw - 8 - dw;
      if (top + dh > vh - 8) top = r.top - dh - 4;
      setPos({ top, left });
      setPositioned(true);
    } else {
      setPos({ top, left: Math.max(8, r.right - 180) });
    }
  }, []);

  useEffect(() => {
    if (!open) { setPositioned(false); return; }
    updatePos();
    const raf = requestAnimationFrame(updatePos);
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || dropRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, updatePos]);

  // Filter out null/false children
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className="p-1.5 text-warm-400 hover:text-warm-600 hover:bg-theme-hover rounded-lg transition-colors"
        title="More"
      >
        <MoreVertical size={14} />
      </button>
      {open && createPortal(
        <div
          ref={dropRef}
          className={`fixed z-tooltip min-w-[160px] rounded-xl py-1 shadow-elevated${positioned ? ' animate-scale-in' : ''}`}
          style={{
            top: pos.top,
            left: pos.left,
            opacity: positioned ? 1 : 0,
            backgroundColor: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
          }}
          onClick={() => setOpen(false)}
        >
          {items}
        </div>,
        document.body
      )}
    </>
  );
}

interface TodoItemProps {
  todo: Todo;
  allTodos?: Todo[];
  projectCliTool?: string;
  projectIsGitRepo?: boolean;
  projectUseWorktree?: boolean;
  onStart: (id: string, mode?: 'headless' | 'interactive' | 'verbose') => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onEdit: (id: string, title: string, description: string, cliTool?: string, cliModel?: string, dependsOn?: string, maxTurns?: number, useWorktree?: number | null) => Promise<void>;
  onMerge: (id: string) => Promise<void>;
  onCleanup: (id: string, deleteBranch: boolean) => Promise<void>;
  onRetry: (id: string, mode?: 'headless' | 'interactive' | 'verbose') => Promise<void>;
  onContinue?: (id: string, prompt: string, mode?: 'headless' | 'interactive' | 'verbose') => Promise<void>;
  onFix?: (todo: Todo, errorLogs: TaskLog[]) => Promise<void>;
  onSchedule?: (todoId: string, runAt: string, keepOriginal?: boolean) => Promise<void>;
  onScheduleOnReset?: (todoId: string, prompt: string) => Promise<void>;
  resetsAt?: number | null;
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
  debugLogging?: boolean;
  showTokenUsage?: boolean;
  isChainMember?: boolean;
}

export default function TodoItem({ todo, allTodos = [], projectCliTool, projectIsGitRepo, projectUseWorktree, onStart, onStop, onDelete, onEdit, onMerge, onCleanup, onRetry, onContinue, onFix, onSchedule, onScheduleOnReset, resetsAt, onEvent, isInteractive, onSendInput, isDragSource, isDragging, isDragOver, isValidDropTarget, onDragStart, onDragEnd, onDragOverTarget, onDragLeaveTarget, onDropTarget, onRemoveDependency, debugLogging, showTokenUsage, isChainMember }: TodoItemProps) {
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
  const [showContinueInput, setShowContinueInput] = useState(false);
  const [continuePrompt, setContinuePrompt] = useState('');
  const [continuing, setContinuing] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);
  const [showResetSchedule, setShowResetSchedule] = useState(false);
  const [resetPrompt, setResetPrompt] = useState('');
  const [schedulingReset, setSchedulingReset] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
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
  const canScheduleOnReset = (todo.status === 'pending' || todo.status === 'completed' || todo.status === 'failed' || todo.status === 'stopped') && !!onScheduleOnReset && !!resetsAt && resetsAt > Math.floor(Date.now() / 1000);
  const canStop = todo.status === 'running';
  const canViewDiff = todo.status === 'completed' || todo.status === 'stopped' || todo.status === 'merged';
  const canMerge = todo.status === 'completed' && !isChainMember && !!todo.branch_name;
  const canRetry = todo.status === 'completed' || todo.status === 'failed' || todo.status === 'stopped';
  const canContinue = !!onContinue && todo.status === 'completed' && !!todo.worktree_path;
  const canCleanup = todo.status !== 'running' && todo.status !== 'pending' && !!todo.worktree_path && !isChainMember;

  const hasResult = todo.status === 'completed' || todo.status === 'failed' || todo.status === 'stopped' || todo.status === 'merged';

  // Auto-expand when interactive mode starts
  useEffect(() => {
    if (isInteractive && todo.status === 'running' && !expanded) {
      setExpanded(true);
    }
  }, [isInteractive, todo.status]);

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

  const handleViewDebugLog = async () => {
    try {
      const { files } = await projectsApi.getDebugLogs(todo.project_id, todo.id);
      if (files.length > 0) {
        window.open(`/api/projects/${todo.project_id}/debug-logs/${encodeURIComponent(files[0].name)}`, '_blank');
      }
    } catch { /* ignore */ }
  };

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
      setExpanded(true);
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : 'Failed to load diff');
      setExpanded(true);
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
    const deleteBranch = todo.branch_name
      ? confirm(t('cleanup.confirmDeleteBranch').replace('{name}', todo.branch_name))
      : false;
    setCleaning(true);
    setCleanError(null);
    try {
      await onCleanup(todo.id, deleteBranch);
    } catch (err) {
      setCleanError(err instanceof Error ? err.message : 'Cleanup failed');
    } finally {
      setCleaning(false);
    }
  };

  const handleRetry = async (mode: 'headless' | 'interactive' | 'verbose' = 'headless') => {
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

  const handleContinue = async (mode: 'headless' | 'interactive' | 'verbose' = 'headless') => {
    if (!onContinue) return;
    const prompt = continuePrompt.trim();
    if (!prompt) {
      setContinueError(t('todo.continuePromptRequired'));
      return;
    }
    setContinuing(true);
    setContinueError(null);
    try {
      await onContinue(todo.id, prompt, mode);
      setShowContinueInput(false);
      setContinuePrompt('');
      // Clear log cache so the next expand will re-fetch including new round
      setLogs([]);
      setLogsLoaded(false);
    } catch (err) {
      setContinueError(err instanceof Error ? err.message : 'Continue failed');
    } finally {
      setContinuing(false);
    }
  };

  const handleScheduleOnReset = async () => {
    if (!onScheduleOnReset || !resetPrompt.trim()) return;
    setSchedulingReset(true);
    setResetError(null);
    try {
      await onScheduleOnReset(todo.id, resetPrompt.trim());
      setShowResetSchedule(false);
      setResetPrompt('');
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSchedulingReset(false);
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
  const todoCliTool = ((todo.cli_tool || projectCliTool || 'claude') as CliTool);
  const supportsInteractive = getToolConfig(todoCliTool).supportsInteractive;

  if (editing) {
    return (
      <TodoForm
        initialTitle={todo.title}
        initialDescription={todo.description ?? undefined}
        initialCliTool={todo.cli_tool ?? undefined}
        initialCliModel={todo.cli_model ?? undefined}
        initialDependsOn={todo.depends_on ?? undefined}
        initialMaxTurns={todo.max_turns ?? undefined}
        initialUseWorktree={todo.use_worktree ?? null}
        projectIsGitRepo={projectIsGitRepo}
        projectUseWorktree={projectUseWorktree}
        existingImages={existingImages}
        todoId={todo.id}
        availableTodos={allTodos.filter(t => t.id !== todo.id)}
        onDeleteImage={async (imageId) => {
          await todosApi.deleteTodoImage(todo.id, imageId);
        }}
        onSave={async (title, description, cliTool, cliModel, newImages, dependsOn, maxTurns, useWorktree) => {
          await onEdit(todo.id, title, description, cliTool, cliModel, dependsOn, maxTurns, useWorktree);
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
      className={`relative transition-opacity duration-200 ${isDragSource ? 'opacity-40' : ''}`}
      onDragOver={handleItemDragOver}
      onDragLeave={handleItemDragLeave}
      onDrop={handleItemDrop}
    >
      <div className={`card border-l-4 ${borderColor} overflow-hidden transition-all duration-200 ${dropZoneActive ? 'ring-2 ring-cyan-400 ring-offset-1' : ''} ${dropZoneInvalid ? 'ring-2 ring-red-300 ring-offset-1' : ''}`}>
      {/* Header row */}
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 md:flex-nowrap md:gap-3 px-3 md:px-4 py-3 md:py-3.5 cursor-pointer hover:bg-warm-50 transition-colors"
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
          <GripVertical size={16} />
        </div>

        {/* Expand arrow */}
        <button className="text-warm-400 hover:text-accent flex-shrink-0 transition-colors">
          <ChevronRight size={14} className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
        </button>

        {/* Priority */}
        <span className="text-2xs font-mono text-warm-400 w-6 flex-shrink-0">#{todo.priority}</span>

        {/* Title — takes remaining space, forces line break after on mobile */}
        <span className="flex-1 basis-[calc(100%-100px)] md:basis-auto min-w-0 text-sm text-warm-800 font-medium truncate order-none">{todo.title}</span>

        {/* Image count badge */}
        {existingImages.length > 0 && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-2xs font-mono text-warm-400 bg-warm-100 flex-shrink-0">
            <ImageIcon size={12} />
            {existingImages.length}
          </span>
        )}

        {/* Dependency Badge */}
        {parentTodo && (
          <span
            className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-mono font-medium bg-cyan-500/10 text-cyan-600 flex-shrink-0 group/dep"
            title={`${t('todo.dependsOn')}: ${parentTodo.title}`}
          >
            <Link size={12} />
            {parentTodo.title.length > 20 ? parentTodo.title.slice(0, 20) + '...' : parentTodo.title}
            {onRemoveDependency && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemoveDependency(todo.id); }}
                className="ml-0.5 h-3.5 w-3.5 rounded-full hover:bg-cyan-500/20 inline-flex items-center justify-center opacity-0 group-hover/dep:opacity-100 transition-opacity"
                title={t('dnd.removeDep')}
              >
                <X size={10} />
              </button>
            )}
          </span>
        )}

        {/* CLI Tool Badge */}
        {todo.cli_tool && (
          <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-mono font-medium bg-status-merged/10 text-status-merged flex-shrink-0">
            {getToolConfig((todo.cli_tool as CliTool) || 'claude').label}
            {todo.cli_model && <span className="text-warm-400">/ {todo.cli_model}</span>}
          </span>
        )}

        <StatusBadge status={todo.status} />

        {/* Actions */}
        <div className="flex items-center gap-0.5 ml-auto md:ml-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {/* Primary actions: start / stop - always visible */}
          {canStart && (
            <button
              onClick={() => onStart(todo.id, 'headless')}
              className="p-1.5 text-status-success/60 hover:text-status-success hover:bg-status-success/10 rounded-lg transition-colors"
              title={t('todo.startHeadless')}
            >
              <Play size={14} />
            </button>
          )}
          {canStop && (
            <button
              onClick={() => onStop(todo.id)}
              className="p-1.5 text-status-error/60 hover:text-status-error hover:bg-status-error/10 rounded-lg transition-colors"
              title={t('todo.stop')}
            >
              <Square size={14} />
            </button>
          )}
          {canMerge && (
            <button
              onClick={handleMerge}
              disabled={merging}
              className="p-1.5 text-status-merged/60 hover:text-status-merged hover:bg-status-merged/10 rounded-lg transition-colors disabled:opacity-30"
              title={t('todo.merge')}
            >
              <GitMerge size={14} />
            </button>
          )}
          {canContinue && (
            <button
              onClick={() => { setShowContinueInput(v => !v); setContinueError(null); }}
              disabled={continuing}
              className="p-1.5 text-status-success/60 hover:text-status-success hover:bg-status-success/10 rounded-lg transition-colors disabled:opacity-30"
              title={t('todo.continue')}
            >
              <ChevronsRight size={14} />
            </button>
          )}
          {canRetry && (
            <button
              onClick={() => handleRetry('headless')}
              disabled={retrying}
              className="p-1.5 text-accent/60 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors disabled:opacity-30"
              title={t('todo.retry')}
            >
              <RotateCcw size={14} />
            </button>
          )}

          {/* More menu: secondary actions */}
          <MoreMenu>
            {canStart && supportsInteractive && (
              <button
                onClick={() => onStart(todo.id, 'interactive')}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-warm-600 hover:bg-theme-hover rounded-md transition-colors text-left"
                title={t('todo.startInteractiveDesc')}
              >
                <Terminal size={14} />
                {t('todo.startInteractive')}
              </button>
            )}
            {canStart && (
              <button
                onClick={() => onStart(todo.id, 'verbose')}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-warm-600 hover:bg-theme-hover rounded-md transition-colors text-left"
                title={t('todo.startVerboseDesc')}
              >
                <Eye size={14} />
                {t('todo.startVerbose')}
              </button>
            )}
            {canSchedule && (
              <button
                onClick={() => setShowSchedulePicker(!showSchedulePicker)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-warm-600 hover:bg-theme-hover rounded-md transition-colors text-left"
                title={t('todo.scheduleDesc')}
              >
                <Calendar size={14} />
                {t('todo.schedule')}
              </button>
            )}
            {canScheduleOnReset && (
              <button
                onClick={() => { setShowResetSchedule(v => !v); setResetError(null); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-warm-600 hover:bg-theme-hover rounded-md transition-colors text-left"
                title={t('todo.scheduleOnResetDesc')}
              >
                <Clock size={14} />
                {t('todo.scheduleOnReset')}
              </button>
            )}
            {canViewDiff && (
              <button
                onClick={handleViewDiff}
                disabled={diffLoading}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-warm-600 hover:bg-theme-hover rounded-md transition-colors text-left disabled:opacity-30"
              >
                <FileText size={14} />
                {t('todo.viewDiff')}
              </button>
            )}
            {debugLogging && hasResult && (
              <button
                onClick={handleViewDebugLog}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-warm-600 hover:bg-theme-hover rounded-md transition-colors text-left"
              >
                <SlidersHorizontal size={14} />
                {t('todo.viewDebugLog')}
              </button>
            )}
            {canCleanup && (
              <button
                onClick={handleCleanup}
                disabled={cleaning}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-warm-600 hover:bg-theme-hover rounded-md transition-colors text-left disabled:opacity-30"
              >
                <Archive size={14} />
                {t('todo.cleanup')}
              </button>
            )}
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-warm-600 hover:bg-theme-hover rounded-md transition-colors text-left"
            >
              <Pencil size={14} />
              {t('todo.edit')}
            </button>
            <button
              onClick={() => onDelete(todo.id)}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-status-error hover:bg-status-error/10 rounded-md transition-colors text-left"
            >
              <Trash2 size={14} />
              {t('todo.delete')}
            </button>
          </MoreMenu>
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
              className="bg-theme-card border border-blue-200 rounded-lg px-2 py-1.5 text-sm font-mono text-warm-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20"
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

      {/* Continue Input (inline, below header) */}
      {showContinueInput && (
        <div className="border-t border-emerald-200 px-5 py-3 bg-emerald-50/50 animate-fade-in">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-emerald-600">
              {t('todo.continuePromptLabel')}
              {(todo.round_count ?? 1) > 1 && (
                <span className="ml-2 text-emerald-500/70">({t('todo.roundLabel')} {todo.round_count})</span>
              )}
            </label>
            <textarea
              value={continuePrompt}
              onChange={(e) => setContinuePrompt(e.target.value)}
              placeholder={t('todo.continuePromptPlaceholder')}
              rows={3}
              className="w-full bg-theme-card border border-emerald-200 rounded-lg px-3 py-2 text-sm text-warm-800 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/20 resize-y"
              disabled={continuing}
            />
            {continueError && (
              <p className="text-xs text-status-error">{continueError}</p>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleContinue('headless')}
                disabled={continuing || !continuePrompt.trim()}
                className="btn-primary text-xs py-1.5 !bg-emerald-500 hover:!bg-emerald-600 disabled:opacity-30"
              >
                {continuing ? t('todo.continuing') : t('todo.confirmContinue')}
              </button>
              <button
                onClick={() => { setShowContinueInput(false); setContinueError(null); }}
                disabled={continuing}
                className="btn-ghost text-xs py-1.5"
              >
                {t('scheduleForm.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Schedule Input (inline, below header) */}
      {showResetSchedule && resetsAt && (
        <div className="border-t border-amber-200 px-5 py-3 bg-amber-50/50 animate-fade-in">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-amber-600">{t('todo.scheduleOnResetLabel')}</label>
              <span className="text-xs text-amber-500/80 font-mono">
                {new Date(resetsAt * 1000).toLocaleString()}
              </span>
            </div>
            <textarea
              value={resetPrompt}
              onChange={(e) => setResetPrompt(e.target.value)}
              placeholder={t('todo.resetPromptPlaceholder')}
              rows={3}
              className="w-full bg-theme-card border border-amber-200 rounded-lg px-3 py-2 text-sm text-warm-800 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 resize-y"
              disabled={schedulingReset}
            />
            {resetError && <p className="text-xs text-status-error">{resetError}</p>}
            <div className="flex items-center gap-2">
              <button
                onClick={handleScheduleOnReset}
                disabled={schedulingReset || !resetPrompt.trim()}
                className="btn-primary text-xs py-1.5 !bg-amber-500 hover:!bg-amber-600 disabled:opacity-30"
              >
                {schedulingReset ? t('todo.scheduling') : t('todo.confirmResetSchedule')}
              </button>
              <button
                onClick={() => { setShowResetSchedule(false); setResetError(null); }}
                disabled={schedulingReset}
                className="btn-ghost text-xs py-1.5"
              >
                {t('scheduleForm.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="animate-fade-in overflow-hidden border-t border-theme-border">
          <div className="px-4 py-3 space-y-3">

            {/* Description */}
            <section>
              <h4 className="text-2xs font-semibold text-warm-500 uppercase tracking-wider mb-1.5">
                {t('todo.description')}
              </h4>
              <div className="rounded-lg border border-theme-border bg-theme-card/50 px-3 py-2">
                {todo.description ? (
                  <p className="text-sm text-warm-700 whitespace-pre-wrap">{todo.description}</p>
                ) : (
                  <p className="text-sm text-warm-400 italic">{t('todo.noDescription')}</p>
                )}
              </div>
            </section>

            {/* Attached Images */}
            {existingImages.length > 0 && (
              <section>
                <h4 className="text-2xs font-semibold text-warm-500 uppercase tracking-wider mb-1.5">
                  {t('todo.attachedImages')} <span className="text-warm-400 normal-case">({existingImages.length})</span>
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {existingImages.map(img => (
                    <a key={img.id} href={todosApi.getTodoImageUrl(todo.id, img.id)} target="_blank" rel="noopener noreferrer">
                      <img src={todosApi.getTodoImageUrl(todo.id, img.id)} alt={img.originalName} className="h-16 w-16 object-cover rounded-md border border-theme-border" />
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* Branch / Worktree / Dependencies */}
            {(parentTodo || todo.branch_name || childTodo) && (
              <section>
                <h4 className="text-2xs font-semibold text-warm-500 uppercase tracking-wider mb-1.5">
                  {t('todo.branch')}
                </h4>
                <div className="rounded-lg border border-theme-border bg-theme-card/50 px-3 py-2 space-y-1.5">
                  {parentTodo && (
                    <div className="flex items-start gap-2 text-xs">
                      <span className="text-warm-400 w-24 flex-shrink-0 pt-0.5">{t('todo.dependsOn')}</span>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-accent/10 text-accent text-2xs font-medium">{parentTodo.title}</span>
                    </div>
                  )}
                  {todo.branch_name && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-warm-400 w-24 flex-shrink-0">{t('todo.branch')}</span>
                      <GitBranch size={12} className="text-status-success flex-shrink-0" />
                      <code className="font-mono text-xs text-warm-700 break-all">{todo.branch_name}</code>
                    </div>
                  )}
                  {todo.worktree_path && (
                    <div className="flex items-start gap-2 text-xs">
                      <span className="text-warm-400 w-24 flex-shrink-0 pt-0.5">{t('todo.worktree')}</span>
                      <code className="font-mono text-2xs text-warm-500 break-all">{todo.worktree_path}</code>
                    </div>
                  )}
                  {todo.merged_from_branch && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-warm-400 w-24 flex-shrink-0">{t('todo.mergedFrom')}</span>
                      <code className="font-mono text-xs text-status-merged break-all">{todo.merged_from_branch}</code>
                    </div>
                  )}
                  {!todo.worktree_path && childTodo && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-warm-400 w-24 flex-shrink-0">{t('todo.transferredTo')}</span>
                      <span className="text-warm-700 truncate">{childTodo.title.length > 30 ? childTodo.title.slice(0, 27) + '...' : childTodo.title}</span>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Failure Reason (terminal-styled) */}
            {todo.status === 'failed' && logs.length > 0 && (() => {
              const errorLogs = logs.filter(l => l.log_type === 'error');
              if (errorLogs.length === 0) return null;
              const exitCodeMatch = errorLogs.find(l => /exited with code (\d+)/.test(l.message));
              const exitCode = exitCodeMatch ? exitCodeMatch.message.match(/exited with code (\d+)/)?.[1] : null;
              return (
                <div style={{ background: CMD.bg, fontFamily: CMD_FONT, fontSize: 12, lineHeight: '1.5', padding: '10px 12px', borderRadius: 8, border: `1px solid ${CMD.separator}`, color: CMD.text }}>
                  <div>
                    <span style={{ color: CMD.error }}>{'>'}</span>{' '}
                    <span style={{ color: CMD.error, fontWeight: 700 }}>FAILED</span>
                    {exitCode && <span style={{ color: CMD.dim }}> (exit code: {exitCode})</span>}
                    {onFix && (
                      <button
                        onClick={() => onFix(todo, errorLogs)}
                        style={{ marginLeft: 12, color: CMD.warning, background: 'none', border: `1px solid ${CMD.warning}`, padding: '1px 8px', borderRadius: 2, cursor: 'pointer', fontSize: 11, fontFamily: CMD_FONT }}
                      >
                        {t('failure.fix')}
                      </button>
                    )}
                  </div>
                  <div style={{ maxHeight: 192, overflowY: 'auto', marginTop: 4 }}>
                    {errorLogs.map((log) => (
                      <div key={log.id}>
                        <span style={{ color: CMD.dim }}>{new Date(log.created_at).toLocaleTimeString()}</span>{' '}
                        <span style={{ color: CMD.error }}>{log.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Result Summary */}
            {hasResult && resultData && (
              <section>
                <h4 className="text-2xs font-semibold text-warm-500 uppercase tracking-wider mb-1.5">
                  {t('todo.result')}
                </h4>
                <div className="rounded-lg border border-theme-border bg-theme-card/50 px-3 py-2 space-y-2.5">

                  {/* Stats row */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {resultData.duration_seconds !== null && (
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} className="text-warm-400" />
                        <span className="text-warm-400">{t('result.duration')}</span>
                        <span className="text-warm-700 font-medium">{formatDuration(resultData.duration_seconds)}</span>
                      </span>
                    )}
                    {resultData.commits.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <GitCommit size={12} className="text-status-success" />
                        <span className="text-status-success font-medium">{resultData.commits.length}</span>
                        <span className="text-warm-400">{t('result.commits')}</span>
                      </span>
                    )}
                    {resultData.diff_stats.files_changed > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <FileText size={12} className="text-warm-400" />
                        <span className="text-warm-700 font-medium">{resultData.diff_stats.files_changed}</span>
                        <span className="text-warm-400">{t('result.filesChanged')}</span>
                        <span className="text-status-success font-mono">+{resultData.diff_stats.insertions}</span>
                        <span className="text-status-error font-mono">-{resultData.diff_stats.deletions}</span>
                      </span>
                    )}
                    {showTokenUsage && resultData.token_usage && (() => {
                      const tu = resultData.token_usage;
                      const totalInput = (tu.input_tokens ?? 0) + (tu.cache_read_input_tokens ?? 0) + (tu.cache_creation_input_tokens ?? 0);
                      const totalAll = totalInput + (tu.output_tokens ?? 0);
                      let levelLabel: string;
                      let levelClass: string;
                      if (totalAll >= 500000) { levelLabel = t('result.levelHeavy'); levelClass = 'text-status-error'; }
                      else if (totalAll >= 300000) { levelLabel = t('result.levelHigh'); levelClass = 'text-orange-500'; }
                      else if (totalAll >= 100000) { levelLabel = t('result.levelModerate'); levelClass = 'text-status-warning'; }
                      else { levelLabel = t('result.levelLight'); levelClass = 'text-status-info'; }
                      return (
                        <span className="inline-flex items-center gap-1">
                          {totalInput > 0 && <><span className="text-warm-400">{t('result.inputTokens')}</span><span className="text-warm-700 font-medium">{formatTokenCount(totalInput)}</span></>}
                          {totalInput > 0 && tu.output_tokens !== null && <span className="text-warm-400">·</span>}
                          {tu.output_tokens !== null && <><span className="text-warm-400">{t('result.outputTokens')}</span><span className="text-warm-700 font-medium">{formatTokenCount(tu.output_tokens)}</span></>}
                          {tu.num_turns != null && tu.num_turns > 1 && <><span className="text-warm-400">·</span><span className="text-warm-700">{tu.num_turns}{t('result.turns')}</span></>}
                          <span className="text-warm-400">·</span>
                          <span className={`font-medium ${levelClass}`}>{levelLabel}</span>
                        </span>
                      );
                    })()}
                  </div>

                  {/* Commits */}
                  {resultData.commits.length > 0 && (
                    <div>
                      <h5 className="text-2xs font-semibold text-warm-400 uppercase tracking-wider mb-1">{t('result.commitHistory')}</h5>
                      <div className="space-y-0.5">
                        {resultData.commits.map((c, i) => (
                          <div key={i} className="flex items-center gap-2 px-1.5 py-1 text-xs rounded hover:bg-theme-hover">
                            <code className="font-mono text-accent flex-shrink-0">{c.hash.slice(0, 7) || '-------'}</code>
                            <span className="text-warm-700 truncate flex-1">{c.message}</span>
                            <span className="text-2xs text-warm-400 flex-shrink-0">{new Date(c.date).toLocaleTimeString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Changed files */}
                  {resultData.changed_files.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <h5 className="text-2xs font-semibold text-warm-400 uppercase tracking-wider">{t('result.changedFiles')}</h5>
                        {canViewDiff && (
                          <button
                            onClick={handleViewDiff}
                            disabled={diffLoading}
                            className="flex items-center gap-1 text-2xs text-warm-500 hover:text-accent transition-colors disabled:opacity-30"
                          >
                            <ChevronRight size={10} className={`transition-transform ${showDiff ? 'rotate-90' : ''}`} />
                            <span>{showDiff ? t('todo.hideDiff') : t('todo.viewDiff')}</span>
                          </button>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        {resultData.changed_files.map((f, i) => {
                          const statusClass =
                            f.status === 'A' ? 'bg-status-success/15 text-status-success' :
                            f.status === 'D' ? 'bg-status-error/15 text-status-error' :
                            f.status === 'M' ? 'bg-status-warning/15 text-status-warning' :
                            'bg-warm-200 text-warm-600';
                          return (
                            <div key={i} className="flex items-center gap-2 px-1.5 py-0.5 text-xs">
                              <span className={`inline-flex items-center justify-center w-5 h-4 rounded text-[10px] font-bold ${statusClass}`}>{f.status}</span>
                              <span className="text-warm-700 font-mono text-2xs break-all flex-1">{f.file}</span>
                              {f.renamedFrom && <span className="text-warm-400 text-2xs flex-shrink-0">← {f.renamedFrom}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Errors */}
            {mergeError && <div className="rounded-md bg-status-error/10 text-status-error text-xs px-3 py-2">{t('todo.mergeFailed')}: {mergeError}</div>}
            {cleanError && <div className="rounded-md bg-status-error/10 text-status-error text-xs px-3 py-2">{t('todo.cleanupFailed')}: {cleanError}</div>}
            {retryError && <div className="rounded-md bg-status-error/10 text-status-error text-xs px-3 py-2">{t('todo.retryFailed')}: {retryError}</div>}
            {diffError && <div className="rounded-md bg-status-error/10 text-status-error text-xs px-3 py-2">{t('todo.diffError')}: {diffError}</div>}

            {/* Diff viewer */}
            {showDiff && diffData && (
              <section>
                <div className="flex items-center justify-between mb-1.5">
                  <h4 className="text-2xs font-semibold text-warm-500 uppercase tracking-wider">
                    {t('todo.diffOutput')}
                  </h4>
                  <div className="flex items-center gap-1.5 text-2xs">
                    <span className="text-warm-500">{diffData.stats.files_changed} {t('todo.files')}</span>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-status-success/10 text-status-success font-mono">+{diffData.stats.insertions}</span>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-status-error/10 text-status-error font-mono">-{diffData.stats.deletions}</span>
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto rounded-lg border border-theme-border bg-theme-card/50 px-3 py-2 font-mono text-xs leading-tight">
                  {diffData.diff ? diffData.diff.split('\n').map((line, i) => {
                    let lineClass = 'text-warm-500';
                    let fw = '';
                    if (line.startsWith('+') && !line.startsWith('+++')) lineClass = 'text-status-success';
                    else if (line.startsWith('-') && !line.startsWith('---')) lineClass = 'text-status-error';
                    else if (line.startsWith('@@')) lineClass = 'text-accent';
                    else if (line.startsWith('diff ')) { lineClass = 'text-warm-700'; fw = 'font-semibold'; }
                    return <div key={i} className={`whitespace-pre ${lineClass} ${fw}`}>{line}</div>;
                  }) : <span className="text-warm-400 italic">{t('log.noChanges')}</span>}
                </div>
              </section>
            )}

            {/* Logs (terminal-styled) */}
            <div className="rounded-lg overflow-hidden" style={{ background: CMD.bg, fontFamily: CMD_FONT, border: `1px solid ${CMD.separator}` }}>
              <div style={{ padding: '8px 12px', borderBottom: `1px solid ${CMD.separator}`, fontSize: 12, color: CMD.text }}>
                <span style={{ color: CMD.prompt }}>$</span>{' '}
                <span style={{ color: CMD.bright }}>tail</span>{' '}
                <span style={{ color: CMD.dim }}>-f task.log</span>
              </div>
              <LogViewer
                logs={logs}
                interactive={isInteractive && todo.status === 'running'}
                todoId={todo.id}
                onSendInput={onSendInput}
                embedded
              />
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Drop zone indicator */}
      {dropZoneActive && (
        <div className="mt-1.5 flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-cyan-400 bg-cyan-50/50 animate-fade-in">
          <Link size={14} className="text-cyan-500 flex-shrink-0" />
          <span className="text-xs font-medium text-cyan-600">{t('dnd.dropHint')}</span>
        </div>
      )}
      {dropZoneInvalid && (
        <div className="mt-1.5 flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-red-300 bg-red-50/50 animate-fade-in">
          <Ban size={14} className="text-red-400 flex-shrink-0" />
          <span className="text-xs font-medium text-red-400">{t('dnd.cyclicWarning')}</span>
        </div>
      )}
    </div>
  );
}
