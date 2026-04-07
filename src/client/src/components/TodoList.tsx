import { useState, useCallback, useRef, useMemo } from 'react';
import type { Todo, TaskLog } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import type { PendingImage } from './TodoForm';
import TodoItem from './TodoItem';
import TodoForm from './TodoForm';
import TaskGraph from './TaskGraph';
import { useI18n } from '../i18n';

interface TodoListProps {
  todos: Todo[];
  projectCliTool?: string;
  projectCliModel?: string;
  onAddTodo: (title: string, description: string, cliTool?: string, cliModel?: string, images?: PendingImage[], dependsOn?: string, maxTurns?: number) => Promise<void>;
  onStartTodo: (id: string, mode?: 'headless' | 'interactive' | 'streaming' | 'verbose') => Promise<void>;
  onStopTodo: (id: string) => Promise<void>;
  onDeleteTodo: (id: string) => Promise<void>;
  onEditTodo: (id: string, title: string, description: string, cliTool?: string, cliModel?: string, dependsOn?: string, maxTurns?: number) => Promise<void>;
  onMergeTodo: (id: string) => Promise<void>;
  onMergeChain?: (rootTodoId: string) => Promise<void>;
  onCleanupTodo: (id: string) => Promise<void>;
  onRetryTodo: (id: string, mode?: 'headless' | 'interactive' | 'streaming' | 'verbose') => Promise<void>;
  onFixTodo?: (todo: Todo, errorLogs: TaskLog[]) => Promise<void>;
  onScheduleTodo?: (todoId: string, runAt: string, keepOriginal?: boolean) => Promise<void>;
  onUpdateDependency?: (todoId: string, dependsOnId: string | null) => Promise<void>;
  onUpdatePosition?: (todoId: string, x: number, y: number) => Promise<void>;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  onSendInput: (todoId: string, input: string) => void;
  interactiveTodos: Set<string>;
  debugLogging?: boolean;
}

function wouldCreateCycle(todos: Todo[], sourceId: string, targetId: string): boolean {
  let current: string | null = targetId;
  const visited = new Set<string>();
  while (current) {
    if (current === sourceId) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    const todo = todos.find(t => t.id === current);
    current = todo?.depends_on ?? null;
  }
  return false;
}

export default function TodoList({
  todos,
  projectCliTool,
  projectCliModel,
  onAddTodo,
  onStartTodo,
  onStopTodo,
  onDeleteTodo,
  onEditTodo,
  onMergeTodo,
  onMergeChain,
  onCleanupTodo,
  onRetryTodo,
  onFixTodo,
  onScheduleTodo,
  onUpdateDependency,
  onUpdatePosition,
  onEvent,
  onSendInput,
  interactiveTodos,
  debugLogging,
}: TodoListProps) {
  const [showForm, setShowForm] = useState(false);
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [dragOverTargetId, setDragOverTargetId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'graph'>(() => {
    try { return (localStorage.getItem('todoViewMode') as 'list' | 'graph') || 'list'; } catch { return 'list'; }
  });
  const { t } = useI18n();

  const handleViewModeChange = useCallback((mode: 'list' | 'graph') => {
    setViewMode(mode);
    try { localStorage.setItem('todoViewMode', mode); } catch { /* ignore */ }
  }, []);

  // Build hierarchical order: parents first, then their children (indented)
  const sortedTodos = (() => {
    const byPriority = [...todos].sort((a, b) => a.priority - b.priority);
    const childrenMap = new Map<string, Todo[]>(); // parentId -> children
    const roots: Todo[] = [];

    for (const todo of byPriority) {
      if (todo.depends_on) {
        const siblings = childrenMap.get(todo.depends_on) || [];
        siblings.push(todo);
        childrenMap.set(todo.depends_on, siblings);
      } else {
        roots.push(todo);
      }
    }

    // Flatten tree with depth tracking
    const result: { todo: Todo; depth: number }[] = [];
    const visited = new Set<string>();
    const addWithChildren = (todo: Todo, depth: number) => {
      if (visited.has(todo.id)) return;
      visited.add(todo.id);
      result.push({ todo, depth });
      const children = childrenMap.get(todo.id);
      if (children) {
        for (const child of children) {
          addWithChildren(child, depth + 1);
        }
      }
    };

    for (const root of roots) {
      addWithChildren(root, 0);
    }

    // Add any orphaned children (parent not in current list)
    for (const todo of byPriority) {
      if (!visited.has(todo.id)) {
        result.push({ todo, depth: 0 });
      }
    }

    return result;
  })();

  // Detect completed chains: chains with 2+ members where all are 'completed'
  const { completedChainRoots, completedChainMembers } = useMemo(() => {
    const childrenMap = new Map<string, string[]>();
    for (const todo of todos) {
      if (todo.depends_on) {
        const siblings = childrenMap.get(todo.depends_on) || [];
        siblings.push(todo.id);
        childrenMap.set(todo.depends_on, siblings);
      }
    }

    const roots = todos.filter(t => !t.depends_on && childrenMap.has(t.id));
    const completedRoots = new Map<string, number>(); // rootId -> member count
    const memberSet = new Set<string>();

    for (const root of roots) {
      const members: string[] = [];
      const collect = (id: string) => {
        const t = todos.find(x => x.id === id);
        if (!t) return;
        members.push(id);
        const children = childrenMap.get(id) || [];
        for (const childId of children) collect(childId);
      };
      collect(root.id);

      if (members.length >= 2 && members.every(id => {
        const t = todos.find(x => x.id === id);
        return t?.status === 'completed' || t?.status === 'merged';
      })) {
        completedRoots.set(root.id, members.length);
        for (const id of members) memberSet.add(id);
      }
    }

    return { completedChainRoots: completedRoots, completedChainMembers: memberSet };
  }, [todos]);

  const [mergingChain, setMergingChain] = useState<string | null>(null);
  const [chainMergeError, setChainMergeError] = useState<string | null>(null);

  const handleMergeChain = useCallback(async (rootId: string) => {
    if (!onMergeChain) return;
    setMergingChain(rootId);
    setChainMergeError(null);
    try {
      await onMergeChain(rootId);
    } catch (err: unknown) {
      setChainMergeError(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setMergingChain(null);
    }
  }, [onMergeChain]);

  const dropSucceededRef = useRef(false);

  const handleDragStart = useCallback((todoId: string) => {
    dropSucceededRef.current = false;
    setDragSourceId(todoId);
  }, []);

  const handleDragEnd = useCallback(async () => {
    if (!dropSucceededRef.current && dragSourceId && onUpdateDependency) {
      const draggedTodo = todos.find(t => t.id === dragSourceId);
      if (draggedTodo?.depends_on) {
        await onUpdateDependency(dragSourceId, null);
      }
    }
    setDragSourceId(null);
    setDragOverTargetId(null);
  }, [dragSourceId, todos, onUpdateDependency]);

  const handleDragOverTarget = useCallback((targetId: string) => {
    setDragOverTargetId(targetId);
  }, []);

  const handleDragLeaveTarget = useCallback((targetId: string) => {
    setDragOverTargetId(prev => prev === targetId ? null : prev);
  }, []);

  const handleDrop = useCallback(async (targetId: string) => {
    if (!dragSourceId || !onUpdateDependency) return;
    if (dragSourceId === targetId) return;
    if (wouldCreateCycle(todos, dragSourceId, targetId)) return;

    dropSucceededRef.current = true;
    await onUpdateDependency(dragSourceId, targetId);
    setDragSourceId(null);
    setDragOverTargetId(null);
  }, [dragSourceId, todos, onUpdateDependency]);

  const handleRemoveDependency = useCallback(async (todoId: string) => {
    if (!onUpdateDependency) return;
    await onUpdateDependency(todoId, null);
  }, [onUpdateDependency]);

  const isValidDropTarget = useCallback((targetId: string): boolean => {
    if (!dragSourceId) return false;
    if (dragSourceId === targetId) return false;
    return !wouldCreateCycle(todos, dragSourceId, targetId);
  }, [dragSourceId, todos]);

  if (viewMode === 'graph') {
    return (
      <div>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-warm-600 uppercase tracking-wider">
            {t('todos.title')}
          </h2>
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex items-center bg-warm-100 rounded-lg p-0.5">
              <button
                onClick={() => handleViewModeChange('list')}
                className="p-1.5 rounded-md transition-colors text-warm-400 hover:text-warm-600"
                title={t('graph.listView')}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <button
                onClick={() => handleViewModeChange('graph')}
                className="p-1.5 rounded-md transition-colors bg-theme-card shadow-sm text-accent-gold"
                title={t('graph.graphView')}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        <TaskGraph
          todos={todos}
          projectCliTool={projectCliTool}
          projectCliModel={projectCliModel}
          onAddTodo={onAddTodo}
          onStartTodo={onStartTodo}
          onStopTodo={onStopTodo}
          onDeleteTodo={onDeleteTodo}
          onEditTodo={onEditTodo}
          onMergeTodo={onMergeTodo}
          onCleanupTodo={onCleanupTodo}
          onRetryTodo={onRetryTodo}
          onFixTodo={onFixTodo}
          onUpdateDependency={onUpdateDependency}
          onUpdatePosition={onUpdatePosition}
          onEvent={onEvent}
          onSendInput={onSendInput}
          interactiveTodos={interactiveTodos}
          debugLogging={debugLogging}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-warm-600 uppercase tracking-wider">
          {t('todos.title')}
        </h2>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center bg-warm-100 rounded-lg p-0.5">
            <button
              onClick={() => handleViewModeChange('list')}
              className="p-1.5 rounded-md transition-colors bg-theme-card shadow-sm text-accent-gold"
              title={t('graph.listView')}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <button
              onClick={() => handleViewModeChange('graph')}
              className="p-1.5 rounded-md transition-colors text-warm-400 hover:text-warm-600"
              title={t('graph.graphView')}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
            </button>
          </div>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="btn-primary text-xs py-2"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {t('todos.add')}
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <div className="mb-5 animate-slide-up">
          <TodoForm
            projectCliTool={projectCliTool}
            projectCliModel={projectCliModel}
            availableTodos={todos}
            onSave={async (title, description, cliTool, cliModel, images, dependsOn, maxTurns) => {
              await onAddTodo(title, description, cliTool, cliModel, images, dependsOn, maxTurns);
              setShowForm(false);
            }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      <div className="space-y-3">
        {sortedTodos.length === 0 ? (
          <div className="card p-10 text-center">
            <p className="text-warm-600 font-medium">{t('todos.empty')}</p>
            <p className="text-warm-400 text-sm mt-1">{t('todos.emptyHint')}</p>
          </div>
        ) : (
          sortedTodos.map(({ todo, depth }, index) => {
            const isCompletedChainRoot = completedChainRoots.has(todo.id);
            const isChainMember = completedChainMembers.has(todo.id);
            return (
              <div key={todo.id}>
                {/* Chain merge header for completed chain roots */}
                {isCompletedChainRoot && (
                  <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg bg-status-merged/5 border border-status-merged/20 animate-slide-up" style={{ animationDelay: `${index * 30}ms` }}>
                    <svg className="h-4 w-4 text-status-merged flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <span className="text-xs font-semibold text-status-merged">
                      {t('todo.chainComplete')}
                    </span>
                    <span className="text-[10px] font-mono text-warm-400">
                      {t('todo.chainTasks').replace('{count}', String(completedChainRoots.get(todo.id)))}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      {chainMergeError && mergingChain === null && (
                        <span className="text-[10px] text-status-error">{chainMergeError}</span>
                      )}
                      <button
                        onClick={() => handleMergeChain(todo.id)}
                        disabled={mergingChain === todo.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-status-merged/15 text-status-merged hover:bg-status-merged/25 border border-status-merged/30 transition-colors disabled:opacity-50"
                        title={t('todo.mergeChainDesc')}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                        </svg>
                        {mergingChain === todo.id ? '...' : t('todo.mergeChain')}
                      </button>
                    </div>
                  </div>
                )}
                <div className="animate-slide-up" style={{ animationDelay: `${index * 30}ms`, marginLeft: depth > 0 ? `${depth * 24}px` : undefined }}>
                  <TodoItem
                    todo={todo}
                    allTodos={todos}
                    onStart={onStartTodo}
                    onStop={onStopTodo}
                    onDelete={onDeleteTodo}
                    onEdit={onEditTodo}
                    onMerge={onMergeTodo}
                    onCleanup={onCleanupTodo}
                    onRetry={onRetryTodo}
                    onFix={onFixTodo}
                    onSchedule={onScheduleTodo}
                    onEvent={onEvent}
                    isInteractive={interactiveTodos.has(todo.id)}
                    onSendInput={onSendInput}
                    isDragSource={dragSourceId === todo.id}
                    isDragging={dragSourceId !== null}
                    isDragOver={dragOverTargetId === todo.id}
                    isValidDropTarget={isValidDropTarget(todo.id)}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDragOverTarget={handleDragOverTarget}
                    onDragLeaveTarget={handleDragLeaveTarget}
                    onDropTarget={handleDrop}
                    onRemoveDependency={onUpdateDependency ? handleRemoveDependency : undefined}
                    debugLogging={debugLogging}
                    isChainMember={isChainMember}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
      {dragSourceId && todos.find(t => t.id === dragSourceId)?.depends_on && (
        <div
          className="mt-3 border-2 border-dashed border-red-300 rounded-lg p-4 text-center text-sm text-red-400 transition-colors hover:border-red-400 hover:text-red-500 hover:bg-red-50"
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragSourceId && onUpdateDependency) {
              dropSucceededRef.current = true;
              onUpdateDependency(dragSourceId, null);
            }
          }}
        >
          <svg className="w-5 h-5 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.181 8.68a4.503 4.503 0 0 1 1.903 6.405m-9.768-2.782L3.56 14.06a4.5 4.5 0 0 0 6.364 6.365l3.129-3.129m5.614-5.615 1.757-1.757a4.5 4.5 0 0 0-6.364-6.365l-3.129 3.129m0 0a4.503 4.503 0 0 0-1.903 6.405" />
          </svg>
          {t('dnd.dropToRemoveDep')}
        </div>
      )}
    </div>
  );
}
