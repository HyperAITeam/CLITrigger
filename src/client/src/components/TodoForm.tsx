import { useState } from 'react';
import { useI18n } from '../i18n';

interface TodoFormProps {
  onSave: (title: string, description: string) => void;
  onCancel: () => void;
  initialTitle?: string;
  initialDescription?: string;
}

export default function TodoForm({
  onSave,
  onCancel,
  initialTitle = '',
  initialDescription = '',
}: TodoFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const { t } = useI18n();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave(title.trim(), description.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="card p-5 border-accent-gold/30">
      <div className="mb-3">
        <input
          type="text"
          placeholder={t('todoForm.titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="input-field"
          autoFocus
        />
      </div>
      <div className="mb-4">
        <textarea
          placeholder={t('todoForm.descPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="input-field resize-none"
        />
      </div>
      <div className="flex gap-3 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="btn-ghost text-sm"
        >
          {t('todoForm.cancel')}
        </button>
        <button
          type="submit"
          disabled={!title.trim()}
          className="btn-primary text-sm"
        >
          {t('todoForm.save')}
        </button>
      </div>
    </form>
  );
}
