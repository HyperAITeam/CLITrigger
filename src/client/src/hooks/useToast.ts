import { useState, useCallback, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

let toastCounter = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback((message: string, type: ToastType = 'info', duration = 3500) => {
    const id = `toast-${++toastCounter}`;
    setToasts(prev => [...prev, { id, message, type, duration }]);
    const timer = setTimeout(() => dismiss(id), duration);
    timers.current.set(id, timer);
    return id;
  }, [dismiss]);

  const success = useCallback((msg: string, d?: number) => show(msg, 'success', d), [show]);
  const error = useCallback((msg: string, d?: number) => show(msg, 'error', d), [show]);
  const info = useCallback((msg: string, d?: number) => show(msg, 'info', d), [show]);
  const warning = useCallback((msg: string, d?: number) => show(msg, 'warning', d), [show]);

  return { toasts, show, success, error, info, warning, dismiss };
}
