import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Project } from '../types';
import * as projectsApi from '../api/projects';
import ProjectForm from './ProjectForm';
import { useI18n } from '../i18n';
import { useTheme } from '../hooks/useTheme';
import type { WsEvent } from '../hooks/useWebSocket';

interface ProjectListProps {
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  onLogout: () => void;
  authRequired?: boolean;
}

interface ProjectStatus {
  running: number;
  completed: number;
  total: number;
}

const CARD_ROTATIONS = [-1.2, 0.8, -0.5, 1.0, -0.8, 0.6, -1.0, 0.4];

function CrownSVG({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 56" fill="none" className={className}>
      <path d="M4 52 L16 10 L28 30 L34 4 L40 30 L52 10 L60 52 Z"
            stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round" />
      <circle cx="16" cy="10" r="4" fill="currentColor" />
      <circle cx="34" cy="4" r="4" fill="currentColor" />
      <circle cx="52" cy="10" r="4" fill="currentColor" />
      <line x1="4" y1="52" x2="60" y2="52" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M14 38 L22 22 L30 34 L34 18 L38 34 L46 22 L50 38"
            stroke="#F5D623" strokeWidth="1.5" strokeLinejoin="round" opacity="0.4" />
    </svg>
  );
}

function LogoBanner() {
  return (
    <div className="bq-logo-banner">
      {/* Crown */}
      <svg viewBox="0 0 64 56" fill="none" className="bq-logo-crown">
        <path d="M4 52 L16 10 L28 30 L34 4 L40 30 L52 10 L60 52 Z"
              stroke="#E63B2E" strokeWidth="3.5" strokeLinejoin="round" />
        <circle cx="16" cy="10" r="4" fill="#E63B2E" />
        <circle cx="34" cy="4" r="4" fill="#E63B2E" />
        <circle cx="52" cy="10" r="4" fill="#E63B2E" />
        <line x1="4" y1="52" x2="60" y2="52" stroke="#E63B2E" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M14 38 L22 22 L30 34 L34 18 L38 34 L46 22 L50 38"
              stroke="#F5D623" strokeWidth="1.5" strokeLinejoin="round" opacity="0.5" />
      </svg>
      {/* Text */}
      <span className="bq-logo-text">CLITRIGGER</span>
      {/* Red underline scrawls */}
      <svg viewBox="0 0 390 14" fill="none" className="bq-logo-underline">
        <path d="M2 4 Q100 2 200 5 Q300 1 388 4"
              stroke="#E63B2E" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M6 10 Q120 12 230 9 Q330 13 384 10"
              stroke="#E63B2E" strokeWidth="1.8" strokeLinecap="round" opacity="0.5" />
      </svg>
    </div>
  );
}

export default function ProjectList({ onEvent, onLogout, authRequired = true }: ProjectListProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, ProjectStatus>>({});
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const { t, toggleLang } = useI18n();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    projectsApi.getProjects()
      .then((data) => {
        setProjects(data);
        data.forEach((p) => {
          projectsApi.getProjectStatus(p.id)
            .then((status) => {
              setStatusMap((prev) => ({ ...prev, [p.id]: status }));
            })
            .catch(() => { /* ignore */ });
        });
      })
      .catch(() => { /* ignore */ })
      .finally(() => setLoading(false));
  }, []);

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

  const handleAddProject = async (name: string, path: string) => {
    try {
      const newProject = await projectsApi.createProject({ name, path });
      setProjects((prev) => [...prev, newProject]);
      setShowForm(false);
    } catch {
      // TODO: show error
    }
  };

  const handleDeleteProject = async (id: string, e: React.MouseEvent, skipConfirm = false) => {
    e.preventDefault();
    e.stopPropagation();
    if (!skipConfirm && !confirm(t('projects.deleteConfirm'))) return;
    try {
      await projectsApi.deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // TODO: show error
    }
  };

  return (
    <div className="basquiat-home min-h-screen px-4 sm:px-6 py-6 sm:py-8 relative overflow-hidden">
      {/* SVG filter definitions */}
      <svg className="absolute w-0 h-0" aria-hidden="true">
        <defs>
          <filter id="bq-rough-filter">
            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="3" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.5" />
          </filter>
        </defs>
      </svg>

      {/* Floating decorative crowns */}
      <div className="bq-crown" style={{ top: '5%', right: '8%', width: 70, height: 46 }}>
        <CrownSVG />
      </div>
      <div className="bq-crown" style={{ top: '30%', left: '3%', width: 50, height: 33 }}>
        <CrownSVG />
      </div>
      <div className="bq-crown" style={{ bottom: '10%', right: '5%', width: 55, height: 36 }}>
        <CrownSVG />
      </div>

      {/* Floating X doodles */}
      <div className="bq-x-mark" style={{ top: '15%', left: '12%' }}>X</div>
      <div className="bq-x-mark" style={{ bottom: '20%', left: '8%', fontSize: '1.5rem', animationDelay: '-5s' }}>X</div>
      <div className="bq-x-mark" style={{ top: '45%', right: '10%', fontSize: '1.8rem', animationDelay: '-7s' }}>X</div>

      <div className="mx-auto max-w-5xl relative z-10">
        {/* Logo Banner */}
        <div className="mb-6 sm:mb-8">
          <LogoBanner />
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4 mb-8 sm:mb-10">
          <p className="font-caveat text-lg" style={{ color: 'var(--bq-text-secondary)', transform: 'rotate(-0.5deg)' }}>
            {t('projects.subtitle')}
          </p>
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={toggleTheme} className="lang-toggle" title={theme === 'light' ? t('theme.dark') : t('theme.light')}>
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
            <button onClick={toggleLang} className="lang-toggle">
              {t('lang.toggle')}
            </button>
            <button
              onClick={() => setShowForm(true)}
              className="btn-primary text-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <span className="hidden sm:inline">{t('projects.new')}</span>
            </button>
            {authRequired && (
              <button
                onClick={onLogout}
                className="btn-ghost text-sm"
              >
                {t('projects.logout')}
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-20 font-marker text-xl animate-wiggle" style={{ color: 'var(--bq-text-secondary)' }}>
            {t('projects.loading')}
          </div>
        ) : projects.length === 0 ? (
          <div className="card p-16 text-center bq-card-enter" style={{ '--bq-card-rotate': '0deg' } as React.CSSProperties}>
            <div className="inline-block w-20 h-14 mb-4" style={{ color: 'var(--bq-accent)' }}>
              <CrownSVG />
            </div>
            <p className="font-marker text-lg">{t('projects.empty')}</p>
            <p className="font-caveat text-base mt-2" style={{ color: 'var(--bq-text-secondary)' }}>
              {t('projects.emptyHint')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project, index) => {
              const counts = statusMap[project.id] || { total: 0, completed: 0, running: 0 };
              const pathMissing = project.path_exists === false;
              const rotation = CARD_ROTATIONS[index % CARD_ROTATIONS.length];
              const CardWrapper = pathMissing ? 'div' : Link;
              const cardProps = pathMissing
                ? {
                    onClick: (e: React.MouseEvent) => {
                      if (confirm(t('projects.pathMissingConfirm'))) {
                        handleDeleteProject(project.id, e, true);
                      }
                    },
                    className: 'group card p-5 bq-card-enter cursor-pointer opacity-60',
                    style: {
                      animationDelay: `${index * 80}ms`,
                      '--bq-card-rotate': `${rotation}deg`,
                    } as React.CSSProperties,
                  }
                : {
                    to: `/projects/${project.id}`,
                    className: 'group card p-5 bq-card-enter',
                    style: {
                      animationDelay: `${index * 80}ms`,
                      '--bq-card-rotate': `${rotation}deg`,
                    } as React.CSSProperties,
                  };
              return (
                <CardWrapper
                  key={project.id}
                  {...cardProps as any}
                >
                  {/* Decorative corner marks */}
                  <div className="bq-corner-tl" />
                  <div className="bq-corner-tr" />

                  {/* Delete button */}
                  <button
                    onClick={(e) => handleDeleteProject(project.id, e)}
                    className="absolute top-3 right-3 p-1.5 hover:bg-status-error/10 hover:text-status-error opacity-0 group-hover:opacity-100 transition-all"
                    style={{ color: 'var(--bq-text-secondary)', borderRadius: 0 }}
                    title={t('projects.delete')}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>

                  <h3 className="text-base font-bold font-hand group-hover:text-basquiat-red transition-colors truncate">
                    {project.name}
                  </h3>
                  <p className="mt-1 text-xs font-mono truncate" style={{ color: 'var(--bq-text-secondary)' }}>
                    {project.path}
                  </p>
                  <div className="mt-1.5 flex gap-1.5">
                    {pathMissing ? (
                      <span className="badge bg-status-error/10 text-status-error text-[10px]">{t('projects.pathMissing')}</span>
                    ) : project.is_git_repo ? (
                      <span className="badge bg-status-success/10 text-status-success text-[10px]">Git</span>
                    ) : (
                      <span className="badge bg-status-warning/10 text-status-warning text-[10px]">{t('projects.noGit')}</span>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="mt-4 flex items-center gap-3 text-xs font-hand">
                    <span className="badge" style={{ backgroundColor: 'var(--bq-bg-secondary)' }}>
                      {counts.total} {t('projects.tasks')}
                    </span>
                    {counts.running > 0 && (
                      <span className="badge bg-status-running/10 text-status-running">
                        <span className="h-1.5 w-1.5 rounded-full bg-status-running animate-pulse" />
                        {counts.running} {t('projects.active')}
                      </span>
                    )}
                    {counts.completed > 0 && (
                      <span className="badge bg-status-success/10 text-status-success">
                        {counts.completed} {t('projects.done')}
                      </span>
                    )}
                  </div>

                  {/* Progress bar — hatched pattern */}
                  {counts.total > 0 && (
                    <div className="mt-4 bq-progress-track">
                      <div
                        className="bq-progress-bar"
                        style={{ width: `${(counts.completed / counts.total) * 100}%` }}
                      />
                    </div>
                  )}
                </CardWrapper>
              );
            })}
          </div>
        )}

        {showForm && (
          <ProjectForm
            onSubmit={(name, path) => handleAddProject(name, path)}
            onCancel={() => setShowForm(false)}
          />
        )}
      </div>
    </div>
  );
}
