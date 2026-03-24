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

  // Fetch projects on mount
  useEffect(() => {
    projectsApi.getProjects()
      .then((data) => {
        setProjects(data);
        // Fetch status for each project
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

  // Listen for real-time project status updates
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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">CLITrigger</h1>
          <p className="text-gray-400 mt-1">Manage your projects and trigger Claude CLI tasks</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors shadow-lg shadow-blue-600/20"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Project
          </button>
          <button
            onClick={onLogout}
            className="rounded-lg bg-gray-700 px-3 py-2.5 text-sm text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
            title="Logout"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading projects...</div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl bg-gray-800 border border-gray-700 p-12 text-center">
          <p className="text-gray-400 text-lg">No projects yet.</p>
          <p className="text-gray-500 mt-2">Create your first project to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const counts = statusMap[project.id] || { total: 0, completed: 0, running: 0 };
            return (
              <Link
                key={project.id}
                to={`/projects/${project.id}`}
                className="group relative rounded-xl bg-gray-800 border border-gray-700 p-5 hover:border-gray-600 hover:bg-gray-750 transition-all shadow-lg hover:shadow-xl"
              >
                <button
                  onClick={(e) => handleDeleteProject(project.id, e)}
                  className="absolute top-3 right-3 rounded p-1 text-gray-500 hover:bg-red-900/40 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                  title="Delete project"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                <h3 className="text-lg font-semibold text-white group-hover:text-blue-400 transition-colors">
                  {project.name}
                </h3>
                <p className="mt-1 text-sm text-gray-400 font-mono truncate">{project.path}</p>

                <div className="mt-4 flex items-center gap-4 text-sm">
                  <span className="text-gray-400">
                    {counts.total} task{counts.total !== 1 ? 's' : ''}
                  </span>
                  {counts.running > 0 && (
                    <span className="flex items-center gap-1 text-blue-400">
                      <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                      {counts.running} running
                    </span>
                  )}
                  {counts.completed > 0 && (
                    <span className="text-green-400">
                      {counts.completed} done
                    </span>
                  )}
                </div>

                {counts.total > 0 && (
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
                    <div
                      className="h-full bg-green-500 transition-all"
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
