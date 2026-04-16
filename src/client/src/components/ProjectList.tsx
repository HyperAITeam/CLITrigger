import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, FolderOpen, X } from 'lucide-react';
import type { Project } from '../types';
import * as projectsApi from '../api/projects';
import { Skeleton } from './Skeleton';
import ProjectForm from './ProjectForm';
import EmptyState from './EmptyState';

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
    <div className="px-6 py-6 sm:px-8 sm:py-8 min-h-full">
      <div>

      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">
            {t('projects.title')}
          </h1>
          <p className="text-sm mt-1 text-secondary">
            {filtered.length} {t('projects.tasks')}
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="btn-primary"
        >
          <Plus size={20} strokeWidth={2.5} />
          <span className="hidden sm:inline font-bold">{t('projects.new')}</span>
        </button>
      </div>

      {/* Search */}
      <div className="mb-8 relative group">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted group-focus-within:text-accent transition-colors" size={20} strokeWidth={2} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('projects.search')}
          className="input-field pl-12 py-3 text-base shadow-soft"
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
        <EmptyState
          icon={FolderOpen}
          title={t('projects.empty')}
          description={t('projects.emptyHint')}
          size="lg"
        />
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
                  className: 'card group block p-5 opacity-50 relative cursor-pointer animate-fade-in',
                }
              : {
                  to: `/projects/${project.id}`,
                  className: 'card group block p-5 relative hover:border-accent/30 animate-fade-in',
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
                  className="absolute top-3 right-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-status-error/10 text-theme-muted"
                  title={t('projects.delete')}
                >
                  <X size={14} strokeWidth={2} />
                </button>

                {/* Top row: avatar + name */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 bg-theme-bg-tertiary text-theme-text-secondary">
                    {project.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold truncate text-theme-text">
                      {project.name}
                    </h3>
                    <p className="text-2xs font-mono truncate text-theme-muted">
                      {project.path.split(/[/\\]/).slice(-2).join('/')}
                    </p>
                  </div>
                </div>

                {/* Progress + stats row */}
                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs">
                    {counts.running > 0 && (
                      <span className="inline-flex items-center gap-1 text-status-running font-medium">
                        <span className="h-1.5 w-1.5 rounded-full bg-status-running" />
                        {counts.running}
                      </span>
                    )}
                    <span className="text-theme-muted">
                      {counts.completed}/{counts.total}
                    </span>
                  </div>
                  {counts.total > 0 && (
                    <span className="text-2xs font-medium text-theme-muted">
                      {Math.round((counts.completed / counts.total) * 100)}%
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                {counts.total > 0 && (
                  <div className="mt-1.5 h-1 rounded-full overflow-hidden bg-theme-bg-tertiary">
                    <div
                      className="h-full rounded-full transition-all duration-500 bg-accent"
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
