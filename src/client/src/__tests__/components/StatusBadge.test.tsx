import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from '../../components/StatusBadge';
import { I18nProvider } from '../../i18n';

function renderWithProviders(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  localStorage.setItem('clitrigger-lang', 'en');
});

describe('StatusBadge', () => {
  it('should render Idle for pending status', () => {
    renderWithProviders(<StatusBadge status="pending" />);
    expect(screen.getByText('Idle')).toBeInTheDocument();
  });

  it('should render Running for running status', () => {
    renderWithProviders(<StatusBadge status="running" />);
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('should render Done for completed status', () => {
    renderWithProviders(<StatusBadge status="completed" />);
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('should render Failed for failed status', () => {
    renderWithProviders(<StatusBadge status="failed" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('should render Stopped for stopped status', () => {
    renderWithProviders(<StatusBadge status="stopped" />);
    expect(screen.getByText('Stopped')).toBeInTheDocument();
  });

  it('should render Merged for merged status', () => {
    renderWithProviders(<StatusBadge status="merged" />);
    expect(screen.getByText('Merged')).toBeInTheDocument();
  });

  it('should show spin animation for running status', () => {
    const { container } = renderWithProviders(<StatusBadge status="running" />);
    const spinElement = container.querySelector('.animate-spin');
    expect(spinElement).toBeInTheDocument();
  });

  it('should not show spin animation for non-running status', () => {
    const { container } = renderWithProviders(<StatusBadge status="completed" />);
    const spinElement = container.querySelector('.animate-spin');
    expect(spinElement).not.toBeInTheDocument();
  });
});
