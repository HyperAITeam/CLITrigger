import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Todo, TaskLog } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import StatusBadge from './StatusBadge';
import { useI18n } from '../i18n';
import { getToolConfig, type CliTool } from '../cli-tools';

export interface TaskNodeData {
  todo: Todo;
  allTodos: Todo[];
  selected: boolean;
  onStart: (id: string, mode?: 'headless' | 'interactive' | 'verbose') => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onMerge: (id: string) => Promise<void>;
  onCleanup: (id: string) => Promise<void>;
  onRetry: (id: string, mode?: 'headless' | 'interactive' | 'verbose') => Promise<void>;
  onFix?: (todo: Todo, errorLogs: TaskLog[]) => Promise<void>;
  onSelect: (todoId: string) => void;
}

const borderColorMap: Record<Todo['status'], string> = {
  pending: '#D4B896',
  running: '#2196F3',
  completed: '#4CAF50',
  failed: '#E53935',
  stopped: '#FF9800',
  merged: '#9C27B0',
};

const ringClassMap: Record<Todo['status'], string> = {
  pending: '',
  running: 'ring-2 ring-status-running/50 animate-pulse',
  completed: '',
  failed: 'ring-1 ring-status-error/30',
  stopped: '',
  merged: '',
};

function TaskNodeComponent({ data }: NodeProps) {
  const nodeData = data as unknown as TaskNodeData;
  const { todo, allTodos, selected, onStart, onStop, onDelete, onMerge, onCleanup, onRetry, onSelect } = nodeData;
  const { t } = useI18n();

  const canStart = todo.status === 'pending' || todo.status === 'failed' || todo.status === 'stopped';
  const canStop = todo.status === 'running';
  const canMerge = todo.status === 'completed';
  const canCleanup = todo.status !== 'running' && todo.status !== 'pending' && (todo.worktree_path || todo.branch_name);
  const canRetry = todo.status === 'completed' || todo.status === 'failed' || todo.status === 'stopped';

  const parentTodo = todo.depends_on ? allTodos.find(t => t.id === todo.depends_on) : null;
  const hasUnsatisfiedDep = !!parentTodo && parentTodo.status !== 'completed';
  const borderColor = borderColorMap[todo.status];

  return (
    <div
      className={`bg-theme-card rounded-xl shadow-card min-w-[240px] max-w-[280px] overflow-hidden transition-all duration-300 ${ringClassMap[todo.status]} ${selected ? 'ring-2 ring-accent shadow-elevated -translate-y-1' : 'hover:shadow-elevated hover:-translate-y-0.5'}`}
      style={{ 
        borderLeft: `4px solid ${borderColor}`,
        position: 'relative'
      }}
    >
      {/* Subtle top light highlight */}
      <div className="absolute top-0 left-0 right-0 h-px bg-white/10 z-10 pointer-events-none" />

      {/* Target handle (input - top) */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-cyan-500 !border-2 !border-white !-top-1.5"
      />

      {/* Header */}
      <div
        className="px-3 py-2.5 cursor-pointer hover:bg-warm-50 transition-colors"
        onClick={() => onSelect(todo.id)}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-mono text-warm-400">#{todo.priority}</span>
          <span className="flex-1 text-xs text-warm-800 font-medium truncate" title={todo.title}>
            {todo.title}
          </span>
          <StatusBadge status={todo.status} />
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {todo.cli_tool && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-medium bg-status-merged/10 text-status-merged">
              {getToolConfig((todo.cli_tool as CliTool) || 'claude').label}
            </span>
          )}
          {parentTodo && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono bg-cyan-500/10 text-cyan-600">
              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              {parentTodo.title.length > 15 ? parentTodo.title.slice(0, 15) + '...' : parentTodo.title}
            </span>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-end gap-0 px-2 py-1.5 border-t border-warm-100 bg-warm-50/50">
        {canStart && (
          <button
            onClick={(e) => { e.stopPropagation(); onStart(todo.id, 'headless'); }}
            className="p-1 text-status-success/60 hover:text-status-success hover:bg-status-success/10 rounded transition-colors"
            title={hasUnsatisfiedDep ? t('todo.startWithDependency') : t('todo.startHeadless')}
          >
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </button>
        )}
        {canStop && (
          <button
            onClick={(e) => { e.stopPropagation(); onStop(todo.id); }}
            className="p-1 text-status-error/60 hover:text-status-error hover:bg-status-error/10 rounded transition-colors"
            title={t('todo.stop')}
          >
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z" /></svg>
          </button>
        )}
        {canMerge && (
          <button
            onClick={(e) => { e.stopPropagation(); onMerge(todo.id); }}
            className="p-1 text-status-merged/60 hover:text-status-merged hover:bg-status-merged/10 rounded transition-colors"
            title={t('todo.merge')}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </button>
        )}
        {canCleanup && (
          <button
            onClick={(e) => { e.stopPropagation(); onCleanup(todo.id); }}
            className="p-1 text-orange-500/60 hover:text-orange-500 hover:bg-orange-500/10 rounded transition-colors"
            title={t('todo.cleanup')}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
          </button>
        )}
        {canRetry && (
          <button
            onClick={(e) => { e.stopPropagation(); onRetry(todo.id, 'headless'); }}
            className="p-1 text-cyan-500/60 hover:text-cyan-500 hover:bg-cyan-500/10 rounded transition-colors"
            title={t('todo.retry')}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h4.586M20 20v-5h-4.586M4.929 9A8 8 0 0119.071 9M19.071 15A8 8 0 014.929 15" />
            </svg>
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(todo.id); }}
          className="p-1 text-warm-400 hover:text-status-error hover:bg-status-error/10 rounded transition-colors"
          title={t('todo.delete')}
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Source handle (output - bottom) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-accent !border-2 !border-white !-bottom-1.5"
      />
    </div>
  );
}

export default memo(TaskNodeComponent);
