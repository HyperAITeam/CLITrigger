import type { Todo } from '../types';

interface StatusBadgeProps {
  status: Todo['status'];
}

const statusConfig: Record<Todo['status'], { label: string; classes: string }> = {
  pending: {
    label: 'IDLE',
    classes: 'bg-street-600 text-street-300 border-street-500',
  },
  running: {
    label: 'LIVE',
    classes: 'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/50 animate-pulse',
  },
  completed: {
    label: 'DONE',
    classes: 'bg-neon-green/10 text-neon-green border-neon-green/50',
  },
  failed: {
    label: 'FAIL',
    classes: 'bg-neon-pink/10 text-neon-pink border-neon-pink/50',
  },
  stopped: {
    label: 'STOP',
    classes: 'bg-neon-yellow/10 text-neon-yellow border-neon-yellow/50',
  },
  merged: {
    label: 'MRGD',
    classes: 'bg-neon-purple/10 text-neon-purple border-neon-purple/50',
  },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <span
      className={`inline-flex items-center border px-2 py-0.5 text-[10px] font-mono font-bold tracking-widest ${config.classes}`}
    >
      {status === 'running' && (
        <span className="mr-1.5 h-1.5 w-1.5 bg-neon-cyan animate-ping" />
      )}
      {config.label}
    </span>
  );
}
