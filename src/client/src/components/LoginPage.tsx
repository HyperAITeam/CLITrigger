import { useState } from 'react';
import { SquareTerminal } from 'lucide-react';
import { useI18n } from '../i18n';

interface LoginPageProps {
  onLogin: (password: string) => Promise<void>;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { t, toggleLang } = useI18n();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setError('');
    setLoading(true);
    try {
      await onLogin(password);
    } catch {
      setError(t('login.error'));
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
              {t('login.password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="*************"
              className="input-field text-base"
              autoFocus
            />

            {error && (
              <div className="mt-4 py-2.5 px-4 bg-status-error/5 border border-status-error/20 rounded-xl text-sm text-status-error">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!password || loading}
              className="btn-primary w-full mt-6 py-3"
            >
              {loading ? t('login.loading') : t('login.submit')}
            </button>
          </div>
        </form>

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
