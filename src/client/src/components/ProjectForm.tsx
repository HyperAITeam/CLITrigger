import { useState } from 'react';

interface ProjectFormProps {
  onSubmit: (name: string, path: string) => void;
  onCancel: () => void;
}

export default function ProjectForm({ onSubmit, onCancel }: ProjectFormProps) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) return;
    onSubmit(name.trim(), path.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-md relative animate-slide-up">
        <div
          className="bg-street-800 border-2 border-street-500 p-8"
          style={{ clipPath: 'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))' }}
        >
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-8 h-0.5 bg-neon-green" />
          <div className="absolute top-0 left-0 w-0.5 h-8 bg-neon-green" />
          <div className="absolute bottom-0 right-0 w-8 h-0.5 bg-neon-cyan" />
          <div className="absolute bottom-0 right-0 w-0.5 h-8 bg-neon-cyan" />

          <h2 className="text-sm font-mono font-bold text-neon-green tracking-[0.2em] uppercase mb-6">
            &gt; NEW_PROJECT
          </h2>

          <form onSubmit={handleSubmit}>
            <div className="mb-5">
              <label className="block text-xs font-mono text-street-400 mb-2 uppercase tracking-wider">
                Project Name
              </label>
              <input
                type="text"
                placeholder="my-project"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="street-input"
                autoFocus
              />
            </div>
            <div className="mb-8">
              <label className="block text-xs font-mono text-street-400 mb-2 uppercase tracking-wider">
                Folder Path
              </label>
              <input
                type="text"
                placeholder="C:/Projects/my-project"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                className="street-input text-sm"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="font-mono text-xs text-street-400 hover:text-white px-4 py-2.5 transition-colors uppercase tracking-wider"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || !path.trim()}
                className="street-btn bg-neon-green px-6 py-2.5 text-xs text-street-900 hover:bg-neon-green/80 hover:shadow-neon-green disabled:opacity-30 disabled:cursor-not-allowed"
              >
                CREATE
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
