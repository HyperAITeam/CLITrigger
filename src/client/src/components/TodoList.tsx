import { useState } from 'react';
import type { Todo, TaskLog } from '../types';
import TodoItem from './TodoItem';
import TodoForm from './TodoForm';

interface TodoListProps {
  todos: Todo[];
  logs: TaskLog[];
  onAddTodo: (title: string, description: string) => void;
  onStartTodo: (id: string) => void;
  onStopTodo: (id: string) => void;
  onDeleteTodo: (id: string) => void;
  onEditTodo: (id: string, title: string, description: string) => void;
}

export default function TodoList({
  todos,
  logs,
  onAddTodo,
  onStartTodo,
  onStopTodo,
  onDeleteTodo,
  onEditTodo,
}: TodoListProps) {
  const [showForm, setShowForm] = useState(false);

  const sortedTodos = [...todos].sort((a, b) => a.priority - b.priority);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-200">Tasks</h2>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Task
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-4">
          <TodoForm
            onSave={(title, description) => {
              onAddTodo(title, description);
              setShowForm(false);
            }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      <div className="space-y-2">
        {sortedTodos.length === 0 ? (
          <div className="rounded-lg bg-gray-800 border border-gray-700 p-8 text-center text-gray-400">
            No tasks yet. Click "Add Task" to get started.
          </div>
        ) : (
          sortedTodos.map((todo) => (
            <TodoItem
              key={todo.id}
              todo={todo}
              logs={logs.filter((l) => l.todo_id === todo.id)}
              onStart={onStartTodo}
              onStop={onStopTodo}
              onDelete={onDeleteTodo}
              onEdit={onEditTodo}
            />
          ))
        )}
      </div>
    </div>
  );
}
