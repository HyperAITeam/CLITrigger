import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useI18n } from '../i18n';

interface BoundaryProps {
  children: ReactNode;
  title: string;
  description: string;
  reloadLabel: string;
}

interface BoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[app] render failed:', error, info);
    window.dispatchEvent(new CustomEvent('app:render-error', { detail: error }));
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="min-h-screen bg-theme-bg flex items-center justify-center p-6">
        <section role="alert" className="card w-full max-w-lg p-8 text-center shadow-elevated">
          <AlertTriangle size={36} className="mx-auto mb-4 text-status-error" />
          <h1 className="text-xl font-semibold text-theme-text mb-2">{this.props.title}</h1>
          <p className="text-sm text-theme-text-secondary mb-6">{this.props.description}</p>
          <button type="button" className="btn-primary mx-auto" onClick={() => window.location.reload()}>
            <RefreshCw size={16} />
            {this.props.reloadLabel}
          </button>
        </section>
      </main>
    );
  }
}

export default function AppErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <ErrorBoundary
      title={t('errors.renderTitle')}
      description={t('errors.renderDescription')}
      reloadLabel={t('errors.reload')}
    >
      {children}
    </ErrorBoundary>
  );
}
