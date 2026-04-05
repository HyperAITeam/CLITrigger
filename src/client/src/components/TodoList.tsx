import { useState, useCallback, useRef } from 'react';
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
                className="p-1.5 rounded-md transition-colors bg-white shadow-sm text-accent-gold"
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
              className="p-1.5 rounded-md transition-colors bg-white shadow-sm text-accent-gold"
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
          sortedTodos.map(({ todo, depth }, index) => (
            <div key={todo.id} className="animate-slide-up" style={{ animationDelay: `${index * 30}ms`, marginLeft: depth > 0 ? `${depth * 24}px` : undefined }}>
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
              />
            </div>
          ))
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
