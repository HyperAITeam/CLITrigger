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
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="text-center py-20 font-mono text-neon-green animate-flicker">
          LOADING<span className="animate-pulse">_</span>
        </div>
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="street-card p-16 text-center">
          <p className="text-neon-pink font-mono text-lg">// ERROR: PROJECT NOT FOUND</p>
          <Link
            to="/"
            className="mt-6 inline-block font-mono text-sm text-neon-green hover:underline"
          >
            &lt;-- BACK TO PROJECTS
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* Navigation */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 font-mono text-xs text-street-400 hover:text-neon-green transition-colors tracking-wider uppercase"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          PROJECTS
        </Link>

        <span className="text-street-600 font-mono">/</span>
        <span className="font-mono text-xs text-street-300 truncate">{project.name}</span>

        {connected && (
          <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-xs text-neon-green">
            <span className="h-1.5 w-1.5 bg-neon-green animate-pulse" />
            LIVE
          </span>
        )}
      </div>

      <div className="h-px bg-gradient-to-r from-neon-green/50 via-street-600 to-transparent mb-6" />

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
