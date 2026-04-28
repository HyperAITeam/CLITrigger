import { useState, useEffect } from 'react';
import { useI18n } from '../../i18n';

interface MemoryEditorProps {
  filePath: string;
  content: string;
  saving: boolean;
  onSave: (next: string) => Promise<void>;
}

export default function MemoryEditor({ filePath, content, saving, onSave }: MemoryEditorProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(content);

  useEffect(() => {
    setDraft(content);
  }, [content]);

  const dirty = draft !== content;

  return (
    <div className="space-y-3 p-4 border border-warm-200 rounded-xl">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-warm-700">{t('harness.section.memory')}</h4>
        <code className="text-[10px] text-warm-400 truncate max-w-[60%]" title={filePath}>{filePath}</code>
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t('harness.memory.placeholder')}
        rows={14}
        spellCheck={false}
        className="w-full px-3 py-2 text-xs font-mono border border-warm-200 rounded-lg bg-warm-50 text-warm-700 focus:ring-1 focus:ring-accent focus:border-accent resize-y"
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => dirty && !saving && onSave(draft)}
          disabled={!dirty || saving}
          className="px-4 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent-dark disabled:opacity-50 transition-colors"
        >
          {saving ? t('harness.saving') : t('harness.save')}
        </button>
        {!dirty && <span className="text-xs text-warm-400">{t('harness.noChanges')}</span>}
      </div>
    </div>
  );
}
