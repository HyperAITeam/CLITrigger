import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { Project, Todo } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import * as projectsApi from '../api/projects';
import * as todosApi from '../api/todos';
import ProjectHeader from './ProjectHeader';
import TodoList from './TodoList';
import ProgressBar from './ProgressBar';

interface ProjectDetailProps {
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  connected: boolean;
}

export default function ProjectDetail({ onEvent, connected }: ProjectDetailProps) {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Fetch project and todos
  useEffect(() => {
    if (!id) return;
    Promise.all([projectsApi.getProject(id), todosApi.getTodos(id)])
      .then(([proj, todoList]) => {
        setProject(proj);
        setTodos(todoList);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  // Listen for real-time WebSocket events
  useEffect(() => {
    return onEvent((event) => {
      if (event.type === 'todo:status-changed' && event.todoId && event.status) {
        setTodos((prev) =>
          prev.map((t) =>
            t.id === event.todoId
              ? { ...t, status: event.status as Todo['status'], updated_at: new Date().toISOString() }
              : t
          )
        );
      }
    });
  }, [onEvent]);

  const handleAddTodo = useCallback(async (title: string, description: string) => {
    if (!id) return;
    const newTodo = await todosApi.createTodo(id, { title, description });
    setTodos((prev) => [...prev, newTodo]);
  }, [id]);

  const handleStartTodo = useCallback(async (todoId: string) => {
    await todosApi.startTodo(todoId);
    setTodos((prev) =>
      prev.map((t) =>
        t.id === todoId ? { ...t, status: 'running' as const, updated_at: new Date().toISOString() } : t
      )
    );
  }, []);

  const handleStopTodo = useCallback(async (todoId: string) => {
    await todosApi.stopTodo(todoId);
    setTodos((prev) =>
      prev.map((t) =>
        t.id === todoId ? { ...t, status: 'stopped' as const, updated_at: new Date().toISOString() } : t
      )
    );
  }, []);

  const handleDeleteTodo = useCallback(async (todoId: string) => {
    await todosApi.deleteTodo(todoId);
    setTodos((prev) => prev.filter((t) => t.id !== todoId));
  }, []);

  const handleEditTodo = useCallback(async (todoId: string, title: string, description: string) => {
    const updated = await todosApi.updateTodo(todoId, { title, description });
    setTodos((prev) => prev.map((t) => (t.id === todoId ? updated : t)));
  }, []);

  const handleMergeTodo = useCallback(async (todoId: string) => {
    await todosApi.mergeTodo(todoId);
    setTodos((prev) =>
      prev.map((t) =>
        t.id === todoId ? { ...t, status: 'merged' as const, updated_at: new Date().toISOString() } : t
      )
    );
  }, []);

  const handleStartAll = useCallback(async () => {
    if (!id) return;
    await projectsApi.startProject(id);
    // Optimistically mark startable todos as running
    setTodos((prev) =>
      prev.map((t) =>
        t.status === 'pending' || t.status === 'failed' || t.status === 'stopped'
          ? { ...t, status: 'running' as const, updated_at: new Date().toISOString() }
          : t
      )
    );
  }, [id]);

  const handleStopAll = useCallback(async () => {
    if (!id) return;
    await projectsApi.stopProject(id);
    setTodos((prev) =>
      prev.map((t) =>
        t.status === 'running'
          ? { ...t, status: 'stopped' as const, updated_at: new Date().toISOString() }
          : t
      )
    );
  }, [id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="text-center py-12 text-gray-400">Loading project...</div>
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="rounded-xl bg-gray-800 border border-gray-700 p-12 text-center">
          <p className="text-gray-400 text-lg">Project not found.</p>
          <Link
            to="/"
            className="mt-4 inline-block text-blue-400 hover:text-blue-300 transition-colors"
          >
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to projects
      </Link>

      {connected && (
        <span className="ml-3 inline-flex items-center gap-1 text-xs text-green-500">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          Live
        </span>
      )}

      <ProjectHeader
        project={project}
        todos={todos}
        onStartAll={handleStartAll}
        onStopAll={handleStopAll}
        onProjectUpdate={(updated) => setProject(updated)}
      />

      <ProgressBar todos={todos} />

      <TodoList
        todos={todos}
        onAddTodo={handleAddTodo}
        onStartTodo={handleStartTodo}
        onStopTodo={handleStopTodo}
        onDeleteTodo={handleDeleteTodo}
        onEditTodo={handleEditTodo}
        onMergeTodo={handleMergeTodo}
        onEvent={onEvent}
      />
    </div>
  );
}
