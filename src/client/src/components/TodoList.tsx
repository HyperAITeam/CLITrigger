import { useState, useCallback, useRef, useMemo, Fragment } from 'react';
import type { Todo, TaskLog } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import type { PendingImage } from './TodoForm';
import TodoItem from './TodoItem';
import TodoForm from './TodoForm';
import TaskGraph from './TaskGraph';
import EmptyState from './EmptyState';
import { useI18n } from '../i18n';
import { List, LayoutGrid, Plus, Link, ArrowLeftRight, Unlink, ClipboardList, Layers, ChevronsUp } from 'lucide-react';

type StatusFilter = 'all' | 'active' | 'completed' | 'cancelled';

const FILTER_STATUSES: Record<StatusFilter, Todo['status'][] | null> = {
  all: null,
  active: ['pending', 'running'],
  completed: ['completed', 'merged'],
  cancelled: ['stopped', 'failed'],
};

interface TodoListProps {
  todos: Todo[];
  projectCliTool?: string;
  projectCliModel?: string;
  onAddTodo: (title: string, description: string, cliTool?: string, cliModel?: string, images?: PendingImage[], dependsOn?: string, maxTurns?: number) => Promise<void>;
  onStartTodo: (id: string, mode?: 'headless' | 'interactive' | 'verbose') => Promise<void>;
  onStopTodo: (id: string) => Promise<void>;
  onDeleteTodo: (id: string) => Promise<void>;
  onEditTodo: (id: string, title: string, description: string, cliTool?: string, cliModel?: string, dependsOn?: string, maxTurns?: number) => Promise<void>;
  onMergeTodo: (id: string) => Promise<void>;
  onMergeChain?: (rootTodoId: string) => Promise<void>;
  onCleanupTodo: (id: string) => Promise<void>;
  onRetryTodo: (id: string, mode?: 'headless' | 'interactive' | 'verbose') => Promise<void>;
  onContinueTodo?: (id: string, prompt: string, mode?: 'headless' | 'interactive' | 'verbose') => Promise<void>;
  onFixTodo?: (todo: Todo, errorLogs: TaskLog[]) => Promise<void>;
  onScheduleTodo?: (todoId: string, runAt: string, keepOriginal?: boolean) => Promise<void>;
  onScheduleOnResetTodo?: (todoId: string, prompt: string) => Promise<void>;
  resetsAt?: number | null;
  onUpdateDependency?: (todoId: string, dependsOnId: string | null) => Promise<void>;
  onUpdatePosition?: (todoId: string, x: number, y: number) => Promise<void>;
  onReorderTodos?: (orderedIds: string[]) => Promise<void>;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  onSendInput: (todoId: string, input: string) => void;
  interactiveTodos: Set<string>;
  debugLogging?: boolean;
  showTokenUsage?: boolean;
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
  onContinueTodo,
  onFixTodo,
  onScheduleTodo,
  onScheduleOnResetTodo,
  resetsAt,
  onUpdateDependency,
  onUpdatePosition,
  onReorderTodos,
  onEvent,
  onSendInput,
  interactiveTodos,
  debugLogging,
  showTokenUsage,
}: TodoListProps) {
  const [showForm, setShowForm] = useState(false);
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [dragOverTargetId, setDragOverTargetId] = useState<string | null>(null);
  const [dragOverGapIndex, setDragOverGapIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'graph'>(() => {
    try { return (localStorage.getItem('todoViewMode') as 'list' | 'graph') || 'list'; } catch { return 'list'; }
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    try { return (localStorage.getItem('todoStatusFilter') as StatusFilter) || 'all'; } catch { return 'all'; }
  });
  const [stackModeEnabled, setStackModeEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('todoStackModeEnabled') === 'true'; } catch { return false; }
  });
  const [stackCollapsed, setStackCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('todoStackCollapsed') === 'true'; } catch { return false; }
  });
  const { t } = useI18n();

  const handleViewModeChange = useCallback((mode: 'list' | 'graph') => {
    setViewMode(mode);
    try { localStorage.setItem('todoViewMode', mode); } catch { /* ignore */ }
  }, []);

  const handleStatusFilterChange = useCallback((filter: StatusFilter) => {
    setStatusFilter(filter);
    try { localStorage.setItem('todoStatusFilter', filter); } catch { /* ignore */ }
  }, []);

  const handleStackModeToggle = useCallback(() => {
    setStackModeEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem('todoStackModeEnabled', String(next)); } catch { /* ignore */ }
      if (!next) {
        setStackCollapsed(false);
        try { localStorage.setItem('todoStackCollapsed', 'false'); } catch { /* ignore */ }
      }
      return next;
    });
  }, []);

  const handleStackToggle = useCallback(() => {
    setStackCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('todoStackCollapsed', String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const isStacked = stackModeEnabled && stackCollapsed && viewMode === 'list';

  const filterCounts = useMemo(() => ({
    all: todos.length,
    active: todos.filter(t => FILTER_STATUSES.active!.includes(t.status)).length,
    completed: todos.filter(t => FILTER_STATUSES.completed!.includes(t.status)).length,
    cancelled: todos.filter(t => FILTER_STATUSES.cancelled!.includes(t.status)).length,
  }), [todos]);

  const filteredTodos = useMemo(() => {
    const allowed = FILTER_STATUSES[statusFilter];
    if (!allowed) return todos;
    return todos.filter(t => allowed.includes(t.status));
  }, [todos, statusFilter]);

  // Build hierarchical order: parents first, then their children (indented).
  // Flatten the list when a status filter is active (hierarchies across status
  // boundaries are confusing) or when stacked (depth indent breaks the stack).
  const sortedTodos = (() => {
    const byPriority = [...filteredTodos].sort((a, b) => a.priority - b.priority);

    if (statusFilter !== 'all' || isStacked) {
      return byPriority.map(todo => ({ todo, depth: 0 }));
    }

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
    setDragOverGapIndex(null);
  }, [dragSourceId, todos, onUpdateDependency]);

  const handleDragOverTarget = useCallback((targetId: string) => {
    setDragOverTargetId(targetId);
    setDragOverGapIndex(null);
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
    setDragOverGapIndex(null);
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

  const handleGapDragOver = useCallback((gapIndex: number) => {
    setDragOverGapIndex(gapIndex);
    setDragOverTargetId(null);
  }, []);

  const handleGapDragLeave = useCallback((gapIndex: number) => {
    setDragOverGapIndex(prev => prev === gapIndex ? null : prev);
  }, []);

  const handleGapDrop = useCallback(async (gapIndex: number, currentOrderIds: string[]) => {
    if (!dragSourceId || !onReorderTodos) return;
    const sourceIdx = currentOrderIds.indexOf(dragSourceId);
    if (sourceIdx < 0) return;
    const without = currentOrderIds.filter(id => id !== dragSourceId);
    const insertAt = gapIndex > sourceIdx ? gapIndex - 1 : gapIndex;
    if (insertAt === sourceIdx) {
      setDragOverGapIndex(null);
      return;
    }
    const next = [...without.slice(0, insertAt), dragSourceId, ...without.slice(insertAt)];
    dropSucceededRef.current = true;
    await onReorderTodos(next);
    setDragSourceId(null);
    setDragOverGapIndex(null);
    setDragOverTargetId(null);
  }, [dragSourceId, onReorderTodos]);

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
                <List size={14} />
              </button>
              <button
                onClick={() => handleViewModeChange('graph')}
                className="p-1.5 rounded-md transition-colors bg-theme-card shadow-sm text-accent"
                title={t('graph.graphView')}
              >
                <LayoutGrid size={14} />
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
          onContinueTodo={onContinueTodo}
          onFixTodo={onFixTodo}
          onUpdateDependency={onUpdateDependency}
          onUpdatePosition={onUpdatePosition}
          onEvent={onEvent}
          onSendInput={onSendInput}
          interactiveTodos={interactiveTodos}
          debugLogging={debugLogging}
          showTokenUsage={showTokenUsage}
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
              className="p-1.5 rounded-md transition-colors bg-theme-card shadow-sm text-accent"
              title={t('graph.listView')}
            >
              <List size={14} />
            </button>
            <button
              onClick={() => handleViewModeChange('graph')}
              className="p-1.5 rounded-md transition-colors text-warm-400 hover:text-warm-600"
              title={t('graph.graphView')}
            >
              <LayoutGrid size={14} />
            </button>
          </div>
          <button
            onClick={handleStackModeToggle}
            className={`p-1.5 rounded-md transition-colors ${
              stackModeEnabled
                ? 'bg-accent/10 text-accent'
                : 'text-warm-400 hover:text-warm-600 hover:bg-warm-100'
            }`}
            title={stackModeEnabled ? t('todos.stackModeOn') : t('todos.stackModeOff')}
          >
            <Layers size={14} />
          </button>
          {stackModeEnabled && !stackCollapsed && viewMode === 'list' && sortedTodos.length > 0 && (
            <button
              onClick={handleStackToggle}
              className="p-1.5 rounded-md transition-colors text-warm-400 hover:text-warm-600 hover:bg-warm-100"
              title={t('todos.collapseStack')}
            >
              <ChevronsUp size={14} />
            </button>
          )}
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="btn-primary text-xs py-2"
            >
              <Plus size={14} />
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

      <div className="flex items-center gap-1 mb-4 bg-warm-100 rounded-lg p-0.5 w-fit">
        {(['all', 'active', 'completed', 'cancelled'] as StatusFilter[]).map(filter => {
          const isActive = statusFilter === filter;
          const labelKey = filter === 'all' ? 'todos.filterAll'
            : filter === 'active' ? 'todos.filterActive'
            : filter === 'completed' ? 'todos.filterCompleted'
            : 'todos.filterCancelled';
          return (
            <button
              key={filter}
              onClick={() => handleStatusFilterChange(filter)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-theme-card shadow-sm text-accent'
                  : 'text-warm-500 hover:text-warm-700'
              }`}
            >
              <span>{t(labelKey)}</span>
              <span className={`text-2xs font-mono ${isActive ? 'text-accent/70' : 'text-warm-400'}`}>
                {filterCounts[filter]}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className={isStacked ? 'relative cursor-pointer' : 'space-y-3'}
        onClick={isStacked ? handleStackToggle : undefined}
        title={isStacked ? t('todos.expandStack') : undefined}
        style={isStacked ? { height: 76 + Math.max(sortedTodos.length - 1, 0) * 6 } : undefined}
      >
        {sortedTodos.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={ClipboardList}
              title={statusFilter === 'all' ? t('todos.empty') : t('todos.filterEmpty')}
              description={statusFilter === 'all' ? t('todos.emptyHint') : undefined}
            />
          </div>
        ) : (() => {
          const orderedIds = sortedTodos.map(({ todo }) => todo.id);
          const canReorder = !isStacked && !!onReorderTodos && dragSourceId !== null;
          const renderGap = (gapIndex: number) => {
            if (!canReorder) return null;
            const isActive = dragOverGapIndex === gapIndex;
            return (
              <div
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; handleGapDragOver(gapIndex); }}
                onDragLeave={() => handleGapDragLeave(gapIndex)}
                onDrop={(e) => { e.preventDefault(); handleGapDrop(gapIndex, orderedIds); }}
                className="relative transition-all"
                style={{
                  height: isActive ? 24 : 8,
                  marginTop: 0,
                }}
              >
                {isActive && (
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-accent rounded-full shadow-[0_0_6px_rgba(0,0,0,0.15)]" />
                )}
              </div>
            );
          };
          return (
            <>
              {renderGap(0)}
              {sortedTodos.map(({ todo, depth }, index) => {
            const isCompletedChainRoot = completedChainRoots.has(todo.id);
            const isChainMember = completedChainMembers.has(todo.id);
            // iOS notification stack: when collapsed, items use absolute
            // positioning so the FRONT card (index 0) stays at top and items 1+
            // slide BELOW it at 6px intervals, each fully overlapped by the card
            // in front except for a 6px peek at the bottom. Container height is
            // fixed to 76 + (n-1)*6 so there is no wasted vertical space.
            // When expanded, items go back to normal flow (space-y-3).
            const STACK_PEEK = 6;
            const STACK_TRANSITION = 'top 400ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 300ms ease';
            const stackStyle: React.CSSProperties = isStacked
              ? {
                  position: 'absolute',
                  top: index * STACK_PEEK,
                  left: 0,
                  right: 0,
                  zIndex: sortedTodos.length + 10 - index,
                  opacity: index === 0 ? 1 : 0.9,
                  pointerEvents: index === 0 ? 'auto' : 'none',
                  transition: STACK_TRANSITION,
                }
              : {
                  transition: STACK_TRANSITION,
                };
            return (
              <Fragment key={todo.id}>
              <div
                className={isStacked ? '' : 'animate-fade-in'}
                style={isStacked ? stackStyle : { animationDelay: `${index * 30}ms`, ...stackStyle }}
              >
                {/* Chain merge header for completed chain roots */}
                {!isStacked && isCompletedChainRoot && (
                  <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg bg-status-merged/5 border border-status-merged/20 animate-slide-up" style={{ animationDelay: `${index * 30}ms` }}>
                    <Link size={16} className="text-status-merged flex-shrink-0" />
                    <span className="text-xs font-semibold text-status-merged">
                      {t('todo.chainComplete')}
                    </span>
                    <span className="text-2xs font-mono text-warm-400">
                      {t('todo.chainTasks').replace('{count}', String(completedChainRoots.get(todo.id)))}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      {chainMergeError && mergingChain === null && (
                        <span className="text-2xs text-status-error">{chainMergeError}</span>
                      )}
                      <button
                        onClick={() => handleMergeChain(todo.id)}
                        disabled={mergingChain === todo.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-status-merged/15 text-status-merged hover:bg-status-merged/25 border border-status-merged/30 transition-colors disabled:opacity-50"
                        title={t('todo.mergeChainDesc')}
                      >
                        <ArrowLeftRight size={14} />
                        {mergingChain === todo.id ? '...' : t('todo.mergeChain')}
                      </button>
                    </div>
                  </div>
                )}
                <div className="relative animate-fade-in" style={{ animationDelay: `${index * 30}ms`, marginLeft: depth > 0 ? `${depth * 24}px` : undefined }}>
                  {depth > 0 && (
                    <div className="absolute top-0 bottom-0 w-px" style={{ left: '-13px', backgroundColor: 'var(--color-border)' }} />
                  )}
                  <TodoItem
                    todo={todo}
                    allTodos={todos}
                    projectCliTool={projectCliTool}
                    onStart={onStartTodo}
                    onStop={onStopTodo}
                    onDelete={onDeleteTodo}
                    onEdit={onEditTodo}
                    onMerge={onMergeTodo}
                    onCleanup={onCleanupTodo}
                    onRetry={onRetryTodo}
                    onContinue={onContinueTodo}
                    onFix={onFixTodo}
                    onSchedule={onScheduleTodo}
                    onScheduleOnReset={onScheduleOnResetTodo}
                    resetsAt={resetsAt}
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
                    showTokenUsage={showTokenUsage}
                    isChainMember={isChainMember}
                  />
                </div>
              </div>
              {renderGap(index + 1)}
              </Fragment>
            );
          })}
            </>
          );
        })()}
      </div>
      {!isStacked && dragSourceId && todos.find(t => t.id === dragSourceId)?.depends_on && (
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
          <Unlink size={20} className="mx-auto mb-1" />
          {t('dnd.dropToRemoveDep')}
        </div>
      )}
    </div>
  );
}
