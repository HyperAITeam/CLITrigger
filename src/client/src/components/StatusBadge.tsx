import type { Todo } from '../types';

interface StatusBadgeProps {
  status: Todo['status'];
}

const statusConfig: Record<Todo['status'], { label: string; classes: string }> = {
  pending: {
    label: 'Pending',
    classes: 'bg-gray-600 text-gray-200',
  },
  running: {
    label: 'Running',
    classes: 'bg-blue-600 text-blue-100 animate-pulse',
  },
  completed: {
    label: 'Completed',
    classes: 'bg-green-600 text-green-100',
  },
  failed: {
    label: 'Failed',
    classes: 'bg-red-600 text-red-100',
  },
  stopped: {
    label: 'Stopped',
    classes: 'bg-yellow-600 text-yellow-100',
  },
  merged: {
    label: 'Merged',
    classes: 'bg-purple-600 text-purple-100',
  },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.classes}`}
    >
      {status === 'running' && (
        <span className="mr-1.5 h-2 w-2 rounded-full bg-blue-300 animate-ping" />
      )}
      {config.label}
    </span>
  );
}
