import { useState } from 'react';
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
    <div className="min-h-screen bg-warm-100 flex items-center justify-center px-4 relative">
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
            <svg className="w-8 h-8 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-warm-800">
            {t('login.title')}
          </h1>
          <p className="text-warm-500 text-sm mt-2">
            {t('login.subtitle')}
          </p>
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit}>
          <div className="card p-8">
            <label className="block text-sm font-medium text-warm-600 mb-2">
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

        <div className="mt-6 text-center text-xs text-warm-400">
          {t('login.footer')}
        </div>

        <div className="mt-4 px-2 py-3 bg-warm-200/60 border border-warm-300/50 rounded-xl text-xs text-warm-500 leading-relaxed text-center">
          {t('login.disclaimer')}
        </div>
      </div>
    </div>
  );
}
