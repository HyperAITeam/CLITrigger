import type { Todo } from '../types';
import { useI18n } from '../i18n';
import { Clock, Loader2, CheckCircle2, XCircle, PauseCircle, GitMerge } from 'lucide-react';
import type { ReactNode } from 'react';

interface StatusBadgeProps {
  status: Todo['status'];
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useI18n();

  const config: Record<Todo['status'], { labelKey: string; classes: string; icon: ReactNode }> = {
    pending: {
      labelKey: 'status.pending',
      classes: 'bg-warm-200 text-warm-500',
      icon: <Clock size={10} />,
    },
    running: {
      labelKey: 'status.running',
      classes: 'bg-status-running/10 text-status-running',
      icon: <Loader2 size={10} className="animate-spin" />,
    },
    completed: {
      labelKey: 'status.completed',
      classes: 'bg-status-success/10 text-status-success',
      icon: <CheckCircle2 size={10} />,
    },
    failed: {
      labelKey: 'status.failed',
      classes: 'bg-status-error/10 text-status-error',
      icon: <XCircle size={10} />,
    },
    stopped: {
      labelKey: 'status.stopped',
      classes: 'bg-status-warning/10 text-status-warning',
      icon: <PauseCircle size={10} />,
    },
    merged: {
      labelKey: 'status.merged',
      classes: 'bg-status-merged/10 text-status-merged',
      icon: <GitMerge size={10} />,
    },
  };

  const { labelKey, classes, icon } = config[status];

  return (
    <span className={`badge text-2xs font-semibold ${classes}`}>
      {icon}
      {t(labelKey as any)}
    </span>
  );
}
