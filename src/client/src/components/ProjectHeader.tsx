import type { Project, Todo } from '../types';

interface ProjectHeaderProps {
  project: Project;
  todos: Todo[];
  onStartAll: () => void;
  onStopAll: () => void;
}

export default function ProjectHeader({ project, todos, onStartAll, onStopAll }: ProjectHeaderProps) {
  const hasStartable = todos.some(
    (t) => t.status === 'pending' || t.status === 'failed' || t.status === 'stopped'
  );
  const hasRunning = todos.some((t) => t.status === 'running');

  return (
    <div className="mb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{project.name}</h1>
          <p className="mt-1 text-sm text-gray-400 font-mono">{project.path}</p>
          <p className="mt-1 text-xs text-gray-500">
            Branch: <span className="text-blue-400">{project.default_branch}</span>
          </p>
        </div>

        <div className="flex gap-3 flex-shrink-0">
          <button
            onClick={onStartAll}
            disabled={!hasStartable}
            className="relative flex items-center gap-2 rounded-lg bg-green-600 px-6 py-3 text-base font-bold text-white shadow-lg shadow-green-600/25 hover:bg-green-500 hover:shadow-green-500/30 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all active:scale-95"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            START ALL
            {hasStartable && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-300" />
              </span>
            )}
          </button>

          <button
            onClick={onStopAll}
            disabled={!hasRunning}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-6 py-3 text-base font-bold text-white shadow-lg shadow-red-600/25 hover:bg-red-500 hover:shadow-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all active:scale-95"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h12v12H6z" />
            </svg>
            STOP ALL
          </button>
        </div>
      </div>
    </div>
  );
}
