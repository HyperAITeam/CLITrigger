import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from '../../components/StatusBadge';

describe('StatusBadge', () => {
  it('should render IDLE for pending status', () => {
    render(<StatusBadge status="pending" />);
    expect(screen.getByText('IDLE')).toBeInTheDocument();
  });

  it('should render LIVE for running status', () => {
    render(<StatusBadge status="running" />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('should render DONE for completed status', () => {
    render(<StatusBadge status="completed" />);
    expect(screen.getByText('DONE')).toBeInTheDocument();
  });

  it('should render FAIL for failed status', () => {
    render(<StatusBadge status="failed" />);
    expect(screen.getByText('FAIL')).toBeInTheDocument();
  });

  it('should render STOP for stopped status', () => {
    render(<StatusBadge status="stopped" />);
    expect(screen.getByText('STOP')).toBeInTheDocument();
  });

  it('should render MRGD for merged status', () => {
    render(<StatusBadge status="merged" />);
    expect(screen.getByText('MRGD')).toBeInTheDocument();
  });

  it('should show ping animation for running status', () => {
    const { container } = render(<StatusBadge status="running" />);
    const pingElement = container.querySelector('.animate-ping');
    expect(pingElement).toBeInTheDocument();
  });

  it('should not show ping animation for non-running status', () => {
    const { container } = render(<StatusBadge status="completed" />);
    const pingElement = container.querySelector('.animate-ping');
    expect(pingElement).not.toBeInTheDocument();
  });
});
