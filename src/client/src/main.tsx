import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider, useI18n } from './i18n';
import { ThemeContext, useThemeProvider } from './hooks/useTheme';
import { NotificationContext, useNotificationProvider } from './hooks/useNotification';
import { initPlugins } from './plugins/init';
import { ToastProvider, useToast } from './hooks/useToast';
import ToastContainer from './components/Toast';
import AppErrorBoundary from './components/AppErrorBoundary';
import { getErrorMessage, isResizeObserverLoopError } from './lib/errors';
import { ApiError } from './api/client';
import './index.css';

initPlugins();

function GlobalToasts() {
  const { toasts, error, dismiss } = useToast();
  const { t } = useI18n();

  useEffect(() => {
    const report = (reason: unknown) => {
      // xterm's WriteBuffer/Viewport schedule bare setTimeout/rAF callbacks
      // that can fire after Terminal.dispose() and read RenderService's
      // `dimensions` getter off the already-cleared renderer, throwing
      // "Cannot read properties of undefined (reading 'dimensions')" as an
      // uncaught error on terminal mount/unmount/popout. Harmless teardown
      // race inside xterm (nothing in our code reads `.dimensions`), so keep
      // it out of the failure toast.
      const msg = getErrorMessage(reason, '');
      if (msg.includes("(reading 'dimensions')")) {
        console.debug('[global-error] suppressed xterm teardown error:', reason);
        return;
      }
      console.error('[global-error]', reason);
      // ApiError messages are user-safe (server `error` field or "HTTP <status>");
      // raw internals of anything else stay in the console.
      error(reason instanceof ApiError ? reason.message : t('errors.unexpected'), 7000);
    };
    const onError = (event: ErrorEvent) => {
      const reason = event.error ?? event.message;
      if (isResizeObserverLoopError(reason)) {
        event.preventDefault();
        return;
      }
      report(reason);
    };
    const onRejection = (event: PromiseRejectionEvent) => report(event.reason);
    const onRenderError = (event: Event) => report((event as CustomEvent).detail);

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('app:render-error', onRenderError);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('app:render-error', onRenderError);
    };
  }, [error, t]);

  return <ToastContainer toasts={toasts} onDismiss={dismiss} />;
}

function Root() {
  const themeValue = useThemeProvider();
  const notificationValue = useNotificationProvider();

  return (
    <ThemeContext.Provider value={themeValue}>
      <NotificationContext.Provider value={notificationValue}>
        <ToastProvider>
          <I18nProvider>
            <AppErrorBoundary>
              <App />
            </AppErrorBoundary>
            <GlobalToasts />
          </I18nProvider>
        </ToastProvider>
      </NotificationContext.Provider>
    </ThemeContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
