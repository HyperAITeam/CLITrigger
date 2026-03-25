import { useState } from 'react';
import type { Todo } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import TodoItem from './TodoItem';
import TodoForm from './TodoForm';

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

  const sortedTodos = [...todos].sort((a, b) => a.priority - b.priority);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-mono font-bold text-street-300 tracking-[0.2em] uppercase">
          &gt; TASK_QUEUE
        </h2>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="street-btn flex items-center gap-2 bg-neon-green px-4 py-2 text-[10px] text-street-900 hover:bg-neon-green/80 hover:shadow-neon-green"
          >
            <span className="text-sm leading-none">+</span>
            ADD TASK
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

      <div className="space-y-2">
        {sortedTodos.length === 0 ? (
          <div className="street-card p-10 text-center">
            <p className="font-mono text-street-400 text-sm">// EMPTY QUEUE</p>
            <p className="font-mono text-street-500 text-xs mt-1">Add a task to begin execution.</p>
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
