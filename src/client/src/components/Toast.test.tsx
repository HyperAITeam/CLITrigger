import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToastProvider, useToast } from '../hooks/useToast';
import ToastContainer from './Toast';

function Producer() {
  const { error } = useToast();
  return (
    <>
      <button onClick={() => error('Project creation failed')}>Trigger error</button>
      <button onClick={() => { error('Repeated error'); error('Repeated error'); }}>Trigger duplicate</button>
    </>
  );
}

function Host() {
  const { toasts, dismiss } = useToast();
  return <ToastContainer toasts={toasts} onDismiss={dismiss} />;
}

describe('global toast notifications', () => {
  it('shows and dismisses an error raised by another component', () => {
    render(
      <ToastProvider>
        <Producer />
        <Host />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Trigger error' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Project creation failed');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('Project creation failed')).not.toBeInTheDocument();
  });

  it('does not stack identical active notifications', () => {
    render(
      <ToastProvider>
        <Producer />
        <Host />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Trigger duplicate' }));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Repeated error');
  });
});
