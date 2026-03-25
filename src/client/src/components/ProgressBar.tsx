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
    merged: todos.filter((t) => t.status === 'merged').length,
  };

  const doneCount = counts.completed + counts.merged;
  const completedPercent = Math.round((doneCount / total) * 100);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-sm text-white">
          <span className="text-neon-green">{completedPercent}%</span>
          <span className="text-street-500 ml-2">// {doneCount}/{total} COMPLETE</span>
        </span>
        <div className="flex gap-4 text-[10px] font-mono tracking-wider">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 bg-neon-green" /> {counts.completed} DONE
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 bg-neon-cyan animate-pulse" /> {counts.running} LIVE
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 bg-street-500" /> {counts.pending} IDLE
          </span>
          {counts.failed > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 bg-neon-pink" /> {counts.failed} FAIL
            </span>
          )}
          {counts.stopped > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 bg-neon-yellow" /> {counts.stopped} STOP
            </span>
          )}
          {counts.merged > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 bg-neon-purple" /> {counts.merged} MRGD
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 w-full overflow-hidden bg-street-700 relative">
        <div className="flex h-full">
          {counts.completed > 0 && (
            <div
              className="bg-neon-green transition-all duration-500 shadow-neon-green"
              style={{ width: `${(counts.completed / total) * 100}%` }}
            />
          )}
          {counts.running > 0 && (
            <div
              className="bg-neon-cyan transition-all duration-500 animate-pulse"
              style={{ width: `${(counts.running / total) * 100}%` }}
            />
          )}
          {counts.failed > 0 && (
            <div
              className="bg-neon-pink transition-all duration-500"
              style={{ width: `${(counts.failed / total) * 100}%` }}
            />
          )}
          {counts.stopped > 0 && (
            <div
              className="bg-neon-yellow transition-all duration-500"
              style={{ width: `${(counts.stopped / total) * 100}%` }}
            />
          )}
          {counts.merged > 0 && (
            <div
              className="bg-neon-purple transition-all duration-500"
              style={{ width: `${(counts.merged / total) * 100}%` }}
            />
          )}
        </div>
      </div>
      <div className="h-px bg-gradient-to-r from-neon-green/30 via-transparent to-neon-pink/30 mt-1" />
    </div>
  );
}
