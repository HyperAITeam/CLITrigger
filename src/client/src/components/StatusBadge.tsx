import type { Todo } from '../types';
import { useI18n } from '../i18n';
import { Loader2 } from 'lucide-react';

interface StatusBadgeProps {
  status: Todo['status'];
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useI18n();

  const config: Record<Todo['status'], { labelKey: string; dotClass: string }> = {
    pending: {
      labelKey: 'status.pending',
      dotClass: 'bg-warm-400',
    },
    running: {
      labelKey: 'status.running',
      dotClass: 'bg-status-running',
    },
    completed: {
      labelKey: 'status.completed',
      dotClass: 'bg-status-success',
    },
    failed: {
      labelKey: 'status.failed',
      dotClass: 'bg-status-error',
    },
    stopped: {
      labelKey: 'status.stopped',
      dotClass: 'bg-status-warning',
    },
    merged: {
      labelKey: 'status.merged',
      dotClass: 'bg-warm-400',
    },
  };

  const { labelKey, dotClass } = config[status];

  return (
    <span className="inline-flex items-center gap-1.5 text-2xs font-medium text-warm-500 whitespace-nowrap flex-shrink-0">
      {status === 'running'
        ? <Loader2 size={11} className="animate-spin text-status-running" />
        : <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />}
      {t(labelKey as any)}
    </span>
  );
}
