import { useState } from 'react';

interface PipelineFormProps {
  onSave: (title: string, description: string) => Promise<void>;
  onCancel: () => void;
}

export default function PipelineForm({ onSave, onCancel }: PipelineFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

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
    <form
      onSubmit={handleSubmit}
      className="bg-street-800 border-2 border-neon-cyan/30 p-4 space-y-3 animate-slide-up"
    >
      <div>
        <label className="block text-[10px] font-mono font-bold text-street-500 tracking-[0.2em] uppercase mb-1">
          FEATURE TITLE
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Add user authentication"
          className="street-input w-full"
          autoFocus
        />
      </div>
      <div>
        <label className="block text-[10px] font-mono font-bold text-street-500 tracking-[0.2em] uppercase mb-1">
          FEATURE DESCRIPTION
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the feature in detail. This will be used as the prompt for the AI pipeline..."
          rows={5}
          className="street-input w-full resize-none"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="street-btn px-4 py-1.5 text-xs font-mono text-street-400 border border-street-600 hover:text-white"
        >
          CANCEL
        </button>
        <button
          type="submit"
          disabled={!title.trim() || !description.trim() || saving}
          className="street-btn px-4 py-1.5 text-xs font-mono bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/50 hover:bg-neon-cyan/20 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {saving ? 'CREATING...' : 'CREATE PIPELINE'}
        </button>
      </div>
    </form>
  );
}
