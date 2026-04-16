import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';
import type { Toast as ToastItem, ToastType } from '../hooks/useToast';
import { cn } from '../lib/cn';

const ICONS: Record<ToastType, React.ComponentType<{ size?: number; className?: string }>> = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertCircle,
  info: Info,
};

const COLORS: Record<ToastType, string> = {
  success: 'text-status-success',
  error: 'text-status-error',
  warning: 'text-status-warning',
  info: 'text-accent',
};

const BAR_COLORS: Record<ToastType, string> = {
  success: 'bg-status-success',
  error: 'bg-status-error',
  warning: 'bg-status-warning',
  info: 'bg-accent',
};

interface ToastItemProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

function ToastEntry({ toast, onDismiss }: ToastItemProps) {
  const [visible, setVisible] = useState(false);
  const Icon = ICONS[toast.type];
  const duration = toast.duration ?? 3500;

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className={cn(
        'relative flex items-start gap-3 px-4 py-3 rounded-xl shadow-elevated overflow-hidden',
        'bg-theme-card border border-theme-border min-w-[280px] max-w-sm',
        'transition-all duration-300',
        visible ? 'animate-slide-in-right opacity-100' : 'opacity-0 translate-x-8',
      )}
    >
      <Icon size={16} className={cn('mt-0.5 flex-shrink-0', COLORS[toast.type])} />
      <p className="text-xs text-theme-text flex-1 leading-snug">{toast.message}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        className="p-0.5 rounded text-theme-muted hover:text-theme-text transition-colors flex-shrink-0"
      >
        <X size={12} />
      </button>
      {/* Progress bar */}
      <div
        className={cn('absolute bottom-0 left-0 h-0.5', BAR_COLORS[toast.type])}
        style={{
          animation: `toastProgress ${duration}ms linear forwards`,
        }}
      />
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export default function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return createPortal(
    <div className="fixed bottom-6 right-6 z-toast flex flex-col gap-2 items-end">
      {toasts.map(toast => (
        <ToastEntry key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body
  );
}
