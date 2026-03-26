import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { Project, Todo, Pipeline } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import * as projectsApi from '../api/projects';
import * as todosApi from '../api/todos';
import * as pipelinesApi from '../api/pipelines';
import ProjectHeader from './ProjectHeader';
import TodoList from './TodoList';
import ProgressBar from './ProgressBar';
import { useI18n } from '../i18n';
import PipelineList from './PipelineList';

interface ProjectDetailProps {
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  connected: boolean;
}

export default function ProjectDetail({ onEvent, connected }: ProjectDetailProps) {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activeTab, setActiveTab] = useState<'tasks' | 'pipelines'>('tasks');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const { t, toggleLang } = useI18n();

  useEffect(() => {
    if (!id) return;
    Promise.all([projectsApi.getProject(id), todosApi.getTodos(id), pipelinesApi.getPipelines(id)])
      .then(([proj, todoList, pipelineList]) => {
        setProject(proj);
        setTodos(todoList);
        setPipelines(pipelineList);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    return onEvent((event) => {
      if (event.type === 'todo:status-changed' && event.todoId && event.status) {
        setTodos((prev) =>
          prev.map((t) => {
            if (t.id !== event.todoId) return t;
            const updates: Partial<Todo> = {
              status: event.status as Todo['status'],
              updated_at: new Date().toISOString(),
            };
            if (event.worktree_path !== undefined) updates.worktree_path = event.worktree_path ?? null;
            if (event.branch_name !== undefined) updates.branch_name = event.branch_name ?? null;
            return { ...t, ...updates };
          })
        );
      }
      if (event.type === 'pipeline:status-changed' && event.pipelineId) {
        setPipelines((prev) =>
          prev.map((p) =>
            p.id === event.pipelineId
              ? { ...p, status: event.status as Pipeline['status'], current_phase: event.currentPhase ?? null, updated_at: new Date().toISOString() }
              : p
          )
        );
      }
    });
  }, [onEvent]);

  const handleAddTodo = useCallback(async (title: string, description: string, cliTool?: string, cliModel?: string) => {
    if (!id) return;
    const newTodo = await todosApi.createTodo(id, { title, description, cli_tool: cliTool, cli_model: cliModel });
    setTodos((prev) => [...prev, newTodo]);
  }, [id]);

  const handleStartTodo = useCallback(async (todoId: string, mode?: 'headless' | 'interactive' | 'streaming') => {
    const updated = await todosApi.startTodo(todoId, mode);
    setTodos((prev) =>
      prev.map((t) => (t.id === todoId ? updated : t))
    );
  }, []);

  const handleStopTodo = useCallback(async (todoId: string) => {
    const updated = await todosApi.stopTodo(todoId);
    setTodos((prev) =>
      prev.map((t) => (t.id === todoId ? updated : t))
    );
  }, []);

  const handleDeleteTodo = useCallback(async (todoId: string) => {
    await todosApi.deleteTodo(todoId);
    setTodos((prev) => prev.filter((t) => t.id !== todoId));
  }, []);

  const handleEditTodo = useCallback(async (todoId: string, title: string, description: string, cliTool?: string, cliModel?: string) => {
    const updated = await todosApi.updateTodo(todoId, { title, description, cli_tool: cliTool, cli_model: cliModel });
    setTodos((prev) => prev.map((t) => (t.id === todoId ? updated : t)));
  }, []);

  const handleMergeTodo = useCallback(async (todoId: string) => {
    await todosApi.mergeTodo(todoId);
    setTodos((prev) =>
      prev.map((t) =>
        t.id === todoId ? { ...t, status: 'merged' as const, worktree_path: null, branch_name: null, updated_at: new Date().toISOString() } : t
      )
    );
  }, []);

  const handleCleanupTodo = useCallback(async (todoId: string) => {
    await todosApi.cleanupTodo(todoId);
    setTodos((prev) =>
      prev.map((t) =>
        t.id === todoId ? { ...t, worktree_path: null, branch_name: null, updated_at: new Date().toISOString() } : t
      )
    );
  }, []);

  // Pipeline handlers
  const handleAddPipeline = useCallback(async (title: string, description: string) => {
    if (!id) return;
    const newPipeline = await pipelinesApi.createPipeline(id, { title, description });
    setPipelines((prev) => [newPipeline, ...prev]);
  }, [id]);

  const handleStartPipeline = useCallback(async (pipelineId: string) => {
    await pipelinesApi.startPipeline(pipelineId);
    setPipelines((prev) =>
      prev.map((p) => p.id === pipelineId ? { ...p, status: 'running' as const, updated_at: new Date().toISOString() } : p)
    );
  }, []);

  const handleStopPipeline = useCallback(async (pipelineId: string) => {
    await pipelinesApi.stopPipeline(pipelineId);
    setPipelines((prev) =>
      prev.map((p) => p.id === pipelineId ? { ...p, status: 'paused' as const, updated_at: new Date().toISOString() } : p)
    );
  }, []);

  const handleDeletePipeline = useCallback(async (pipelineId: string) => {
    await pipelinesApi.deletePipeline(pipelineId);
    setPipelines((prev) => prev.filter((p) => p.id !== pipelineId));
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
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="text-center py-20 text-warm-500 animate-fade-in">
          {t('detail.loading')}
        </div>
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="card p-16 text-center animate-fade-in">
          <p className="text-status-error font-medium text-lg">{t('detail.notFound')}</p>
          <Link
            to="/"
            className="mt-4 inline-block text-sm text-accent-gold hover:text-accent-goldDark transition-colors"
          >
            {t('detail.backToProjects')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Navigation */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-warm-500 hover:text-accent-gold transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t('detail.back')}
        </Link>

        <span className="text-warm-300">/</span>
        <span className="text-sm text-warm-700 truncate font-medium">{project.name}</span>

        <div className="ml-auto flex items-center gap-3">
          {connected && (
            <span className="inline-flex items-center gap-1.5 text-xs text-status-success">
              <span className="h-1.5 w-1.5 rounded-full bg-status-success animate-pulse" />
              {t('detail.live')}
            </span>
          )}
          <button onClick={toggleLang} className="lang-toggle">
            {t('lang.toggle')}
          </button>
        </div>
      </div>

      <ProjectHeader
        project={project}
        todos={todos}
        onStartAll={handleStartAll}
        onStopAll={handleStopAll}
        onProjectUpdate={(updated) => setProject(updated)}
      />

      <ProgressBar todos={todos} />

      {/* Tab toggle */}
      <div className="flex gap-0 mb-4 border-b-2 border-street-700">
        <button
          onClick={() => setActiveTab('tasks')}
          className={`px-5 py-2.5 text-xs font-mono font-bold tracking-[0.15em] uppercase border-b-2 -mb-0.5 transition-colors ${
            activeTab === 'tasks'
              ? 'text-neon-green border-neon-green'
              : 'text-street-500 border-transparent hover:text-street-300'
          }`}
        >
          TASKS ({todos.length})
        </button>
        <button
          onClick={() => setActiveTab('pipelines')}
          className={`px-5 py-2.5 text-xs font-mono font-bold tracking-[0.15em] uppercase border-b-2 -mb-0.5 transition-colors ${
            activeTab === 'pipelines'
              ? 'text-neon-cyan border-neon-cyan'
              : 'text-street-500 border-transparent hover:text-street-300'
          }`}
        >
          PIPELINES ({pipelines.length})
        </button>
      </div>

      {activeTab === 'tasks' ? (
        <TodoList
          todos={todos}
          projectCliTool={project.cli_tool}
          projectCliModel={project.claude_model ?? undefined}
          onAddTodo={handleAddTodo}
          onStartTodo={handleStartTodo}
          onStopTodo={handleStopTodo}
          onDeleteTodo={handleDeleteTodo}
          onEditTodo={handleEditTodo}
          onMergeTodo={handleMergeTodo}
          onCleanupTodo={handleCleanupTodo}
          onEvent={onEvent}
          onSendInput={() => {}}
          interactiveTodos={new Set<string>()}
        />
      ) : (
        <PipelineList
          pipelines={pipelines}
          onAddPipeline={handleAddPipeline}
          onStartPipeline={handleStartPipeline}
          onStopPipeline={handleStopPipeline}
          onDeletePipeline={handleDeletePipeline}
        />
      )}
    </div>
  );
}
