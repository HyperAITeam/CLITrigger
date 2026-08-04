import { useState } from 'react';
import { SquareTerminal } from 'lucide-react';
import { useI18n } from '../i18n';

interface LoginPageProps {
  onLogin: (password: string, remember: boolean) => Promise<void>;
  onChangePassword: (
    oldPassword: string,
    newPassword: string,
    confirmPassword: string,
    remember: boolean,
  ) => Promise<void>;
}

const MIN_LENGTH = 8;

export default function LoginPage({ onLogin, onChangePassword }: LoginPageProps) {
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [changeMode, setChangeMode] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { t, toggleLang } = useI18n();

  const tooShort = changeMode && newPassword.length > 0 && newPassword.length < MIN_LENGTH;
  const mismatch = changeMode && confirm.length > 0 && newPassword !== confirm;
  const canSubmit = changeMode
    ? !!password && newPassword.length >= MIN_LENGTH && newPassword === confirm
    : !!password;

  const toggleMode = () => {
    setChangeMode((v) => !v);
    setNewPassword('');
    setConfirm('');
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || loading) return;
    setError('');
    setLoading(true);
    try {
      if (changeMode) {
        await onChangePassword(password, newPassword, confirm, remember);
      } else {
        await onLogin(password, remember);
      }
    } catch (err) {
      // In change mode the server message (e.g. wrong current password) is more useful.
      setError(changeMode && err instanceof Error && err.message ? err.message : t('login.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-theme-bg flex items-center justify-center px-4 relative">
      {/* Language toggle */}
      <button
        onClick={toggleLang}
        className="lang-toggle absolute top-6 right-6"
      >
        {t('lang.toggle')}
      </button>

      <div className="w-full max-w-sm animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 mb-5">
            <SquareTerminal size={32} className="text-accent" strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl font-semibold text-theme-text">
            {t('login.title')}
          </h1>
          <p className="text-theme-muted text-sm mt-2">
            {t('login.subtitle')}
          </p>
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit}>
          <div className="card p-8">
            <label className="block text-sm font-medium text-theme-text-secondary mb-2">
              {changeMode ? t('account.oldPassword') : t('login.password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="*************"
              className="input-field text-base"
              autoComplete="current-password"
              autoFocus
            />

            {changeMode && (
              <>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2 mt-4">
                  {t('account.newPassword')}
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input-field text-base"
                  autoComplete="new-password"
                  aria-label={t('account.newPassword')}
                />
                {tooShort && (
                  <p className="mt-1 text-2xs text-status-error">{t('account.tooShort')}</p>
                )}

                <label className="block text-sm font-medium text-theme-text-secondary mb-2 mt-4">
                  {t('account.confirm')}
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="input-field text-base"
                  autoComplete="new-password"
                  aria-label={t('account.confirm')}
                />
                {mismatch && (
                  <p className="mt-1 text-2xs text-status-error">{t('account.mismatch')}</p>
                )}
              </>
            )}

            {error && (
              <div className="mt-4 py-2.5 px-4 bg-status-error/5 border border-status-error/20 rounded-xl text-sm text-status-error">
                {error}
              </div>
            )}

            <label className="flex items-center gap-2 mt-5 text-sm text-theme-text-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="accent-accent w-4 h-4"
              />
              {t('login.rememberMe')}
            </label>

            <button
              type="submit"
              disabled={!canSubmit || loading}
              className="btn-primary w-full mt-6 py-3"
            >
              {loading ? t('login.loading') : changeMode ? t('login.changeSubmit') : t('login.submit')}
            </button>
          </div>
        </form>

        <div className="mt-4 flex items-center justify-center gap-5 text-xs">
          <button
            type="button"
            onClick={toggleMode}
            className="text-theme-muted hover:text-theme-text underline-offset-2 hover:underline"
          >
            {changeMode ? t('login.backToLogin') : t('login.changePassword')}
          </button>
          <button
            type="button"
            onClick={() => setShowForgot((v) => !v)}
            className="text-theme-muted hover:text-theme-text underline-offset-2 hover:underline"
          >
            {t('login.forgot')}
          </button>
        </div>

        {showForgot && (
          <div className="mt-3 px-4 py-3 rounded-xl text-xs text-theme-text-tertiary border leading-relaxed">
            {t('login.forgotHint')}
          </div>
        )}

        <div className="mt-6 text-center text-xs text-theme-text-tertiary">
          {t('login.footer')}
        </div>

        <div className="mt-4 px-2 py-3 rounded-xl text-xs text-theme-text-tertiary border leading-relaxed text-center">
          {t('login.disclaimer')}
        </div>
      </div>
    </div>
  );
}
