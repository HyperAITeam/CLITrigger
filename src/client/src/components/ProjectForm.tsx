import { useState, useEffect } from 'react';
import { Loader2, FolderOpen } from 'lucide-react';
import { useI18n } from '../i18n';
import { browseNativeFolder, listWslDistros } from '../api/projects';
import Modal from './Modal';

interface ProjectFormProps {
  onSubmit: (name: string, path: string, wslDistro?: string) => Promise<void>;
  onCancel: () => void;
}

export default function ProjectForm({ onSubmit, onCancel }: ProjectFormProps) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // '' = local Windows/macOS path; otherwise the project lives inside that distro.
  const [wslDistro, setWslDistro] = useState('');
  const [distros, setDistros] = useState<string[]>([]);
  const { t } = useI18n();

  useEffect(() => {
    listWslDistros().then((r) => setDistros(r.distros)).catch(() => setDistros([]));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) return;
    setError('');
    setSubmitting(true);
    try {
      await onSubmit(name.trim(), path.trim(), wslDistro || undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || t('form.createError'));
    } finally {
      setSubmitting(false);
    }
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
            {distros.length > 0 && (
              <div className="mb-5">
                <label className="block text-sm font-medium text-warm-600 mb-2">
                  {t('form.location')}
                </label>
                <select
                  value={wslDistro}
                  onChange={(e) => { setWslDistro(e.target.value); setPath(''); }}
                  className="input-field text-sm"
                >
                  <option value="">{t('form.locationLocal')}</option>
                  {distros.map((d) => (
                    <option key={d} value={d}>WSL · {d}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="mb-8">
              <label className="block text-sm font-medium text-warm-600 mb-2">
                {t('form.folderPath')}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={wslDistro ? '/home/you/git/my-project' : 'C:/Projects/my-project'}
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  className="input-field text-sm flex-1"
                />
                {/* The native picker only yields Windows paths, so it cannot help
                    pick a path inside a distro. */}
                {!wslDistro && (
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
                )}
              </div>
              {wslDistro && (
                <p className="text-xs text-warm-500 mt-2">{t('form.wslPathHint')}</p>
              )}
            </div>
            {error && (
              <p className="text-sm mb-4" style={{ color: 'var(--color-danger, #ef4444)' }}>{error}</p>
            )}
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
                disabled={!name.trim() || !path.trim() || submitting}
                className="btn-primary text-sm"
              >
                {submitting ? t('form.creating') : t('form.create')}
              </button>
            </div>
          </form>
      </div>
    </Modal>
  );
}
