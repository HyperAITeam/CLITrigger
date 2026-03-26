import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Project } from '../types';
import * as projectsApi from '../api/projects';
import ProjectForm from './ProjectForm';
import { useI18n } from '../i18n';
import type { WsEvent } from '../hooks/useWebSocket';

interface ProjectListProps {
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  onLogout: () => void;
}

interface ProjectStatus {
  running: number;
  completed: number;
  total: number;
}

export default function ProjectList({ onEvent, onLogout }: ProjectListProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, ProjectStatus>>({});
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const { t, toggleLang } = useI18n();

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

  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await projectsApi.deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // TODO: show error
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-2xl font-semibold text-warm-800">
            {t('projects.title')}
          </h1>
          <p className="text-warm-500 text-sm mt-1">
            {t('projects.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
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
            {t('projects.new')}
          </button>
          <button
            onClick={onLogout}
            className="btn-ghost text-sm"
          >
            {t('projects.logout')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-warm-500 animate-fade-in">
          {t('projects.loading')}
        </div>
      ) : projects.length === 0 ? (
        <div className="card p-16 text-center animate-fade-in">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-warm-200 mb-4">
            <svg className="w-7 h-7 text-warm-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
          </div>
          <p className="text-warm-600 font-medium">{t('projects.empty')}</p>
          <p className="text-warm-400 text-sm mt-1">{t('projects.emptyHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project, index) => {
            const counts = statusMap[project.id] || { total: 0, completed: 0, running: 0 };
            return (
              <Link
                key={project.id}
                to={`/projects/${project.id}`}
                className="group card p-5 animate-slide-up"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                {/* Delete button */}
                <button
                  onClick={(e) => handleDeleteProject(project.id, e)}
                  className="absolute top-3 right-3 p-1.5 text-warm-400 hover:bg-status-error/10 hover:text-status-error rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                  title={t('projects.delete')}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                <h3 className="text-base font-semibold text-warm-800 group-hover:text-accent-goldDark transition-colors truncate">
                  {project.name}
                </h3>
                <p className="mt-1 text-xs text-warm-400 font-mono truncate">{project.path}</p>
                <div className="mt-1.5">
                  {project.is_git_repo ? (
                    <span className="badge bg-status-success/10 text-status-success text-[10px]">Git</span>
                  ) : (
                    <span className="badge bg-status-warning/10 text-status-warning text-[10px]">{t('projects.noGit')}</span>
                  )}
                </div>

                {/* Stats */}
                <div className="mt-4 flex items-center gap-3 text-xs">
                  <span className="badge bg-warm-200 text-warm-600">
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

                {/* Progress bar */}
                {counts.total > 0 && (
                  <div className="mt-4 h-1.5 w-full overflow-hidden bg-warm-200 rounded-full">
                    <div
                      className="h-full bg-accent-gold rounded-full transition-all duration-500"
                      style={{ width: `${(counts.completed / counts.total) * 100}%` }}
                    />
                  </div>
                )}
              </Link>
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
  );
}
