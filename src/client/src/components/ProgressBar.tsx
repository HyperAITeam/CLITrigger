import type { Todo } from '../types';
import { useI18n } from '../i18n';

interface ProgressBarProps {
  todos: Todo[];
}

export default function ProgressBar({ todos }: ProgressBarProps) {
  const total = todos.length;
  const { t } = useI18n();
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <span className="text-sm font-medium text-warm-700">
          <span className="text-accent-dark">{completedPercent}%</span>
          <span className="text-warm-400 ml-2">{doneCount}/{total} {t('progress.complete')}</span>
        </span>
        <div className="flex flex-wrap gap-2 sm:gap-3 text-xs text-warm-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-status-success" /> {counts.completed} {t('progress.done')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-status-running animate-pulse" /> {counts.running} {t('progress.live')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-warm-300" /> {counts.pending} {t('progress.idle')}
          </span>
          {counts.failed > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-status-error" /> {counts.failed} {t('progress.fail')}
            </span>
          )}
          {counts.stopped > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-status-warning" /> {counts.stopped} {t('progress.stop')}
            </span>
          )}
          {counts.merged > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-status-merged" /> {counts.merged} {t('progress.merged')}
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 w-full overflow-hidden bg-warm-200 rounded-full">
        <div className="flex h-full">
          {counts.completed > 0 && (
            <div
              className="bg-status-success transition-all duration-500 first:rounded-l-full last:rounded-r-full"
              style={{ width: `${(counts.completed / total) * 100}%` }}
            />
          )}
          {counts.running > 0 && (
            <div
              className="bg-status-running transition-all duration-500 animate-pulse last:rounded-r-full"
              style={{ width: `${(counts.running / total) * 100}%` }}
            />
          )}
          {counts.failed > 0 && (
            <div
              className="bg-status-error transition-all duration-500 last:rounded-r-full"
              style={{ width: `${(counts.failed / total) * 100}%` }}
            />
          )}
          {counts.stopped > 0 && (
            <div
              className="bg-status-warning transition-all duration-500 last:rounded-r-full"
              style={{ width: `${(counts.stopped / total) * 100}%` }}
            />
          )}
          {counts.merged > 0 && (
            <div
              className="bg-status-merged transition-all duration-500 last:rounded-r-full"
              style={{ width: `${(counts.merged / total) * 100}%` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
