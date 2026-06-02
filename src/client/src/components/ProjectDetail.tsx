import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import type { Project, Todo, Schedule, Discussion, Session, TaskLog, PlannerItem, PlannerTag } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import * as projectsApi from '../api/projects';
import * as todosApi from '../api/todos';
import * as schedulesApi from '../api/schedules';
import * as discussionsApi from '../api/discussions';
import * as sessionsApi from '../api/sessions';
import * as plannerApi from '../api/planner';
import { Skeleton } from './Skeleton';
import ProjectHeader from './ProjectHeader';
import TodoList from './TodoList';
import ProgressBar from './ProgressBar';
import { useI18n } from '../i18n';
import { useNotification } from '../hooks/useNotification';
import ScheduleList from './ScheduleList';
import GitStatusPanel from './GitStatusPanel';
import SvnStatusPanel from './SvnStatusPanel';
import DiscussionList from './DiscussionList';
import SessionList from './SessionList';
import SessionWindowsHost from './SessionWindowsHost';
import AnalyticsPanel from './AnalyticsPanel';
import PlannerList from './PlannerList';
import MemoryList from './MemoryList';
import VaultLayout from './vault/VaultLayout';
import { getPluginsWithTabs } from '../plugins/registry';

interface ProjectDetailProps {
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  connected: boolean;
  sendMessage: (event: object) => void;
  subscribeBinary: (sessionId: string, cb: (payload: Uint8Array) => void) => () => void;
}

function TabHoverHelp({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children: React.ReactNode;
}) {
  const enabled = !!body && body.trim().length > 0;
  const [open, setOpen] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const openTimer = useRef<number | null>(null);

  const updatePos = useCallback(() => {
    if (!anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pop = popRef.current;
    const pw = pop?.offsetWidth ?? 288;
    const ph = pop?.offsetHeight ?? 120;
    let top = r.bottom + 6;
    let left = r.left;
    if (left + pw > vw - 8) left = vw - 8 - pw;
    if (left < 8) left = 8;
    if (top + ph > vh - 8) top = r.top - ph - 6;
    if (top < 8) top = 8;
    setPos({ top, left });
    setPositioned(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setPositioned(false);
      return;
    }
    updatePos();
    const raf = requestAnimationFrame(updatePos);
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, updatePos]);

  useEffect(() => () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
  }, []);

  if (!enabled) return <>{children}</>;

  const scheduleOpen = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => setOpen(true), 250);
  };
  const cancelOpen = () => {
    if (openTimer.current) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    setOpen(false);
  };

  return (
    <>
      <div
        ref={anchorRef}
        onMouseEnter={scheduleOpen}
        onMouseLeave={cancelOpen}
        onFocus={scheduleOpen}
        onBlur={cancelOpen}
      >
        {children}
      </div>
      {open && createPortal(
        <div
          ref={popRef}
          role="tooltip"
          className="fixed w-72 p-3 rounded-lg shadow-elevated text-xs leading-relaxed z-tooltip pointer-events-none"
          style={{
            top: pos.top,
            left: pos.left,
            opacity: positioned ? 1 : 0,
            backgroundColor: 'var(--color-bg-card)',
            borderColor: 'var(--color-border)',
            borderWidth: '1px',
            color: 'var(--color-text-primary)',
            transition: 'opacity 120ms ease-out',
          }}
        >
          <div className="font-semibold mb-1">{title}</div>
          <p style={{ color: 'var(--color-text-secondary)' }}>{body}</p>
        </div>,
        document.body,
      )}
    </>
  );
}

export default function ProjectDetail({ onEvent, connected, sendMessage, subscribeBinary }: ProjectDetailProps) {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [resetsAt, setResetsAt] = useState<number | null>(null);
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [plannerItems, setPlannerItems] = useState<PlannerItem[]>([]);
  const [plannerTags, setPlannerTags] = useState<PlannerTag[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  // Tasks/Discussions/Schedules are unified under one "automation" hub tab
  // with inner sub-tabs. The URL `tab` param still stores the sub value
  // (tasks → no param) so existing deep links keep working.
  const AUTOMATION_SUBS = ['tasks', 'discussions', 'schedules'];
  const rawTab = searchParams.get('tab') || 'tasks';
  const [activeTab, _setActiveTab] = useState<string>(
    AUTOMATION_SUBS.includes(rawTab) ? 'automation' : rawTab
  );
  const [automationSub, setAutomationSubState] = useState<string>(
    AUTOMATION_SUBS.includes(rawTab) ? rawTab : 'tasks'
  );
  const setActiveTab = useCallback((tab: string) => {
    if (tab === 'automation') {
      _setActiveTab('automation');
      setSearchParams(automationSub === 'tasks' ? {} : { tab: automationSub }, { replace: true });
      return;
    }
    _setActiveTab(tab);
    setSearchParams(tab === 'tasks' ? {} : { tab }, { replace: true });
  }, [setSearchParams, automationSub]);
  const setAutomationSub = useCallback((sub: string) => {
    _setActiveTab('automation');
    setAutomationSubState(sub);
    setSearchParams(sub === 'tasks' ? {} : { tab: sub }, { replace: true });
  }, [setSearchParams]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [interactiveTodos, setInteractiveTodos] = useState<Set<string>>(new Set());
  const [gitRefreshTrigger, setGitRefreshTrigger] = useState(0);
  const { t } = useI18n();
  const { sendNotification } = useNotification();
  const discussionsRef = useRef<Discussion[]>([]);
  useEffect(() => { discussionsRef.current = discussions; }, [discussions]);

  useEffect(() => {
    if (!id) return;
    Promise.all([projectsApi.getProject(id), todosApi.getTodos(id), schedulesApi.getSchedules(id), discussionsApi.getDiscussions(id), schedulesApi.getRateLimit(), sessionsApi.getSessions(id), plannerApi.getPlannerItems(id), plannerApi.getPlannerTags(id)])
      .then(([proj, todoList, scheduleList, discussionList, rateLimitData, sessionList, plannerList, tags]) => {
        setProject(proj);
        setTodos(todoList);
        setSchedules(scheduleList);
        setDiscussions(discussionList);
        setSessions(sessionList);
        setPlannerItems(plannerList);
        setPlannerTags(tags);
        if (rateLimitData.resetsAt) setResetsAt(rateLimitData.resetsAt);
        // Restore interactive mode state for running todos
        const interactiveIds = todoList
          .filter((t: { status: string; execution_mode: string | null }) => t.status === 'running' && t.execution_mode === 'interactive')
          .map((t: { id: string }) => t.id);
        if (interactiveIds.length > 0) {
          setInteractiveTodos(new Set(interactiveIds));
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  // Poll running todos as fallback in case WebSocket status events are missed
  const todosRef = useRef(todos);
  todosRef.current = todos;
  useEffect(() => {
    if (!id) return;
    const interval = setInterval(() => {
      const hasRunning = todosRef.current.some((t) => t.status === 'running');
      if (!hasRunning) return;
      todosApi.getTodos(id).then((fresh) => {
        setTodos((prev) => prev.map((t) => {
          const f = fresh.find((x) => x.id === t.id);
          return f && f.status !== t.status ? f : t;
        }));
      }).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [id]);

  // Re-fetch data on WebSocket reconnection to catch missed status updates
  const prevConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !prevConnectedRef.current && id) {
      Promise.all([todosApi.getTodos(id), schedulesApi.getSchedules(id), discussionsApi.getDiscussions(id)])
        .then(([todoList, scheduleList, discussionList]) => {
          setTodos(todoList);
          setSchedules(scheduleList);
          setDiscussions(discussionList);
        })
        .catch(() => {});
    }
    prevConnectedRef.current = connected;
  }, [connected, id]);

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
        // Trigger git panel refresh when tasks complete
        if (event.status === 'completed' || event.status === 'merged' || event.status === 'failed') {
          setGitRefreshTrigger(prev => prev + 1);
        }
        // Browser notification
        if (event.status === 'completed' || event.status === 'failed') {
          const todo = todosRef.current.find(t => t.id === event.todoId);
          if (todo) {
            sendNotification(
              event.status === 'completed' ? t('notification.taskCompleted') : t('notification.taskFailed'),
              todo.title
            );
          }
        }
        // Track interactive mode todos
        if (event.status === 'running' && event.mode === 'interactive') {
          setInteractiveTodos((prev) => new Set(prev).add(event.todoId!));
        } else if (event.status !== 'running') {
          setInteractiveTodos((prev) => {
            const next = new Set(prev);
            next.delete(event.todoId!);
            return next;
          });
        }
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
      if (event.type === 'rate-limit:updated' && event.resetsAt) {
        setResetsAt(event.resetsAt as number);
      }
      if (event.type === 'discussion:status-changed' && event.discussionId) {
        setDiscussions((prev) =>
          prev.map((d) =>
            d.id === event.discussionId
              ? { ...d, status: event.status as Discussion['status'], current_round: event.currentRound ?? d.current_round, updated_at: new Date().toISOString() }
              : d
          )
        );
        if (event.status === 'completed' || event.status === 'failed') {
          const disc = discussionsRef.current.find(d => d.id === event.discussionId);
          if (disc) {
            sendNotification(
              event.status === 'completed' ? t('notification.discussionCompleted') : t('notification.discussionFailed'),
              disc.title
            );
          }
        }
      }
      if (event.type === 'session:status-changed' && event.sessionId) {
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== event.sessionId) return s;
            const patch: Partial<Session> = {
              status: event.status as Session['status'],
              updated_at: new Date().toISOString(),
            };
            // Server attaches worktree_path/branch_name when transitioning to
            // 'running' so the freshly-created worktree handles propagate to
            // the session list — without this, cleanup button stays hidden
            // because the optimistic add-row had both fields null.
            if (event.worktree_path !== undefined) patch.worktree_path = event.worktree_path;
            if (event.branch_name !== undefined) patch.branch_name = event.branch_name;
            return { ...s, ...patch };
          })
        );
      }
    });
  }, [onEvent, sendNotification, t]);

  const handleAddTodo = useCallback(async (title: string, description: string, cliTool?: string, cliModel?: string, images?: Array<{ name: string; data: string }>, dependsOn?: string, maxTurns?: number, useWorktree?: number | null, memoryInjectMode?: 'none' | 'all' | 'selected' | 'auto', memoryNodeIds?: string[], memoryRawFilePaths?: string[]) => {
    if (!id) return;
    const newTodo = await todosApi.createTodo(id, {
      title, description, cli_tool: cliTool, cli_model: cliModel,
      depends_on: dependsOn, max_turns: maxTurns ?? null, use_worktree: useWorktree ?? null,
      ...(memoryInjectMode ? { memory_inject_mode: memoryInjectMode } : {}),
      ...(memoryNodeIds ? { memory_node_ids: memoryNodeIds } : {}),
      ...(memoryRawFilePaths ? { memory_raw_file_paths: memoryRawFilePaths } : {}),
    });
    if (images && images.length > 0) {
      const result = await todosApi.uploadTodoImages(newTodo.id, images.map(img => ({ name: img.name, data: img.data })));
      newTodo.images = JSON.stringify(result.images);
    }
    setTodos((prev) => [...prev, newTodo]);
  }, [id]);

  const handleStartTodo = useCallback(async (todoId: string, mode?: 'headless' | 'interactive' | 'verbose') => {
    const shouldTrackInteractive = mode === 'interactive';
    if (shouldTrackInteractive) {
      setInteractiveTodos((prev) => new Set(prev).add(todoId));
    }
    try {
      const updated = await todosApi.startTodo(todoId, mode);
      setTodos((prev) =>
        prev.map((t) => (t.id === todoId ? updated : t))
      );
    } catch (err) {
      if (shouldTrackInteractive) {
        setInteractiveTodos((prev) => {
          const next = new Set(prev);
          next.delete(todoId);
          return next;
        });
      }
      throw err;
    }
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

  const handleEditTodo = useCallback(async (todoId: string, title: string, description: string, cliTool?: string, cliModel?: string, dependsOn?: string, maxTurns?: number, useWorktree?: number | null, memoryInjectMode?: 'none' | 'all' | 'selected' | 'auto', memoryNodeIds?: string[], memoryRawFilePaths?: string[]) => {
    const updated = await todosApi.updateTodo(todoId, {
      title, description, cli_tool: cliTool, cli_model: cliModel,
      depends_on: dependsOn ?? null, max_turns: maxTurns ?? null,
      use_worktree: useWorktree === undefined ? null : useWorktree,
      ...(memoryInjectMode ? { memory_inject_mode: memoryInjectMode } : {}),
      ...(memoryNodeIds ? { memory_node_ids: memoryNodeIds } : {}),
      ...(memoryRawFilePaths ? { memory_raw_file_paths: memoryRawFilePaths } : {}),
    });
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

  const handleMergeChain = useCallback(async (rootTodoId: string) => {
    const result = await todosApi.mergeChain(rootTodoId);
    const mergedIds = new Set(result.mergedIds);
    setTodos((prev) =>
      prev.map((t) =>
        mergedIds.has(t.id) ? { ...t, status: 'merged' as const, worktree_path: null, branch_name: null, updated_at: new Date().toISOString() } : t
      )
    );
  }, []);

  const handleCleanupTodo = useCallback(async (todoId: string, deleteBranch: boolean = false) => {
    await todosApi.cleanupTodo(todoId, deleteBranch);
    setTodos((prev) =>
      prev.map((t) =>
        t.id === todoId
          ? { ...t, worktree_path: null, ...(deleteBranch ? { branch_name: null } : {}), updated_at: new Date().toISOString() }
          : t
      )
    );
  }, []);

  const handleRetryTodo = useCallback(async (todoId: string, mode?: 'headless' | 'interactive' | 'verbose') => {
    const shouldTrackInteractive = mode === 'interactive';
    if (shouldTrackInteractive) {
      setInteractiveTodos((prev) => new Set(prev).add(todoId));
    }
    try {
      const updated = await todosApi.retryTodo(todoId, mode);
      setTodos((prev) =>
        prev.map((t) => (t.id === todoId ? updated : t))
      );
    } catch (err) {
      if (shouldTrackInteractive) {
        setInteractiveTodos((prev) => {
          const next = new Set(prev);
          next.delete(todoId);
          return next;
        });
      }
      throw err;
    }
  }, []);

  const handleContinueTodo = useCallback(async (todoId: string, prompt: string, mode?: 'headless' | 'interactive' | 'verbose') => {
    const shouldTrackInteractive = mode === 'interactive';
    if (shouldTrackInteractive) {
      setInteractiveTodos((prev) => new Set(prev).add(todoId));
    }
    try {
      const updated = await todosApi.continueTodo(todoId, prompt, mode);
      setTodos((prev) => prev.map((t) => (t.id === todoId ? updated : t)));
    } catch (err) {
      if (shouldTrackInteractive) {
        setInteractiveTodos((prev) => {
          const next = new Set(prev);
          next.delete(todoId);
          return next;
        });
      }
      throw err;
    }
  }, []);

  const handleScheduleTodo = useCallback(async (todoId: string, runAt: string, keepOriginal?: boolean) => {
    const result = await schedulesApi.scheduleFromTodo(todoId, runAt, keepOriginal);
    if (result.original_deleted) {
      setTodos((prev) => prev.filter((t) => t.id !== todoId));
    }
    setSchedules((prev) => [result.schedule, ...prev]);
  }, []);

  const handleScheduleOnReset = useCallback(async (todoId: string, prompt: string) => {
    const result = await schedulesApi.scheduleOnReset(todoId, prompt);
    setSchedules((prev) => [result.schedule, ...prev]);
  }, []);

  const handleSendInput = useCallback((todoId: string, input: string) => {
    sendMessage({ type: 'todo:stdin', todoId, input });
  }, [sendMessage]);

  const handleUpdateDependency = useCallback(async (todoId: string, dependsOnId: string | null) => {
    const updated = await todosApi.updateTodo(todoId, { depends_on: dependsOnId });
    setTodos((prev) => prev.map((t) => (t.id === todoId ? updated : t)));
  }, []);

  const handleReorderTodos = useCallback(async (orderedIds: string[]) => {
    // Client sorts ascending by priority, so assign 0..N-1 matching new order.
    const updates = orderedIds.map((id, idx) => ({ id, priority: idx }));
    setTodos(prev => prev.map(t => {
      const u = updates.find(u => u.id === t.id);
      return u ? { ...t, priority: u.priority } : t;
    }));
    await Promise.all(updates.map(u => todosApi.updateTodo(u.id, { priority: u.priority })));
  }, []);

  const handleUpdatePosition = useCallback(async (todoId: string, x: number, y: number) => {
    await todosApi.updateTodo(todoId, { position_x: x, position_y: y });
    setTodos((prev) => prev.map((t) => (t.id === todoId ? { ...t, position_x: x, position_y: y } : t)));
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

  // Schedule handlers
  const handleAddSchedule = useCallback(async (data: {
    title: string;
    description: string;
    cronExpression: string;
    cliTool?: string;
    cliModel?: string;
    skipIfRunning?: boolean;
    scheduleType: 'recurring' | 'once';
    runAt?: string;
  }) => {
    if (!id) return;
    const newSchedule = await schedulesApi.createSchedule(id, {
      title: data.title,
      description: data.description,
      cron_expression: data.cronExpression || undefined,
      cli_tool: data.cliTool,
      cli_model: data.cliModel,
      skip_if_running: data.skipIfRunning,
      schedule_type: data.scheduleType,
      run_at: data.runAt,
    });
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

  // Planner handlers
  const handleAddPlannerItem = useCallback(async (data: { title: string; description?: string; tags?: string; due_date?: string; priority?: number }): Promise<PlannerItem> => {
    if (!id) throw new Error('No project id');
    const item = await plannerApi.createPlannerItem(id, data);
    setPlannerItems((prev) => [item, ...prev]);
    if (data.tags) {
      const tags = await plannerApi.getPlannerTags(id);
      setPlannerTags(tags);
    }
    return item;
  }, [id]);

  const handleEditPlannerItem = useCallback(async (itemId: string, data: { title?: string; description?: string; tags?: string; due_date?: string; status?: string; priority?: number }) => {
    const updated = await plannerApi.updatePlannerItem(itemId, data);
    setPlannerItems((prev) => prev.map((i) => (i.id === itemId ? updated : i)));
  }, []);

  const handleDeletePlannerItem = useCallback(async (itemId: string) => {
    await plannerApi.deletePlannerItem(itemId);
    setPlannerItems((prev) => prev.filter((i) => i.id !== itemId));
  }, []);

  const handleConvertPlannerToTodo = useCallback(async (itemId: string, data: Record<string, unknown>) => {
    const result = await plannerApi.convertToTodo(itemId, data as { cli_tool?: string; cli_model?: string; max_turns?: number });
    setPlannerItems((prev) => prev.map((i) => (i.id === itemId ? result.plannerItem : i)));
    setTodos((prev) => [...prev, result.todo]);
  }, []);

  const handleConvertPlannerToSchedule = useCallback(async (itemId: string, data: Record<string, unknown>) => {
    const result = await plannerApi.convertToSchedule(itemId, data as { cron_expression?: string; schedule_type: 'recurring' | 'once'; run_at?: string; cli_tool?: string; cli_model?: string });
    setPlannerItems((prev) => prev.map((i) => (i.id === itemId ? result.plannerItem : i)));
    setSchedules((prev) => [result.schedule, ...prev]);
  }, []);

  const handleConvertPlannerToSession = useCallback(async (itemId: string, data: Record<string, unknown>) => {
    const result = await plannerApi.convertToSession(itemId, data as { cli_tool?: string; cli_model?: string; use_worktree?: boolean });
    setPlannerItems((prev) => prev.map((i) => (i.id === itemId ? result.plannerItem : i)));
    setSessions((prev) => [result.session, ...prev]);
  }, []);

  const handleUpdatePlannerTag = useCallback(async (name: string, data: { color?: string; new_name?: string }) => {
    if (!id) return;
    const updatedTags = await plannerApi.updatePlannerTag(id, name, data);
    setPlannerTags(updatedTags);
    // If renamed, also refresh items to get updated tag names
    if (data.new_name && data.new_name !== name) {
      const items = await plannerApi.getPlannerItems(id);
      setPlannerItems(items);
    }
  }, [id]);

  const handleDeletePlannerTag = useCallback(async (name: string) => {
    if (!id) return;
    await plannerApi.deletePlannerTag(id, name);
    // Refresh both tags and items
    const [tags, items] = await Promise.all([plannerApi.getPlannerTags(id), plannerApi.getPlannerItems(id)]);
    setPlannerTags(tags);
    setPlannerItems(items);
  }, [id]);

  const handleExportPlanner = useCallback(async () => {
    if (!id) return;
    try {
      const { blob, filename } = await plannerApi.exportPlanner(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const hasImages = plannerItems.some((i) => i.images);
      if (hasImages) {
        window.alert(t('planner.importNoImages'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      window.alert(`${t('planner.exportError')}: ${msg}`);
    }
  }, [id, plannerItems, t]);

  const handleImportPlanner = useCallback(async (file: File) => {
    if (!id) return;
    try {
      const markdown = await file.text();
      if (!markdown.trim()) {
        throw new Error(t('planner.importInvalidMarkdown'));
      }
      const result = await plannerApi.importPlanner(id, markdown);
      const [tags, items] = await Promise.all([plannerApi.getPlannerTags(id), plannerApi.getPlannerItems(id)]);
      setPlannerTags(tags);
      setPlannerItems(items);
      window.alert(t('planner.importSuccess').replace('{items}', String(result.imported_items)).replace('{tags}', String(result.imported_tags)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      window.alert(`${t('planner.importError')}: ${msg}`);
    }
  }, [id, t]);

  // Discussion handlers
  const handleAddDiscussion = useCallback((discussion: Discussion) => {
    setDiscussions((prev) => [discussion, ...prev]);
  }, []);

  const handleStartDiscussion = useCallback(async (discussionId: string) => {
    await discussionsApi.startDiscussion(discussionId);
    setDiscussions((prev) =>
      prev.map((d) => d.id === discussionId ? { ...d, status: 'running' as const, updated_at: new Date().toISOString() } : d)
    );
  }, []);

  const handleStopDiscussion = useCallback(async (discussionId: string) => {
    await discussionsApi.stopDiscussion(discussionId);
    setDiscussions((prev) =>
      prev.map((d) => d.id === discussionId ? { ...d, status: 'paused' as const, updated_at: new Date().toISOString() } : d)
    );
  }, []);

  const handleDeleteDiscussion = useCallback(async (discussionId: string) => {
    await discussionsApi.deleteDiscussion(discussionId);
    setDiscussions((prev) => prev.filter((d) => d.id !== discussionId));
  }, []);

  // Session handlers
  const handleAddSession = useCallback((session: Session) => {
    setSessions((prev) => [session, ...prev]);
  }, []);

  const handleUpdateSession = useCallback((session: Session) => {
    setSessions((prev) => prev.map((s) => (s.id === session.id ? session : s)));
  }, []);

  // Note: starting a session is initiated from the floating SessionWindow
  // itself (it knows xterm.js cols/rows after fit), so there's no
  // handleStartSession here — the SessionWindow calls sessionsApi.startSession
  // directly and ProjectDetail picks up the resulting `session:status-changed`
  // WS event in the effect above.

  const handleStopSession = useCallback(async (sessionId: string) => {
    await sessionsApi.stopSession(sessionId);
    setSessions((prev) =>
      prev.map((s) => s.id === sessionId ? { ...s, status: 'stopped' as const, updated_at: new Date().toISOString() } : s)
    );
  }, []);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    await sessionsApi.deleteSession(sessionId);
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
  }, []);

  const handleCleanupSession = useCallback(async (sessionId: string, deleteBranch: boolean) => {
    const res = await sessionsApi.cleanupSession(sessionId, deleteBranch);
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        const patch: Partial<typeof s> = {};
        if (res.worktreeRemoved) patch.worktree_path = null;
        if (deleteBranch && res.branchDeleted) patch.branch_name = null;
        return { ...s, ...patch };
      })
    );
    // Surface partial failures so the user knows git still has the branch/worktree.
    const failures: string[] = [];
    if (!res.worktreeRemoved) failures.push(`worktree: ${res.worktreeError || 'unknown error'}`);
    if (deleteBranch && !res.branchDeleted) failures.push(`branch: ${res.branchError || 'unknown error'}`);
    if (failures.length > 0) {
      alert(`Cleanup partially failed:\n${failures.join('\n')}`);
    }
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
      <div className="px-6 py-6 sm:px-8 sm:py-8 space-y-6">
        {/* Header Skeleton */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-24" />
          </div>
        </div>

        {/* Progress Bar Skeleton */}
        <div className="space-y-2">
          <div className="flex justify-between">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-12" />
          </div>
          <Skeleton className="h-3 w-full rounded-full" />
        </div>

        {/* Tabs Skeleton */}
        <div className="flex gap-4 border-b border-theme-border pb-px">
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-24" />
        </div>

        {/* Content Skeleton */}
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card p-4 space-y-3">
              <div className="flex justify-between">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-5 w-20" />
              </div>
              <Skeleton className="h-4 w-2/3" />
              <div className="flex gap-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className="px-6 py-6 sm:px-8 sm:py-8">
        <div className="card p-16 text-center animate-fade-in">
          <p className="text-status-error font-medium text-lg">{t('detail.notFound')}</p>
          <Link
            to="/"
            className="mt-4 inline-block text-sm text-accent hover:text-accent-dark transition-colors"
          >
            {t('detail.backToProjects')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <SessionWindowsHost
      // Remount per-project so the host's groups state + localStorage
      // hydration are isolated by project. Without this, the same host
      // instance handles A → B → A navigation and ends up writing one
      // project's groups to another's localStorage key.
      key={id!}
      projectId={id!}
      sessions={sessions}
      sendMessage={sendMessage}
      subscribeBinary={subscribeBinary}
      onEvent={onEvent}
      onAddSession={handleAddSession}
    >
    <div className="px-6 py-6 sm:px-8 sm:py-8">
      <ProjectHeader
        project={project}
        todos={todos}
        onProjectUpdate={(updated) => setProject(updated)}
      />

      {/* Segmented tab control */}
      <div className="flex gap-0.5 mb-5 p-1 rounded-xl overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-1" style={{ backgroundColor: 'var(--color-bg-tertiary)' }}>
        {[
          { key: 'files', label: t('tabs.files'), help: t('tabs.files.help') },
          { key: 'planner', label: t('tabs.planner'), help: t('tabs.planner.help'), count: plannerItems.length },
          { key: 'sessions', label: t('tabs.sessions'), help: t('tabs.sessions.help'), count: sessions.length },
          ...getPluginsWithTabs(project).map((plugin) => {
            const helpKey = `tabs.${plugin.id}.help`;
            const help = t(helpKey);
            return {
              key: plugin.id,
              label: t(`tabs.${plugin.id}`) || plugin.displayName,
              help: help === helpKey ? '' : help,
            };
          }),
          { key: 'automation', label: t('tabs.automation'), help: t('tabs.automation.help'), count: todos.length + discussions.length + schedules.length },
          ...(project.is_git_repo ? [{ key: 'git', label: t('tabs.git'), help: t('tabs.git.help') }] : []),
          ...(project.svn_enabled ? [{ key: 'svn', label: t('tabs.svn'), help: t('tabs.svn.help') }] : []),
          { key: 'analytics', label: t('tabs.analytics'), help: t('tabs.analytics.help') },
        ].map((tab) => (
          <TabHoverHelp key={tab.key} title={tab.label} body={tab.help}>
            <button
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 sm:px-4 py-1.5 sm:py-2 text-xs whitespace-nowrap rounded-lg transition-all duration-200 ${
                activeTab === tab.key
                  ? 'text-warm-800 font-semibold shadow-soft'
                  : 'text-warm-500 font-normal hover:text-warm-600'
              }`}
              style={activeTab === tab.key ? { backgroundColor: 'var(--color-bg-card)' } : undefined}
            >
              {tab.label}
              {'count' in tab && typeof tab.count === 'number' && (
                <span className={`ml-1 ${activeTab === tab.key ? 'text-warm-500' : 'text-warm-400'}`}>
                  {tab.count}
                </span>
              )}
            </button>
          </TabHoverHelp>
        ))}
      </div>

      {/* Automation hub: inner sub-tabs for Tasks / Discussions / Schedules */}
      {activeTab === 'automation' && (
        <div className="flex gap-0.5 mb-4 p-1 rounded-xl w-fit overflow-x-auto" style={{ backgroundColor: 'var(--color-bg-tertiary)' }}>
          {[
            { key: 'tasks', label: t('tabs.tasks'), count: todos.length },
            { key: 'discussions', label: t('tabs.discussions'), count: discussions.length },
            { key: 'schedules', label: t('tabs.schedules'), count: schedules.length },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => setAutomationSub(s.key)}
              className={`px-3 sm:px-4 py-1.5 sm:py-2 text-xs whitespace-nowrap rounded-lg transition-all duration-200 ${
                automationSub === s.key
                  ? 'text-warm-800 font-semibold shadow-soft'
                  : 'text-warm-500 font-normal hover:text-warm-600'
              }`}
              style={automationSub === s.key ? { backgroundColor: 'var(--color-bg-card)' } : undefined}
            >
              {s.label}
              <span className={`ml-1 ${automationSub === s.key ? 'text-warm-500' : 'text-warm-400'}`}>
                {s.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {activeTab === 'automation' && automationSub === 'tasks' && (
        <TodoList
          todos={todos}
          projectId={id}
          projectCliTool={project.cli_tool}
          projectCliModel={project.claude_model ?? undefined}
          projectIsGitRepo={!!project.is_git_repo}
          projectUseWorktree={project.use_worktree !== 0}
          onAddTodo={handleAddTodo}
          onStartAll={handleStartAll}
          onStopAll={handleStopAll}
          onStartTodo={handleStartTodo}
          onStopTodo={handleStopTodo}
          onDeleteTodo={handleDeleteTodo}
          onEditTodo={handleEditTodo}
          onMergeTodo={handleMergeTodo}
          onMergeChain={handleMergeChain}
          onCleanupTodo={handleCleanupTodo}
          onRetryTodo={handleRetryTodo}
          onContinueTodo={handleContinueTodo}
          onFixTodo={handleFixTodo}
          onScheduleTodo={handleScheduleTodo}
          onScheduleOnResetTodo={handleScheduleOnReset}
          resetsAt={resetsAt}
          onUpdateDependency={handleUpdateDependency}
          onUpdatePosition={handleUpdatePosition}
          onReorderTodos={handleReorderTodos}
          onEvent={onEvent}
          onSendInput={handleSendInput}
          interactiveTodos={interactiveTodos}
          debugLogging={!!project.debug_logging}
          showTokenUsage={!!project.show_token_usage}
        />
      )}
      {activeTab === 'sessions' && id && (
        <SessionList
          projectId={id}
          sessions={sessions}
          projectCliTool={project.cli_tool}
          projectCliModel={project.claude_model ?? undefined}
          isGitRepo={!!project.is_git_repo}
          projectUseWorktree={project.use_worktree !== 0}
          projectDefaultBranch={project.default_branch}
          onAddSession={handleAddSession}
          onUpdateSession={handleUpdateSession}
          onStopSession={handleStopSession}
          onDeleteSession={handleDeleteSession}
          onCleanupSession={handleCleanupSession}
        />
      )}
      {activeTab === 'automation' && automationSub === 'discussions' && id && (
        <DiscussionList
          projectId={id}
          discussions={discussions}
          onAddDiscussion={handleAddDiscussion}
          onStartDiscussion={handleStartDiscussion}
          onStopDiscussion={handleStopDiscussion}
          onDeleteDiscussion={handleDeleteDiscussion}
        />
      )}
      {getPluginsWithTabs(project).map((plugin) =>
        activeTab === plugin.id && plugin.PanelComponent ? (
          <plugin.PanelComponent
            key={plugin.id}
            project={project}
            onImportAsTask={async (title: string, description: string) => {
              if (!id) return;
              const newTodo = await todosApi.createTodo(id, { title, description });
              setTodos((prev) => [...prev, newTodo]);
            }}
          />
        ) : null
      )}
      {activeTab === 'analytics' && id && (
        <AnalyticsPanel projectId={id} />
      )}
      {activeTab === 'git' && project.is_git_repo ? (
        <GitStatusPanel project={project} refreshTrigger={gitRefreshTrigger} />
      ) : null}
      {activeTab === 'svn' && project.svn_enabled ? (
        <SvnStatusPanel project={project} refreshTrigger={gitRefreshTrigger} />
      ) : null}
      {activeTab === 'files' && id && (
        <VaultLayout projectId={id} />
      )}
      {activeTab === 'automation' && automationSub === 'schedules' && (
        <ScheduleList
          schedules={schedules}
          projectCliTool={project.cli_tool}
          projectCliModel={project.claude_model ?? undefined}
          onAddSchedule={handleAddSchedule}
          onToggleSchedule={handleToggleSchedule}
          onDeleteSchedule={handleDeleteSchedule}
          onEditSchedule={handleEditSchedule}
          onTriggerSchedule={handleTriggerSchedule}
          onMergeRun={handleMergeTodo}
          onCleanupRun={handleCleanupTodo}
        />
      )}
      {activeTab === 'planner' && (
        <PlannerList
          plannerItems={plannerItems}
          existingTags={plannerTags}
          projectCliTool={project.cli_tool}
          projectCliModel={project.claude_model ?? undefined}
          onAddItem={handleAddPlannerItem}
          onEditItem={handleEditPlannerItem}
          onDeleteItem={handleDeletePlannerItem}
          onConvertToTodo={handleConvertPlannerToTodo}
          onConvertToSchedule={handleConvertPlannerToSchedule}
          onConvertToSession={handleConvertPlannerToSession}
          onUpdateTag={handleUpdatePlannerTag}
          onDeleteTag={handleDeletePlannerTag}
          onExport={handleExportPlanner}
          onImport={handleImportPlanner}
        />
      )}
    </div>
    </SessionWindowsHost>
  );
}
