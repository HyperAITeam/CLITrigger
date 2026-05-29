import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Moon, Sun, Bell, BellOff, LogOut, Plus, X, Inbox, Terminal, FileCode, Link as LinkIcon, Edit2, Settings, Cloud } from 'lucide-react';
import type { Project, Favorite, FavoriteType } from '../types';
import * as projectsApi from '../api/projects';
import * as reviewApi from '../api/review';
import * as favoritesApi from '../api/favorites';
import * as tunnelApi from '../api/tunnel';
import type { TunnelStatus } from '../api/tunnel';
import type { FavoriteInput } from '../api/favorites';
import { useI18n } from '../i18n';
import { useTheme } from '../hooks/useTheme';
import { useNotification } from '../hooks/useNotification';
import { useToast } from '../hooks/useToast';
import type { WsEvent } from '../hooks/useWebSocket';
import ProjectForm from './ProjectForm';
import FavoriteForm from './FavoriteForm';
import SettingsModal from './SettingsModal';
import ToastContainer from './Toast';
import ProjectColorPicker from './ProjectColorPicker';
import { resolveProjectColor } from '../lib/projectColor';

interface SidebarProps {
  onLogout: () => void;
  authRequired: boolean;
  connected: boolean;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  onClose?: () => void;
}

interface ProjectStatus {
  running: number;
  completed: number;
  total: number;
  running_sessions: number;
  running_discussions: number;
}

function iconForType(type: FavoriteType) {
  if (type === 'executable') return FileCode;
  if (type === 'command') return Terminal;
  return LinkIcon;
}

export default function Sidebar({ onLogout, authRequired, connected, onEvent, onClose }: SidebarProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, ProjectStatus>>({});
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [colorPicker, setColorPicker] = useState<{ project: Project; x: number; y: number } | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [showFavoriteForm, setShowFavoriteForm] = useState(false);
  const [editingFavorite, setEditingFavorite] = useState<Favorite | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus | null>(null);
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [dragOverGapIndex, setDragOverGapIndex] = useState<number | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { t, toggleLang } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { enabled: notifEnabled, supported: notifSupported, toggleNotification } = useNotification();
  const { toasts, error: toastError, success: toastSuccess, info: toastInfo, warning: toastWarning, dismiss } = useToast();

  // Extract active project ID from URL
  const activeProjectId = location.pathname.match(/^\/projects\/([^/]+)/)?.[1] || null;

  useEffect(() => {
    loadProjects();
    loadFavorites();
    tunnelApi.getTunnelStatus().then(setTunnelStatus).catch(() => { /* ignore */ });
  }, []);

  async function handleTunnelClick() {
    if (tunnelBusy) return;
    setTunnelBusy(true);
    try {
      const cur = await tunnelApi.getTunnelStatus();
      setTunnelStatus(cur);
      if (cur.status === 'running' && cur.url) {
        await navigator.clipboard.writeText(cur.url);
        toastSuccess(t('tunnel.urlCopied'));
        return;
      }
      const result = await tunnelApi.startTunnel();
      const next: TunnelStatus = { status: 'running', url: result.url };
      setTunnelStatus(next);
      try {
        await navigator.clipboard.writeText(result.url);
        toastSuccess(t('tunnel.urlCopied'));
      } catch {
        toastSuccess(result.url);
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('tunnel.restartFailed'));
    } finally {
      setTunnelBusy(false);
    }
  }

  function loadFavorites() {
    favoritesApi.listFavorites()
      .then(setFavorites)
      .catch(() => {});
  }

  const handleSubmitFavorite = async (data: FavoriteInput) => {
    try {
      if (editingFavorite) {
        await favoritesApi.updateFavorite(editingFavorite.id, data);
      } else {
        await favoritesApi.createFavorite(data);
      }
      setShowFavoriteForm(false);
      setEditingFavorite(null);
      loadFavorites();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to save favorite');
    }
  };

  const handleLaunchFavorite = async (id: string) => {
    try {
      await favoritesApi.launchFavorite(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('favorites.launchFailed');
      toastError(`${t('favorites.launchFailed')}: ${message}`);
    }
  };

  const handleDeleteFavorite = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(t('favorites.deleteConfirm'))) return;
    try {
      await favoritesApi.deleteFavorite(id);
      setFavorites((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to delete favorite');
    }
  };

  const handleEditFavorite = (favorite: Favorite, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingFavorite(favorite);
    setShowFavoriteForm(true);
  };

  // Listen for projects:changed events from ProjectList
  useEffect(() => {
    const handler = () => loadProjects();
    window.addEventListener('projects:changed', handler);
    return () => window.removeEventListener('projects:changed', handler);
  }, []);

  // WebSocket events for status updates
  useEffect(() => {
    return onEvent((event) => {
      if (event.type === 'project:status-changed' && event.projectId) {
        setStatusMap((prev) => ({
          ...prev,
          [event.projectId!]: {
            running: event.running ?? 0,
            completed: event.completed ?? 0,
            total: event.total ?? 0,
            running_sessions: event.running_sessions ?? 0,
            running_discussions: event.running_discussions ?? 0,
          },
        }));
      }
      if (event.type === 'todo:status-changed') {
        loadReviewCount();
      }
      if (event.type === 'memory:ingest-finished') {
        const project = projects.find(p => p.id === event.projectId);
        const projectLabel = project?.name ?? '';
        const sourceLabel = event.sourceTitle ? `“${event.sourceTitle}”` : (event.sourceType ?? '');
        const prefix = projectLabel ? `[${projectLabel}] ` : '';
        if (event.error) {
          toastError(`${prefix}${t('wiki.ingest.toast.failed')}: ${event.error}`, 6000);
          return;
        }
        const created = event.created ?? 0;
        const updated = event.updated ?? 0;
        const edges = event.edgesAdded ?? 0;
        const applied = created + updated + edges;
        if (applied > 0) {
          const summary = t('wiki.ingest.toast.success')
            .replace('{source}', sourceLabel)
            .replace('{created}', String(created))
            .replace('{updated}', String(updated))
            .replace('{edges}', String(edges));
          toastSuccess(`${prefix}${summary}`);
        } else if (event.skipped?.parseFailed) {
          toastWarning(`${prefix}${t('wiki.ingest.toast.parseFailed').replace('{source}', sourceLabel)}`, 5000);
        } else {
          toastInfo(`${prefix}${t('wiki.ingest.toast.empty').replace('{source}', sourceLabel)}`, 4000);
        }
      }
    });
  }, [onEvent, projects, t, toastError, toastInfo, toastSuccess, toastWarning]);

  useEffect(() => {
    loadReviewCount();
  }, []);

  function loadReviewCount() {
    reviewApi.getReviewSummary({ hours: 24 })
      .then((s) => setReviewCount(s.total_todos))
      .catch(() => {});
  }

  function loadProjects() {
    projectsApi.getProjects()
      .then((data) => {
        setProjects(data);
        data.forEach((p) => {
          projectsApi.getProjectStatus(p.id)
            .then((status) => {
              setStatusMap((prev) => ({ ...prev, [p.id]: status }));
            })
            .catch(() => {});
        });
      })
      .catch(() => {});
  }

  const handleNav = () => {
    onClose?.();
  };

  const handleAddProject = async (name: string, path: string) => {
    await projectsApi.createProject({ name, path });
    setShowForm(false);
    window.dispatchEvent(new Event('projects:changed'));
  };

  const commitReorder = useCallback(async (sourceId: string, gapIndex: number) => {
    const currentIds = projects.map((p) => p.id);
    const sourceIdx = currentIds.indexOf(sourceId);
    if (sourceIdx < 0) return;
    const without = currentIds.filter((id) => id !== sourceId);
    const insertAt = gapIndex > sourceIdx ? gapIndex - 1 : gapIndex;
    if (insertAt === sourceIdx) return;
    const nextIds = [...without.slice(0, insertAt), sourceId, ...without.slice(insertAt)];
    const previous = projects;
    const idToProject = new Map(projects.map((p) => [p.id, p]));
    const optimistic = nextIds.map((id) => idToProject.get(id)!).filter(Boolean);
    setProjects(optimistic);
    try {
      await projectsApi.reorderProjects(nextIds);
    } catch (err) {
      setProjects(previous);
      toastError(err instanceof Error ? err.message : 'Failed to reorder projects');
    }
  }, [projects, toastError]);

  // True for the lifetime of an in-progress reorder gesture; checked by
  // the project Link's onClick to swallow the synthetic click that follows
  // mouseup so we don't navigate to the project we just dropped. Reset on
  // the frame after mouseup so the next genuine click goes through.
  const dragJustHappenedRef = useRef(false);

  // Pointer-based reorder. We deliberately avoid HTML5 draggable here:
  // Edge / Chrome render a native "split view" / window-drop indicator
  // whenever an HTML5 drag is in flight, which the user can't dismiss and
  // can't actually drop onto. Mouse events keep the gesture entirely
  // inside the page.
  const handleItemMouseDown = useCallback((id: string, e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0) return;
    // Don't start a reorder when the user clicked an inner action button
    // (delete X, future inline controls). The button's own onClick still
    // fires; the drag gesture would otherwise eat the click.
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const DRAG_THRESHOLD = 6;
    let started = false;
    let lastGapIndex: number | null = null;

    const computeGapIndex = (clientY: number): number | null => {
      const items = document.querySelectorAll<HTMLElement>('[data-workspace-item]');
      if (items.length === 0) return null;
      const firstRect = items[0].getBoundingClientRect();
      if (clientY < firstRect.top) return 0;
      const lastRect = items[items.length - 1].getBoundingClientRect();
      if (clientY > lastRect.bottom) return items.length;
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect();
        if (clientY >= r.top && clientY <= r.bottom) {
          const mid = r.top + r.height / 2;
          return clientY < mid ? i : i + 1;
        }
      }
      return null;
    };

    const onMove = (ev: MouseEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        started = true;
        setDragSourceId(id);
      }
      const gapIndex = computeGapIndex(ev.clientY);
      if (gapIndex !== lastGapIndex) {
        lastGapIndex = gapIndex;
        setDragOverGapIndex(gapIndex);
      }
    };

    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
    };

    const onUp = () => {
      cleanup();
      if (!started) {
        // No movement — let the click through (navigation).
        return;
      }
      dragJustHappenedRef.current = true;
      // Click fires synchronously after mouseup in the same task; the rAF
      // resets the guard on the next paint so subsequent genuine clicks
      // pass through.
      requestAnimationFrame(() => { dragJustHappenedRef.current = false; });
      const finalGap = lastGapIndex;
      setDragSourceId(null);
      setDragOverGapIndex(null);
      if (finalGap !== null) commitReorder(id, finalGap);
    };

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      cleanup();
      setDragSourceId(null);
      setDragOverGapIndex(null);
      if (started) {
        dragJustHappenedRef.current = true;
        requestAnimationFrame(() => { dragJustHappenedRef.current = false; });
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
  }, [commitReorder]);

  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(t('projects.deleteConfirm'))) return;
    try {
      await projectsApi.deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      window.dispatchEvent(new Event('projects:changed'));
      if (activeProjectId === String(id)) {
        navigate('/');
      }
    } catch {
      // TODO: show error
    }
  };

  // Visual drop indicator. Rendered above the item at `dragOverGapIndex`,
  // or below the last item when the gap index sits past the end of the list.
  const renderDropIndicator = (position: 'above' | 'below') => (
    <div
      className="pointer-events-none absolute left-2 right-2 h-0.5 rounded-full"
      style={{
        backgroundColor: 'var(--color-accent)',
        zIndex: 10,
        ...(position === 'above' ? { top: -1 } : { bottom: -1 }),
      }}
    />
  );

  return (
    <div className="flex flex-col h-full glass border-none">
      {/* Logo */}
      <div className="px-4 pt-5 pb-3">
        <Link to="/" onClick={handleNav} className="block">
          <svg viewBox="0 0 200 32" fill="none" className="h-6 w-auto">
            {/* >_ prompt */}
            <text x="0" y="24" fontFamily="'JetBrains Mono', monospace" fontSize="22" fontWeight="500" fill="var(--color-accent)" opacity="0.5">{'>'}_</text>
            {/* CLI — bold accent */}
            <text x="38" y="24" fontFamily="'JetBrains Mono', monospace" fontSize="22" fontWeight="700" fill="var(--color-accent)">CLI</text>
            {/* Trigger — lighter */}
            <text x="96" y="24" fontFamily="'JetBrains Mono', monospace" fontSize="22" fontWeight="500" fill="var(--color-text-primary)">Trigger</text>
          </svg>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="px-3 mb-2 space-y-0.5">
        <Link
          to="/"
          onClick={handleNav}
          className={`relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 active:scale-95 ${location.pathname === '/' ? 'font-medium' : ''}`}
          style={location.pathname === '/'
            ? { backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-primary)', boxShadow: 'var(--shadow-soft)' }
            : { color: 'var(--color-text-tertiary)' }
          }
        >
          {location.pathname === '/' && (
            <span className="absolute left-0 top-1/4 bottom-1/4 w-[3px] rounded-r-full" style={{ backgroundColor: 'var(--color-accent)' }} />
          )}
          <LayoutDashboard size={16} />
          {t('sidebar.home')}
        </Link>
        <Link
          to="/review"
          onClick={handleNav}
          className={`relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 active:scale-95 ${location.pathname === '/review' ? 'font-medium' : ''}`}
          style={location.pathname === '/review'
            ? { backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-primary)', boxShadow: 'var(--shadow-soft)' }
            : { color: 'var(--color-text-tertiary)' }
          }
        >
          {location.pathname === '/review' && (
            <span className="absolute left-0 top-1/4 bottom-1/4 w-[3px] rounded-r-full" style={{ backgroundColor: 'var(--color-accent)' }} />
          )}
          <Inbox size={16} />
          <span className="flex-1">{t('sidebar.review')}</span>
          {reviewCount !== null && reviewCount > 0 && (
            <span
              className="text-2xs px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: 'var(--color-accent)', color: 'white' }}
            >
              {reviewCount}
            </span>
          )}
        </Link>
      </nav>

      {/* Divider */}
      <div className="mx-4 border-t" style={{ borderColor: 'var(--color-border)' }} />

      {/* Projects section */}
      <div className="flex-1 overflow-y-auto px-3 pt-3">
        <div className="px-3 mb-2 flex items-center justify-between">
          <span className="text-2xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            {t('sidebar.workspaces')}
          </span>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center justify-center w-5 h-5 rounded-md transition-colors hover:bg-theme-hover"
            style={{ color: 'var(--color-text-tertiary)' }}
            title={t('projects.new')}
          >
            <Plus size={14} strokeWidth={2} />
          </button>
        </div>
        <div className="space-y-0.5">
          {projects.map((project, index) => {
            const status = statusMap[project.id];
            const isActive = activeProjectId === String(project.id);
            const activeWork = status
              ? status.running + status.running_sessions + status.running_discussions
              : 0;
            const hasActivity = activeWork > 0;
            const tagColor = resolveProjectColor(project);
            const isDragSource = dragSourceId === project.id;
            const showAbove = dragSourceId !== null && dragOverGapIndex === index;
            const showBelow = dragSourceId !== null
              && index === projects.length - 1
              && dragOverGapIndex === projects.length;
            return (
              <div key={project.id} className="relative" data-workspace-item>
                {showAbove && renderDropIndicator('above')}
                <Link
                  to={`/projects/${project.id}`}
                  draggable={false}
                  onDragStart={(e) => e.preventDefault()}
                  onClick={(e) => {
                    if (dragJustHappenedRef.current) { e.preventDefault(); return; }
                    handleNav();
                  }}
                  onMouseDown={(e) => handleItemMouseDown(project.id, e)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setColorPicker({ project, x: e.clientX, y: e.clientY });
                  }}
                  className={`relative flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 hover:bg-theme-hover active:scale-95 group ${isActive ? 'font-medium' : ''} ${isDragSource ? 'opacity-50' : ''}`}
                  style={isActive
                    ? { backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-primary)', boxShadow: 'var(--shadow-soft)', cursor: dragSourceId ? 'grabbing' : 'pointer', userSelect: 'none' }
                    : { color: 'var(--color-text-tertiary)', cursor: dragSourceId ? 'grabbing' : 'pointer', userSelect: 'none' }
                  }
                >
                  {isActive && (
                    <span
                      className="absolute left-0 top-1/4 bottom-1/4 w-[3px] rounded-r-full"
                      style={{ backgroundColor: tagColor }}
                    />
                  )}
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${hasActivity ? 'workspace-dot-pulse' : ''}`}
                    style={{ backgroundColor: tagColor, opacity: isActive || hasActivity ? 1 : 0.55 }}
                    title={hasActivity
                      ? `${t('sidebar.workspaces')} · ${activeWork} ${t('detail.live')}`
                      : project.name}
                  />
                  <span className="truncate flex-1">{project.name}</span>
                  <button
                    onClick={(e) => handleDeleteProject(project.id, e)}
                    className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-all hover:bg-status-error/10"
                    style={{ color: 'var(--color-text-muted)' }}
                    title={t('projects.delete')}
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </Link>
                {showBelow && renderDropIndicator('below')}
              </div>
            );
          })}
        </div>
      </div>

      {showForm && (
        <ProjectForm
          onSubmit={(name, path) => handleAddProject(name, path)}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Favorites section */}
      <div className="px-3 pt-3 pb-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-3 mb-2 flex items-center justify-between">
            <span className="text-2xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
              {t('sidebar.favorites')}
            </span>
            <button
              onClick={() => { setEditingFavorite(null); setShowFavoriteForm(true); }}
              className="flex items-center justify-center w-5 h-5 rounded-md transition-colors hover:bg-theme-hover"
              style={{ color: 'var(--color-text-tertiary)' }}
              title={t('favorites.add')}
            >
              <Plus size={14} strokeWidth={2} />
            </button>
          </div>
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            {favorites.map((favorite) => {
              const Icon = iconForType(favorite.type);
              return (
                <button
                  key={favorite.id}
                  onClick={() => handleLaunchFavorite(favorite.id)}
                  className="w-full relative flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 hover:bg-theme-hover active:scale-95 group"
                  style={{ color: 'var(--color-text-tertiary)' }}
                  title={favorite.target}
                >
                  <Icon size={14} className="flex-shrink-0" />
                  <span className="truncate flex-1 text-left">{favorite.name}</span>
                  <span
                    onClick={(e) => handleEditFavorite(favorite, e)}
                    className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-all hover:bg-theme-hover cursor-pointer"
                    style={{ color: 'var(--color-text-muted)' }}
                    title={t('favorites.edit')}
                  >
                    <Edit2 size={11} strokeWidth={2} />
                  </span>
                  <span
                    onClick={(e) => handleDeleteFavorite(favorite.id, e)}
                    className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-all hover:bg-status-error/10 cursor-pointer"
                    style={{ color: 'var(--color-text-muted)' }}
                    title={t('favorites.delete')}
                  >
                    <X size={12} strokeWidth={2} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>

      {showFavoriteForm && (
        <FavoriteForm
          initial={editingFavorite ?? undefined}
          onSubmit={handleSubmitFavorite}
          onCancel={() => { setShowFavoriteForm(false); setEditingFavorite(null); }}
        />
      )}

      {colorPicker && (
        <ProjectColorPicker
          project={colorPicker.project}
          anchorX={colorPicker.x}
          anchorY={colorPicker.y}
          onPick={async (color) => {
            try {
              const updated = await projectsApi.updateProject(colorPicker.project.id, { color });
              setProjects((prev) => prev.map((p) => p.id === updated.id ? { ...p, color: updated.color } : p));
              window.dispatchEvent(new Event('projects:changed'));
            } catch (err) {
              toastError(err instanceof Error ? err.message : 'Failed to update color');
            }
            setColorPicker(null);
          }}
          onClose={() => setColorPicker(null)}
        />
      )}

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />

      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      {/* Bottom section */}
      <div className="px-3 pb-4 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
        {/* Controls row with connection status */}
        <div className="flex items-center gap-1 px-1">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mr-1 ${connected ? 'bg-status-success' : 'bg-status-error'}`} title={connected ? t('detail.live') : 'Disconnected'} />
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors"
            style={{ color: 'var(--color-text-tertiary)' }}
            title={theme === 'light' ? t('theme.dark') : t('theme.light')}
          >
            {theme === 'light' ? (
              <Moon size={16} />
            ) : (
              <Sun size={16} />
            )}
          </button>
          <button
            onClick={toggleLang}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors text-xs font-medium"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {t('lang.toggle')}
          </button>
          {notifSupported && (
            <button
              onClick={toggleNotification}
              className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors"
              style={{ color: notifEnabled ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }}
              title={'Notification' in window && Notification.permission === 'denied' ? t('notification.blocked') : t('notification.toggle')}
            >
              {notifEnabled ? (
                <Bell size={16} />
              ) : (
                <BellOff size={16} />
              )}
            </button>
          )}
          <button
            onClick={handleTunnelClick}
            disabled={tunnelBusy}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors disabled:opacity-50"
            style={{ color: tunnelStatus?.status === 'running' ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }}
            title={tunnelStatus?.status === 'running' && tunnelStatus.url
              ? `${tunnelStatus.url} — ${t('tunnel.urlCopied')}`
              : tunnelBusy ? t('tunnel.starting') : t('tunnel.start')}
          >
            <Cloud size={16} />
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors"
            style={{ color: 'var(--color-text-tertiary)' }}
            title={t('settings.title')}
          >
            <Settings size={16} />
          </button>
          {authRequired && (
            <button
              onClick={onLogout}
              className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors ml-auto"
              style={{ color: 'var(--color-text-tertiary)' }}
              title={t('projects.logout')}
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
