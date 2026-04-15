import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
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
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
          </svg>
          {t('sidebar.home')}
        </Link>
      </nav>

      {/* Divider */}
      <div className="mx-4 border-t" style={{ borderColor: 'var(--color-border)' }} />

      {/* Projects section */}
      <div className="flex-1 overflow-y-auto px-3 pt-3">
        <div className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
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
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
              </svg>
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
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path fillRule="evenodd" d="M5.25 9a6.75 6.75 0 0113.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 01-.573 1.23H3.705a.75.75 0 01-.573-1.23A8.69 8.69 0 005.25 9.75V9zm4.508 8.25a2.159 2.159 0 004.484 0H9.758z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.143 17.082a24.248 24.248 0 005.714 0m-7.607-3.832A8.69 8.69 0 005.25 9.75v-.75a6.75 6.75 0 0113.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 01-.573 1.23H3.705a.75.75 0 01-.573-1.23z" />
                </svg>
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
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
