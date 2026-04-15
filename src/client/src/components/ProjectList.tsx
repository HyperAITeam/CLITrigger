import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Project } from '../types';
import * as projectsApi from '../api/projects';
import { Skeleton } from './Skeleton';
import ProjectForm from './ProjectForm';
import ParticleBackground from './ParticleBackground';
import { useI18n } from '../i18n';
import type { WsEvent } from '../hooks/useWebSocket';

interface ProjectListProps {
  onEvent: (cb: (event: WsEvent) => void) => () => void;
}

interface ProjectStatus {
  running: number;
  completed: number;
  total: number;
}

export default function ProjectList({ onEvent }: ProjectListProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, ProjectStatus>>({});
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const { t } = useI18n();

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
      window.dispatchEvent(new Event('projects:changed'));
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
      window.dispatchEvent(new Event('projects:changed'));
    } catch {
      // TODO: show error
    }
  };

  const filtered = search
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.path.toLowerCase().includes(search.toLowerCase())
      )
    : projects;

  return (
    <div className="px-6 py-6 sm:px-8 sm:py-8 relative min-h-full">
      {/* Interactive particle background */}
      <ParticleBackground />

      {/* Content layer */}
      <div className="relative" style={{ zIndex: 1 }}>

      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {t('projects.title')}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
            {filtered.length} {t('projects.tasks')}
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="btn-primary text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span className="hidden sm:inline">{t('projects.new')}</span>
        </button>
      </div>

      {/* Search */}
      <div className="mb-6 relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('projects.search')}
          className="input-field pl-10 py-2.5"
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card p-5 space-y-3">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <div className="flex gap-2">
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
              <div className="flex gap-2 pt-2">
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-6 w-16" />
              </div>
              <Skeleton className="h-1 w-full mt-2" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 animate-fade-in">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ backgroundColor: 'var(--color-bg-tertiary)' }}>
            <svg className="w-8 h-8" style={{ color: 'var(--color-text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
          </div>
          <p className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('projects.empty')}</p>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('projects.emptyHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project, index) => {
            const counts = statusMap[project.id] || { total: 0, completed: 0, running: 0 };
            const pathMissing = project.path_exists === false;
            const CardWrapper = pathMissing ? 'div' : Link;
            const cardProps = pathMissing
              ? {
                  onClick: (e: React.MouseEvent) => {
                    if (confirm(t('projects.pathMissingConfirm'))) {
                      handleDeleteProject(project.id, e, true);
                    }
                  },
                  className: 'card group block p-5 opacity-50 relative cursor-pointer animate-slide-up',
                }
              : {
                  to: `/projects/${project.id}`,
                  className: 'card group block p-5 relative hover:border-accent/30 animate-slide-up',
                };
            return (
              <CardWrapper
                key={project.id}
                {...cardProps as any}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                {/* Delete button */}
                <button
                  onClick={(e) => handleDeleteProject(project.id, e)}
                  className="absolute top-3 right-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-status-error/10"
                  style={{ color: 'var(--color-text-muted)' }}
                  title={t('projects.delete')}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {project.name}
                </h3>
                <p className="mt-1 text-xs font-mono truncate" style={{ color: 'var(--color-text-tertiary)' }}>
                  {project.path}
                </p>

                <div className="mt-2 flex gap-1.5">
                  {pathMissing ? (
                    <span className="badge bg-status-error/10 text-status-error text-[10px]">{t('projects.pathMissing')}</span>
                  ) : project.is_git_repo ? (
                    <span className="badge bg-status-success/10 text-status-success text-[10px]">Git</span>
                  ) : (
                    <span className="badge bg-status-warning/10 text-status-warning text-[10px]">{t('projects.noGit')}</span>
                  )}
                </div>

                {/* Stats */}
                <div className="mt-4 flex items-center gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded-md" style={{ backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-tertiary)' }}>
                    {counts.total} {t('projects.tasks')}
                  </span>
                  {counts.running > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-status-running/10 text-status-running">
                      <span className="h-1.5 w-1.5 rounded-full bg-status-running animate-pulse" />
                      {counts.running} {t('projects.active')}
                    </span>
                  )}
                  {counts.completed > 0 && (
                    <span className="px-2 py-0.5 rounded-md bg-status-success/10 text-status-success">
                      {counts.completed} {t('projects.done')}
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                {counts.total > 0 && (
                  <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-tertiary)' }}>
                    <div
                      className="h-full rounded-full bg-status-success transition-all duration-500"
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

      </div>{/* end content layer */}
    </div>
  );
}
