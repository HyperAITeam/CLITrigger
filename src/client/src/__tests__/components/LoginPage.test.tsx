import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '../../components/LoginPage';

describe('LoginPage', () => {
  it('should render login form', () => {
    render(<LoginPage onLogin={vi.fn()} />);
    expect(screen.getByText('CLI//TRIGGER')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('*************')).toBeInTheDocument();
    expect(screen.getByText('[ ACCESS SYSTEM ]')).toBeInTheDocument();
  });

  it('should disable button when password is empty', () => {
    render(<LoginPage onLogin={vi.fn()} />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('should enable button when password is entered', async () => {
    render(<LoginPage onLogin={vi.fn()} />);
    const input = screen.getByPlaceholderText('*************');
    await userEvent.type(input, 'test123');
    const button = screen.getByRole('button');
    expect(button).not.toBeDisabled();
  });

  it('should call onLogin with password on submit', async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    render(<LoginPage onLogin={onLogin} />);

    const input = screen.getByPlaceholderText('*************');
    await userEvent.type(input, 'mypassword');

    const button = screen.getByRole('button');
    await userEvent.click(button);

    expect(onLogin).toHaveBeenCalledWith('mypassword');
  });

  it('should show error message on login failure', async () => {
    const onLogin = vi.fn().mockRejectedValue(new Error('wrong password'));
    render(<LoginPage onLogin={onLogin} />);

    const input = screen.getByPlaceholderText('*************');
    await userEvent.type(input, 'wrong');
    await userEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(screen.getByText(/ACCESS DENIED/)).toBeInTheDocument();
    });
  });

  it('should show loading state during authentication', async () => {
    let resolveLogin: () => void;
    const onLogin = vi.fn(() => new Promise<void>(resolve => { resolveLogin = resolve; }));
    render(<LoginPage onLogin={onLogin} />);

    const input = screen.getByPlaceholderText('*************');
    await userEvent.type(input, 'test');
    await userEvent.click(screen.getByRole('button'));

    expect(screen.getByText('[ AUTHENTICATING... ]')).toBeInTheDocument();
    resolveLogin!();
  });
});
