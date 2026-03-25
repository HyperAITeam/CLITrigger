import { useState } from 'react';

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave(title.trim(), description.trim());
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-street-800 border-2 border-neon-green/30 p-5"
      style={{ clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))' }}
    >
      <div className="mb-3">
        <input
          type="text"
          placeholder="Task title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="street-input"
          autoFocus
        />
      </div>
      <div className="mb-4">
        <textarea
          placeholder="Description (optional)..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="street-input resize-none"
        />
      </div>
      <div className="flex gap-3 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="font-mono text-xs text-street-400 hover:text-white px-4 py-2 transition-colors uppercase tracking-wider"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!title.trim()}
          className="street-btn bg-neon-green px-5 py-2 text-[10px] text-street-900 hover:bg-neon-green/80 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          SAVE
        </button>
      </div>
    </form>
  );
}
