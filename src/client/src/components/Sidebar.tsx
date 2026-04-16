import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Moon, Sun, Bell, BellOff, LogOut } from 'lucide-react';
import type { Project } from '../types';
import * as projectsApi from '../api/projects';
import { useI18n } from '../i18n';
import { useTheme } from '../hooks/useTheme';
import { useNotification } from '../hooks/useNotification';
import type { WsEvent } from '../hooks/useWebSocket';

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
}

export default function Sidebar({ onLogout, authRequired, connected, onEvent, onClose }: SidebarProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, ProjectStatus>>({});
  const location = useLocation();
  const { t, toggleLang } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { enabled: notifEnabled, supported: notifSupported, toggleNotification } = useNotification();

  // Extract active project ID from URL
  const activeProjectId = location.pathname.match(/^\/projects\/([^/]+)/)?.[1] || null;

  useEffect(() => {
    loadProjects();
  }, []);

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
          },
        }));
      }
    });
  }, [onEvent]);

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
      <nav className="px-3 mb-2">
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
      </nav>

      {/* Divider */}
      <div className="mx-4 border-t" style={{ borderColor: 'var(--color-border)' }} />

      {/* Projects section */}
      <div className="flex-1 overflow-y-auto px-3 pt-3">
        <div className="px-3 mb-2 text-2xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
          {t('sidebar.workspaces')}
        </div>
        <div className="space-y-0.5">
          {projects.map((project) => {
            const status = statusMap[project.id];
            const isActive = activeProjectId === String(project.id);
            const hasRunning = status && status.running > 0;
            return (
              <Link
                key={project.id}
                to={`/projects/${project.id}`}
                onClick={handleNav}
                className={`relative flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 hover:bg-theme-hover active:scale-95 group ${isActive ? 'font-medium' : ''}`}
                style={isActive
                  ? { backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-primary)', boxShadow: 'var(--shadow-soft)' }
                  : { color: 'var(--color-text-tertiary)' }
                }
              >
                {isActive && (
                  <span className="absolute left-0 top-1/4 bottom-1/4 w-[3px] rounded-r-full" style={{ backgroundColor: 'var(--color-accent)' }} />
                )}
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  hasRunning ? 'bg-status-running animate-pulse' : ''
                }`} style={hasRunning ? undefined : { backgroundColor: isActive ? 'var(--color-accent)' : 'var(--color-text-faint)' }} />
                <span className="truncate">{project.name}</span>
              </Link>
            );
          })}
        </div>
      </div>

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
