import { useState } from 'react';
import { useI18n } from '../i18n';

interface ProjectFormProps {
  onSubmit: (name: string, path: string) => void;
  onCancel: () => void;
}

export default function ProjectForm({ onSubmit, onCancel }: ProjectFormProps) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const { t } = useI18n();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) return;
    onSubmit(name.trim(), path.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
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
              <input
                type="text"
                placeholder="C:/Projects/my-project"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                className="input-field text-sm"
              />
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
