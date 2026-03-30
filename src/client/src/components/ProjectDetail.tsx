import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { Project, Todo, Pipeline, Schedule, TaskLog } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import * as projectsApi from '../api/projects';
import * as todosApi from '../api/todos';
import * as pipelinesApi from '../api/pipelines';
import * as schedulesApi from '../api/schedules';
import ProjectHeader from './ProjectHeader';
import TodoList from './TodoList';
import ProgressBar from './ProgressBar';
import { useI18n } from '../i18n';
import PipelineList from './PipelineList';
import ScheduleList from './ScheduleList';

interface ProjectDetailProps {
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  connected: boolean;
}

export default function ProjectDetail({ onEvent, connected }: ProjectDetailProps) {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [activeTab, setActiveTab] = useState<'tasks' | 'pipelines' | 'schedules'>('tasks');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const { t, toggleLang } = useI18n();

  useEffect(() => {
    if (!id) return;
    Promise.all([projectsApi.getProject(id), todosApi.getTodos(id), pipelinesApi.getPipelines(id), schedulesApi.getSchedules(id)])
      .then(([proj, todoList, pipelineList, scheduleList]) => {
        setProject(proj);
        setTodos(todoList);
        setPipelines(pipelineList);
        setSchedules(scheduleList);
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
      if (event.type === 'schedule:status-changed' && event.scheduleId) {
        setSchedules((prev) =>
          prev.map((s) =>
            s.id === event.scheduleId
              ? { ...s, is_active: event.isActive ? 1 : 0, updated_at: new Date().toISOString() }
              : s
          )
        );
      }
    });
  }, [onEvent]);

  const handleAddTodo = useCallback(async (title: string, description: string, cliTool?: string, cliModel?: string, images?: Array<{ name: string; data: string }>) => {
    if (!id) return;
    const newTodo = await todosApi.createTodo(id, { title, description, cli_tool: cliTool, cli_model: cliModel });
    if (images && images.length > 0) {
      const result = await todosApi.uploadTodoImages(newTodo.id, images.map(img => ({ name: img.name, data: img.data })));
      newTodo.images = JSON.stringify(result.images);
    }
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

  const handleRetryTodo = useCallback(async (todoId: string, mode?: 'headless' | 'interactive' | 'streaming') => {
    const updated = await todosApi.retryTodo(todoId, mode);
    setTodos((prev) =>
      prev.map((t) => (t.id === todoId ? updated : t))
    );
  }, []);

  const handleFixTodo = useCallback(async (failedTodo: Todo, errorLogs: TaskLog[]) => {
    if (!id) return;
    const errorSummary = errorLogs.map(l => l.message).join('\n');
    const fixDescription = `The previous task "${failedTodo.title}" failed with the following errors:\n\n---\n${errorSummary}\n---\n\nPlease analyze the failure above and fix the issue. The original task description was:\n${failedTodo.description || '(no description)'}`;
    const fixTitle = `[Fix] ${failedTodo.title}`;
    const newTodo = await todosApi.createTodo(id, {
      title: fixTitle.slice(0, 200),
      description: fixDescription,
      cli_tool: failedTodo.cli_tool ?? undefined,
      cli_model: failedTodo.cli_model ?? undefined,
    });
    setTodos((prev) => [...prev, newTodo]);
    // Auto-start the fix task
    try {
      const started = await todosApi.startTodo(newTodo.id, 'headless');
      setTodos((prev) => prev.map((t) => (t.id === newTodo.id ? started : t)));
    } catch {
      // Task created but not started - user can start manually
    }
  }, [id]);

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

  // Schedule handlers
  const handleAddSchedule = useCallback(async (title: string, description: string, cronExpression: string, cliTool?: string, cliModel?: string, skipIfRunning?: boolean) => {
    if (!id) return;
    const newSchedule = await schedulesApi.createSchedule(id, { title, description, cron_expression: cronExpression, cli_tool: cliTool, cli_model: cliModel, skip_if_running: skipIfRunning });
    setSchedules((prev) => [newSchedule, ...prev]);
  }, [id]);

  const handleToggleSchedule = useCallback(async (scheduleId: string, activate: boolean) => {
    const updated = activate
      ? await schedulesApi.activateSchedule(scheduleId)
      : await schedulesApi.pauseSchedule(scheduleId);
    setSchedules((prev) => prev.map((s) => (s.id === scheduleId ? updated : s)));
  }, []);

  const handleDeleteSchedule = useCallback(async (scheduleId: string) => {
    await schedulesApi.deleteSchedule(scheduleId);
    setSchedules((prev) => prev.filter((s) => s.id !== scheduleId));
  }, []);

  const handleEditSchedule = useCallback(async (scheduleId: string, updates: { title?: string; description?: string; cron_expression?: string; cli_tool?: string; cli_model?: string; skip_if_running?: boolean }) => {
    const updated = await schedulesApi.updateSchedule(scheduleId, updates);
    setSchedules((prev) => prev.map((s) => (s.id === scheduleId ? updated : s)));
  }, []);

  const handleTriggerSchedule = useCallback(async (scheduleId: string) => {
    await schedulesApi.triggerSchedule(scheduleId);
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
      <div className="flex gap-0 mb-4 border-b border-warm-200">
        <button
          onClick={() => setActiveTab('tasks')}
          className={`px-5 py-2.5 text-xs font-semibold tracking-wider uppercase border-b-2 -mb-px transition-colors ${
            activeTab === 'tasks'
              ? 'text-accent-gold border-accent-gold'
              : 'text-warm-400 border-transparent hover:text-warm-600'
          }`}
        >
          {t('tabs.tasks')} ({todos.length})
        </button>
        <button
          onClick={() => setActiveTab('pipelines')}
          className={`px-5 py-2.5 text-xs font-semibold tracking-wider uppercase border-b-2 -mb-px transition-colors ${
            activeTab === 'pipelines'
              ? 'text-accent-gold border-accent-gold'
              : 'text-warm-400 border-transparent hover:text-warm-600'
          }`}
        >
          {t('tabs.pipelines')} ({pipelines.length})
        </button>
        <button
          onClick={() => setActiveTab('schedules')}
          className={`px-5 py-2.5 text-xs font-semibold tracking-wider uppercase border-b-2 -mb-px transition-colors ${
            activeTab === 'schedules'
              ? 'text-accent-gold border-accent-gold'
              : 'text-warm-400 border-transparent hover:text-warm-600'
          }`}
        >
          {t('tabs.schedules')} ({schedules.length})
        </button>
      </div>

      {activeTab === 'tasks' && (
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
          onRetryTodo={handleRetryTodo}
          onFixTodo={handleFixTodo}
          onEvent={onEvent}
          onSendInput={() => {}}
          interactiveTodos={new Set<string>()}
        />
      )}
      {activeTab === 'pipelines' && (
        <PipelineList
          pipelines={pipelines}
          onAddPipeline={handleAddPipeline}
          onStartPipeline={handleStartPipeline}
          onStopPipeline={handleStopPipeline}
          onDeletePipeline={handleDeletePipeline}
        />
      )}
      {activeTab === 'schedules' && (
        <ScheduleList
          schedules={schedules}
          projectCliTool={project.cli_tool}
          projectCliModel={project.claude_model ?? undefined}
          onAddSchedule={handleAddSchedule}
          onToggleSchedule={handleToggleSchedule}
          onDeleteSchedule={handleDeleteSchedule}
          onEditSchedule={handleEditSchedule}
          onTriggerSchedule={handleTriggerSchedule}
        />
      )}
    </div>
  );
}
