import { useState } from 'react';
import { SquareTerminal } from 'lucide-react';
import { useI18n } from '../i18n';

interface SetupPageProps {
  onSetup: (password: string, confirmPassword: string) => Promise<void>;
}

const MIN_LENGTH = 8;

export default function SetupPage({ onSetup }: SetupPageProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { t, toggleLang } = useI18n();

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length >= MIN_LENGTH && password === confirm && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setLoading(true);
    try {
      await onSetup(password, confirm);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('setup.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-theme-bg flex items-center justify-center px-4 relative">
      <button
        onClick={toggleLang}
        className="lang-toggle absolute top-6 right-6"
      >
        {t('lang.toggle')}
      </button>

      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 mb-5">
            <SquareTerminal size={32} className="text-accent" strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl font-semibold text-theme-text">
            {t('setup.title')}
          </h1>
          <p className="text-theme-muted text-sm mt-2">
            {t('setup.subtitle')}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="card p-8">
            <label className="block text-sm font-medium text-theme-text-secondary mb-2">
              {t('setup.password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="*************"
              className="input-field text-base"
              autoFocus
            />
            {tooShort && (
              <p className="mt-1 text-2xs text-status-error">{t('setup.tooShort')}</p>
            )}

            <label className="block text-sm font-medium text-theme-text-secondary mb-2 mt-5">
              {t('setup.confirm')}
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="*************"
              className="input-field text-base"
            />
            {mismatch && (
              <p className="mt-1 text-2xs text-status-error">{t('setup.mismatch')}</p>
            )}

            {error && (
              <div className="mt-4 py-2.5 px-4 bg-status-error/5 border border-status-error/20 rounded-xl text-sm text-status-error">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="btn-primary w-full mt-6 py-3"
            >
              {loading ? t('setup.loading') : t('setup.submit')}
            </button>
          </div>
        </form>

        <div className="mt-4 px-4 py-3 rounded-xl text-xs text-theme-text-tertiary border leading-relaxed text-center">
          {t('setup.tunnelPaused')}
        </div>
      </div>
    </div>
  );
}
