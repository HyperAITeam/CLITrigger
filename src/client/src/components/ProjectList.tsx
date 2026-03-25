import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Project } from '../types';
import * as projectsApi from '../api/projects';
import ProjectForm from './ProjectForm';
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
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="flex items-end justify-between mb-10">
        <div>
          <h1
            className="text-4xl font-mono font-bold text-neon-green glitch-text"
            data-text="CLI//TRIGGER"
          >
            CLI//TRIGGER
          </h1>
          <div className="h-0.5 w-32 bg-neon-green mt-2 shadow-neon-green" />
          <p className="text-street-400 font-mono text-xs mt-3 tracking-[0.2em] uppercase">
            Project Management Console
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowForm(true)}
            className="street-btn flex items-center gap-2 bg-neon-green px-6 py-3 text-street-900 text-xs hover:bg-neon-green/80 hover:shadow-neon-green"
          >
            <span className="text-lg leading-none">+</span>
            NEW PROJECT
          </button>
          <button
            onClick={onLogout}
            className="street-btn bg-street-700 border-2 border-street-500 px-4 py-3 text-street-300 text-xs hover:border-neon-pink hover:text-neon-pink hover:shadow-neon-pink"
            title="Logout"
          >
            EXIT
          </button>
        </div>
      </div>

      {/* Divider line */}
      <div className="h-px bg-gradient-to-r from-neon-green/50 via-street-600 to-transparent mb-8" />

      {loading ? (
        <div className="text-center py-20 font-mono text-neon-green animate-flicker">
          LOADING PROJECTS<span className="animate-pulse">_</span>
        </div>
      ) : projects.length === 0 ? (
        <div className="street-card p-16 text-center">
          <p className="text-street-400 font-mono text-lg">// NO PROJECTS FOUND</p>
          <p className="text-street-500 font-mono text-sm mt-2">Initialize your first project to begin.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project, index) => {
            const counts = statusMap[project.id] || { total: 0, completed: 0, running: 0 };
            return (
              <Link
                key={project.id}
                to={`/projects/${project.id}`}
                className="group relative street-card p-6 animate-slide-up"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                {/* Delete button */}
                <button
                  onClick={(e) => handleDeleteProject(project.id, e)}
                  className="absolute top-3 right-3 rounded p-1.5 text-street-500 hover:bg-neon-pink/20 hover:text-neon-pink opacity-0 group-hover:opacity-100 transition-all"
                  title="Delete project"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                {/* Project index */}
                <div className="text-xs font-mono text-street-500 mb-2">
                  #{String(index + 1).padStart(2, '0')}
                </div>

                <h3 className="text-lg font-mono font-bold text-white group-hover:text-neon-green transition-colors truncate">
                  {project.name}
                </h3>
                <p className="mt-1 text-xs text-street-400 font-mono truncate">{project.path}</p>

                {/* Stats */}
                <div className="mt-5 flex items-center gap-4 text-xs font-mono">
                  <span className="text-street-400">
                    [{counts.total}] TASKS
                  </span>
                  {counts.running > 0 && (
                    <span className="flex items-center gap-1.5 text-neon-cyan">
                      <span className="h-1.5 w-1.5 bg-neon-cyan animate-pulse" />
                      {counts.running} ACTIVE
                    </span>
                  )}
                  {counts.completed > 0 && (
                    <span className="text-neon-green">
                      {counts.completed} DONE
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                {counts.total > 0 && (
                  <div className="mt-4 h-1 w-full overflow-hidden bg-street-700">
                    <div
                      className="h-full bg-neon-green transition-all duration-500 shadow-neon-green"
                      style={{ width: `${(counts.completed / counts.total) * 100}%` }}
                    />
                  </div>
                )}

                {/* Bottom accent line */}
                <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-neon-green group-hover:w-full transition-all duration-300" />
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
