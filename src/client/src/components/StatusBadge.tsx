import type { Todo } from '../types';
import { useI18n } from '../i18n';

interface StatusBadgeProps {
  status: Todo['status'];
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useI18n();

  const config: Record<Todo['status'], { labelKey: string; classes: string }> = {
    pending: {
      labelKey: 'status.pending',
      classes: 'bg-warm-200 text-warm-500',
    },
    running: {
      labelKey: 'status.running',
      classes: 'bg-status-running/10 text-status-running',
    },
    completed: {
      labelKey: 'status.completed',
      classes: 'bg-status-success/10 text-status-success',
    },
    failed: {
      labelKey: 'status.failed',
      classes: 'bg-status-error/10 text-status-error',
    },
    stopped: {
      labelKey: 'status.stopped',
      classes: 'bg-status-warning/10 text-status-warning',
    },
    merged: {
      labelKey: 'status.merged',
      classes: 'bg-status-merged/10 text-status-merged',
    },
  };

  const { labelKey, classes } = config[status];

  return (
    <span className={`badge text-[10px] font-semibold ${classes}`}>
      {status === 'running' && (
        <span className="h-1.5 w-1.5 rounded-full bg-status-running animate-pulse" />
      )}
      {t(labelKey as any)}
    </span>
  );
}
