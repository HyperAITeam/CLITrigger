import type { Todo } from '../types';

interface ProgressBarProps {
  todos: Todo[];
}

export default function ProgressBar({ todos }: ProgressBarProps) {
  const total = todos.length;
  if (total === 0) return null;

  const counts = {
    completed: todos.filter((t) => t.status === 'completed').length,
    running: todos.filter((t) => t.status === 'running').length,
    failed: todos.filter((t) => t.status === 'failed').length,
    stopped: todos.filter((t) => t.status === 'stopped').length,
    pending: todos.filter((t) => t.status === 'pending').length,
  };

  const completedPercent = Math.round((counts.completed / total) * 100);

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-400">
          Progress: {counts.completed}/{total} completed ({completedPercent}%)
        </span>
        <div className="flex gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-green-500" /> {counts.completed} done
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" /> {counts.running} running
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-gray-500" /> {counts.pending} pending
          </span>
          {counts.failed > 0 && (
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-red-500" /> {counts.failed} failed
            </span>
          )}
          {counts.stopped > 0 && (
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-yellow-500" /> {counts.stopped} stopped
            </span>
          )}
        </div>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-gray-700">
        <div className="flex h-full">
          {counts.completed > 0 && (
            <div
              className="bg-green-500 transition-all duration-500"
              style={{ width: `${(counts.completed / total) * 100}%` }}
            />
          )}
          {counts.running > 0 && (
            <div
              className="bg-blue-500 transition-all duration-500"
              style={{ width: `${(counts.running / total) * 100}%` }}
            />
          )}
          {counts.failed > 0 && (
            <div
              className="bg-red-500 transition-all duration-500"
              style={{ width: `${(counts.failed / total) * 100}%` }}
            />
          )}
          {counts.stopped > 0 && (
            <div
              className="bg-yellow-500 transition-all duration-500"
              style={{ width: `${(counts.stopped / total) * 100}%` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
