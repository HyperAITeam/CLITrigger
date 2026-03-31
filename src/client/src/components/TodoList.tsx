import { useState, useCallback } from 'react';
import type { Todo, TaskLog } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import type { PendingImage } from './TodoForm';
import TodoItem from './TodoItem';
import TodoForm from './TodoForm';
import { useI18n } from '../i18n';

interface TodoListProps {
  todos: Todo[];
  projectCliTool?: string;
  projectCliModel?: string;
  onAddTodo: (title: string, description: string, cliTool?: string, cliModel?: string, images?: PendingImage[], dependsOn?: string, maxTurns?: number) => Promise<void>;
  onStartTodo: (id: string, mode?: 'headless' | 'interactive' | 'streaming') => Promise<void>;
  onStopTodo: (id: string) => Promise<void>;
  onDeleteTodo: (id: string) => Promise<void>;
  onEditTodo: (id: string, title: string, description: string, cliTool?: string, cliModel?: string, dependsOn?: string, maxTurns?: number) => Promise<void>;
  onMergeTodo: (id: string) => Promise<void>;
  onCleanupTodo: (id: string) => Promise<void>;
  onRetryTodo: (id: string, mode?: 'headless' | 'interactive' | 'streaming') => Promise<void>;
  onFixTodo?: (todo: Todo, errorLogs: TaskLog[]) => Promise<void>;
  onScheduleTodo?: (todoId: string, runAt: string) => Promise<void>;
  onUpdateDependency?: (todoId: string, dependsOnId: string | null) => Promise<void>;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  onSendInput: (todoId: string, input: string) => void;
  interactiveTodos: Set<string>;
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
  onEvent,
  onSendInput,
  interactiveTodos,
}: TodoListProps) {
  const [showForm, setShowForm] = useState(false);
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [dragOverTargetId, setDragOverTargetId] = useState<string | null>(null);
  const { t } = useI18n();

  const sortedTodos = [...todos].sort((a, b) => a.priority - b.priority);

  const handleDragStart = useCallback((todoId: string) => {
    setDragSourceId(todoId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragSourceId(null);
    setDragOverTargetId(null);
  }, []);

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

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-warm-600 uppercase tracking-wider">
          {t('todos.title')}
        </h2>
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
          sortedTodos.map((todo, index) => (
            <div key={todo.id} className="animate-slide-up" style={{ animationDelay: `${index * 30}ms` }}>
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
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
