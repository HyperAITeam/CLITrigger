import { useState } from 'react';
import { Loader2, FolderOpen } from 'lucide-react';
import { useI18n } from '../i18n';
import { browseNativeFolder } from '../api/projects';
import Modal from './Modal';

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
    <Modal open onClose={onCancel} size="md">
      <div className="card p-8 shadow-2xl rounded-2xl">
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
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <FolderOpen size={16} />
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
    </Modal>
  );
}
