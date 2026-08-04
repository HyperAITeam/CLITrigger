import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '../../components/LoginPage';
import { I18nProvider } from '../../i18n';

function renderWithProviders(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  localStorage.setItem('clitrigger-lang', 'en');
});

describe('LoginPage', () => {
  it('should render login form', () => {
    renderWithProviders(<LoginPage onLogin={vi.fn()} onChangePassword={vi.fn()} />);
    expect(screen.getByText('CLITrigger')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('*************')).toBeInTheDocument();
    expect(screen.getByText('Sign In')).toBeInTheDocument();
  });

  it('should disable button when password is empty', () => {
    renderWithProviders(<LoginPage onLogin={vi.fn()} onChangePassword={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Sign In' });
    expect(button).toBeDisabled();
  });

  it('should enable button when password is entered', async () => {
    renderWithProviders(<LoginPage onLogin={vi.fn()} onChangePassword={vi.fn()} />);
    const input = screen.getByPlaceholderText('*************');
    await userEvent.type(input, 'test123');
    const button = screen.getByRole('button', { name: 'Sign In' });
    expect(button).not.toBeDisabled();
  });

  it('should call onLogin with password and remember=false on submit', async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<LoginPage onLogin={onLogin} onChangePassword={vi.fn()} />);

    const input = screen.getByPlaceholderText('*************');
    await userEvent.type(input, 'mypassword');

    const button = screen.getByRole('button', { name: 'Sign In' });
    await userEvent.click(button);

    expect(onLogin).toHaveBeenCalledWith('mypassword', false);
  });

  it('should call onLogin with remember=true when checkbox is checked', async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<LoginPage onLogin={onLogin} onChangePassword={vi.fn()} />);

    const input = screen.getByPlaceholderText('*************');
    await userEvent.type(input, 'mypassword');
    await userEvent.click(screen.getByRole('checkbox'));

    const button = screen.getByRole('button', { name: 'Sign In' });
    await userEvent.click(button);

    expect(onLogin).toHaveBeenCalledWith('mypassword', true);
  });

  it('should show error message on login failure', async () => {
    const onLogin = vi.fn().mockRejectedValue(new Error('wrong password'));
    renderWithProviders(<LoginPage onLogin={onLogin} onChangePassword={vi.fn()} />);

    const input = screen.getByPlaceholderText('*************');
    await userEvent.type(input, 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText(/Access denied/)).toBeInTheDocument();
    });
  });

  it('should submit change-password flow with current, new, confirm and remember', async () => {
    const onChangePassword = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<LoginPage onLogin={vi.fn()} onChangePassword={onChangePassword} />);

    await userEvent.click(screen.getByText('Change password'));
    await userEvent.type(screen.getByPlaceholderText('*************'), 'oldpass123');
    await userEvent.type(screen.getByLabelText('New password'), 'newpass123');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'newpass123');
    await userEvent.click(screen.getByRole('button', { name: 'Change password & sign in' }));

    expect(onChangePassword).toHaveBeenCalledWith('oldpass123', 'newpass123', 'newpass123', false);
  });

  it('should keep change-password submit disabled while passwords mismatch', async () => {
    renderWithProviders(<LoginPage onLogin={vi.fn()} onChangePassword={vi.fn()} />);

    await userEvent.click(screen.getByText('Change password'));
    await userEvent.type(screen.getByPlaceholderText('*************'), 'oldpass123');
    await userEvent.type(screen.getByLabelText('New password'), 'newpass123');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'different');

    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change password & sign in' })).toBeDisabled();
  });

  it('should show loading state during authentication', async () => {
    let resolveLogin: () => void;
    const onLogin = vi.fn(() => new Promise<void>(resolve => { resolveLogin = resolve; }));
    renderWithProviders(<LoginPage onLogin={onLogin} onChangePassword={vi.fn()} />);

    const input = screen.getByPlaceholderText('*************');
    await userEvent.type(input, 'test');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(screen.getByText('Authenticating...')).toBeInTheDocument();
    resolveLogin!();
  });
});
