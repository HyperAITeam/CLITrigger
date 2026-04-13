import { useState } from 'react';
import { useI18n } from '../i18n';
import { browseNativeFolder } from '../api/projects';

interface ProjectFormProps {
  onSubmit: (name: string, path: string) => void;
  onCancel: () => void;
}

export default function ProjectForm({ onSubmit, onCancel }: ProjectFormProps) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const { t } = useI18n();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) return;
    onSubmit(name.trim(), path.trim());
  };

  const handleBrowse = async () => {
    setBrowsing(true);
    try {
      const result = await browseNativeFolder(path || undefined);
      if (result.path) setPath(result.path);
    } catch { /* user cancelled */ }
    setBrowsing(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="w-full max-w-md animate-scale-in">
        <div className="card p-8 shadow-elevated">
          <h2 className="text-lg font-semibold text-warm-800 mb-6">
            {t('form.newProject')}
          </h2>

          <form onSubmit={handleSubmit}>
            <div className="mb-5">
              <label className="block text-sm font-medium text-warm-600 mb-2">
                {t('form.projectName')}
              </label>
              <input
                type="text"
                placeholder="my-project"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field"
                autoFocus
              />
            </div>
            <div className="mb-8">
              <label className="block text-sm font-medium text-warm-600 mb-2">
                {t('form.folderPath')}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="C:/Projects/my-project"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  className="input-field text-sm flex-1"
                />
                <button
                  type="button"
                  onClick={handleBrowse}
                  disabled={browsing}
                  className="btn-ghost text-sm px-3 shrink-0"
                  title={t('browse.title')}
                >
                  {browsing ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="btn-ghost text-sm"
              >
                {t('form.cancel')}
              </button>
              <button
                type="submit"
                disabled={!name.trim() || !path.trim()}
                className="btn-primary text-sm"
              >
                {t('form.create')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
