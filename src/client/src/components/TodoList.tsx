import { useState } from 'react';
import type { Todo } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import TodoItem from './TodoItem';
import TodoForm from './TodoForm';
import { useI18n } from '../i18n';

interface TodoListProps {
  todos: Todo[];
  onAddTodo: (title: string, description: string) => Promise<void>;
  onStartTodo: (id: string, mode?: 'headless' | 'interactive' | 'streaming') => Promise<void>;
  onStopTodo: (id: string) => Promise<void>;
  onDeleteTodo: (id: string) => Promise<void>;
  onEditTodo: (id: string, title: string, description: string) => Promise<void>;
  onMergeTodo: (id: string) => Promise<void>;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  onSendInput: (todoId: string, input: string) => void;
  interactiveTodos: Set<string>;
}

export default function TodoList({
  todos,
  onAddTodo,
  onStartTodo,
  onStopTodo,
  onDeleteTodo,
  onEditTodo,
  onMergeTodo,
  onEvent,
  onSendInput,
  interactiveTodos,
}: TodoListProps) {
  const [showForm, setShowForm] = useState(false);
  const { t } = useI18n();

  const sortedTodos = [...todos].sort((a, b) => a.priority - b.priority);

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
            onSave={async (title, description) => {
              await onAddTodo(title, description);
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
                onStart={onStartTodo}
                onStop={onStopTodo}
                onDelete={onDeleteTodo}
                onEdit={onEditTodo}
                onMerge={onMergeTodo}
                onEvent={onEvent}
                isInteractive={interactiveTodos.has(todo.id)}
                onSendInput={onSendInput}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
