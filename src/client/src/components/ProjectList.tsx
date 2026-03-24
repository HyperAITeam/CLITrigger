import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Project, Todo } from '../types';
import ProjectForm from './ProjectForm';

interface ProjectListProps {
  projects: Project[];
  todos: Todo[];
  onAddProject: (name: string, path: string) => void;
}

export default function ProjectList({ projects, todos, onAddProject }: ProjectListProps) {
  const [showForm, setShowForm] = useState(false);

  const getTodoCounts = (projectId: string) => {
    const projectTodos = todos.filter((t) => t.project_id === projectId);
    return {
      total: projectTodos.length,
      completed: projectTodos.filter((t) => t.status === 'completed').length,
      running: projectTodos.filter((t) => t.status === 'running').length,
    };
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">CLITrigger</h1>
          <p className="text-gray-400 mt-1">Manage your projects and trigger Claude CLI tasks</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors shadow-lg shadow-blue-600/20"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-xl bg-gray-800 border border-gray-700 p-12 text-center">
          <p className="text-gray-400 text-lg">No projects yet.</p>
          <p className="text-gray-500 mt-2">Create your first project to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const counts = getTodoCounts(project.id);
            return (
              <Link
                key={project.id}
                to={`/projects/${project.id}`}
                className="group rounded-xl bg-gray-800 border border-gray-700 p-5 hover:border-gray-600 hover:bg-gray-750 transition-all shadow-lg hover:shadow-xl"
              >
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
          onSubmit={(name, path) => {
            onAddProject(name, path);
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
