import { useState } from 'react';
import { useI18n } from '../i18n';
import FolderBrowser from './FolderBrowser';

interface ProjectFormProps {
  onSubmit: (name: string, path: string) => void;
  onCancel: () => void;
}

export default function ProjectForm({ onSubmit, onCancel }: ProjectFormProps) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [showBrowser, setShowBrowser] = useState(false);
  const { t } = useI18n();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) return;
    onSubmit(name.trim(), path.trim());
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
                  onClick={() => setShowBrowser(true)}
                  className="btn-ghost text-sm px-3 shrink-0"
                  title={t('browse.title')}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
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

      {showBrowser && (
        <FolderBrowser
          initialPath={path || undefined}
          onSelect={(selected) => {
            setPath(selected);
            setShowBrowser(false);
          }}
          onCancel={() => setShowBrowser(false)}
        />
      )}
    </div>
  );
}
