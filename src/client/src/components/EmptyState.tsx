import { cn } from '../lib/cn';

interface EmptyStateProps {
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: React.ComponentType<{ size?: number }>;
  };
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE = {
  sm: {
    wrapper: 'py-8',
    iconBox: 'w-10 h-10 rounded-xl',
    iconSize: 20,
    title: 'text-sm',
    desc: 'text-xs',
  },
  md: {
    wrapper: 'py-12',
    iconBox: 'w-14 h-14 rounded-2xl',
    iconSize: 28,
    title: 'text-sm',
    desc: 'text-xs',
  },
  lg: {
    wrapper: 'py-20',
    iconBox: 'w-16 h-16 rounded-2xl',
    iconSize: 32,
    title: 'text-base',
    desc: 'text-sm',
  },
} as const;

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = 'md',
  className,
}: EmptyStateProps) {
  const s = SIZE[size];
  const ActionIcon = action?.icon;

  return (
    <div className={cn('text-center animate-fade-in', s.wrapper, className)}>
      {Icon && (
        <div className={cn('inline-flex items-center justify-center mb-4 bg-theme-hover', s.iconBox)}>
          <Icon size={s.iconSize} strokeWidth={1.5} className="text-theme-muted" />
        </div>
      )}
      <p className={cn('font-medium text-theme-text-secondary', s.title)}>{title}</p>
      {description && (
        <p className={cn('mt-1 text-theme-muted', s.desc)}>{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="btn-primary btn-sm mt-4 inline-flex items-center gap-1.5"
        >
          {ActionIcon && <ActionIcon size={14} />}
          {action.label}
        </button>
      )}
    </div>
  );
}
