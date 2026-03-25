import { useState } from 'react';

interface LoginPageProps {
  onLogin: (password: string) => Promise<void>;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setError('');
    setLoading(true);
    try {
      await onLogin(password);
    } catch {
      setError('ACCESS DENIED. TRY AGAIN.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-street-900 flex items-center justify-center px-4 relative scanline">
      <div className="noise-overlay" />

      {/* Background grid lines */}
      <div className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `
            linear-gradient(rgba(57,255,20,0.3) 1px, transparent 1px),
            linear-gradient(90deg, rgba(57,255,20,0.3) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
        }}
      />

      <div className="w-full max-w-md relative z-10 animate-slide-up">
        {/* Logo area */}
        <div className="text-center mb-10">
          <div className="inline-block relative">
            <h1
              className="text-5xl font-mono font-bold text-neon-green glitch-text"
              data-text="CLI//TRIGGER"
            >
              CLI//TRIGGER
            </h1>
            <div className="h-0.5 bg-neon-green mt-2 shadow-neon-green" />
          </div>
          <p className="text-street-400 font-mono text-sm mt-4 tracking-[0.3em] uppercase">
            Authentication Required
          </p>
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} className="relative">
          <div className="bg-street-800 border-2 border-street-500 p-8"
            style={{ clipPath: 'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))' }}
          >
            {/* Corner accent */}
            <div className="absolute top-0 left-0 w-8 h-0.5 bg-neon-green" />
            <div className="absolute top-0 left-0 w-0.5 h-8 bg-neon-green" />
            <div className="absolute bottom-0 right-0 w-8 h-0.5 bg-neon-pink" />
            <div className="absolute bottom-0 right-0 w-0.5 h-8 bg-neon-pink" />

            <label className="block text-xs font-mono font-bold text-neon-green tracking-[0.2em] uppercase mb-3">
              &gt; ENTER_PASSKEY
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="*************"
              className="street-input text-lg tracking-widest"
              autoFocus
            />

            {error && (
              <div className="mt-4 py-2 px-3 bg-neon-pink/10 border border-neon-pink/50 font-mono text-sm text-neon-pink">
                ! {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!password || loading}
              className="street-btn w-full mt-6 bg-neon-green px-6 py-4 text-street-900 text-sm hover:bg-neon-green/80 hover:shadow-neon-green disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {loading ? '[ AUTHENTICATING... ]' : '[ ACCESS SYSTEM ]'}
            </button>
          </div>
        </form>

        {/* Decorative footer */}
        <div className="mt-6 text-center font-mono text-xs text-street-500 tracking-widest">
          SYS.AUTH.V2 // ENCRYPTED
        </div>
      </div>
    </div>
  );
}
