import { useState } from 'react';
import { useI18n } from '../i18n';

interface PipelineFormProps {
  onSave: (title: string, description: string) => Promise<void>;
  onCancel: () => void;
}

export default function PipelineForm({ onSave, onCancel }: PipelineFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const { t } = useI18n();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    setSaving(true);
    try {
      await onSave(title.trim(), description.trim());
      setTitle('');
      setDescription('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card p-5 space-y-4 border-l-4 border-l-accent-gold">
      <div>
        <label className="block text-xs font-semibold text-warm-500 uppercase tracking-wider mb-1.5">
          {t('pipeline.featureTitle')}
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('pipeline.featureTitleHint')}
          className="input-field"
          autoFocus
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-warm-500 uppercase tracking-wider mb-1.5">
          {t('pipeline.featureDesc')}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('pipeline.featureDescHint')}
          rows={5}
          className="input-field resize-none"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary text-xs py-2"
        >
          {t('form.cancel')}
        </button>
        <button
          type="submit"
          disabled={!title.trim() || !description.trim() || saving}
          className="btn-primary text-xs py-2"
        >
          {saving ? t('pipeline.creating') : t('pipeline.create')}
        </button>
      </div>
    </form>
  );
}
