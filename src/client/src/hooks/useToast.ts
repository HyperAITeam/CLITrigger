import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

let toastCounter = 0;

interface ToastContextValue {
  toasts: Toast[];
  show: (message: string, type?: ToastType, duration?: number) => string;
  success: (message: string, duration?: number) => string;
  error: (message: string, duration?: number) => string;
  info: (message: string, duration?: number) => string;
  warning: (message: string, duration?: number) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const activeToastKeys = useRef<Map<string, string>>(new Map());
  const toastKeysById = useRef<Map<string, string>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const key = toastKeysById.current.get(id);
    if (key && activeToastKeys.current.get(key) === id) activeToastKeys.current.delete(key);
    toastKeysById.current.delete(id);
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback((message: string, type: ToastType = 'info', duration = 3500) => {
    const key = `${type}:${message}`;
    const existingId = activeToastKeys.current.get(key);
    if (existingId) return existingId;

    const id = `toast-${++toastCounter}`;
    activeToastKeys.current.set(key, id);
    toastKeysById.current.set(id, key);
    setToasts(prev => [...prev, { id, message, type, duration }]);
    const timer = setTimeout(() => dismiss(id), duration);
    timers.current.set(id, timer);
    return id;
  }, [dismiss]);

  const success = useCallback((msg: string, d?: number) => show(msg, 'success', d), [show]);
  const error = useCallback((msg: string, d?: number) => show(msg, 'error', d), [show]);
  const info = useCallback((msg: string, d?: number) => show(msg, 'info', d), [show]);
  const warning = useCallback((msg: string, d?: number) => show(msg, 'warning', d), [show]);

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    activeToastKeys.current.clear();
    toastKeysById.current.clear();
  }, []);

  const value = useMemo(
    () => ({ toasts, show, success, error, info, warning, dismiss }),
    [toasts, show, success, error, info, warning, dismiss],
  );

  return createElement(ToastContext.Provider, { value }, children);
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used within ToastProvider');
  return value;
}
