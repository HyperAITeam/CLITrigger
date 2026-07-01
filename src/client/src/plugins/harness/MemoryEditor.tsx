import { useState, useEffect } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useI18n } from '../../i18n';

interface MemoryEditorProps {
  filePath: string;
  content: string;
  saving: boolean;
  onSave: (next: string) => Promise<void>;
}

// Editor for a CLI memory/instruction file (CLAUDE.md, CLAUDE.local.md,
// AGENTS.md, …). Titled by the actual file name, with an
// expand toggle so long files can be read without scrolling a tiny box.
export default function MemoryEditor({ filePath, content, saving, onSave }: MemoryEditorProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(content);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setDraft(content);
  }, [content]);

  const dirty = draft !== content;
  const fileName = filePath.split(/[\\/]/).pop() || filePath;

  return (
    <div className="space-y-3 p-4 border border-warm-200 rounded-xl">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-warm-700 font-mono">{fileName}</h4>
        <div className="flex items-center gap-2 min-w-0">
          <code className="text-[10px] text-warm-400 truncate" title={filePath}>{filePath}</code>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="p-1 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded transition-colors flex-shrink-0"
            title={expanded ? (t('harness.memory.collapse') || 'Collapse') : (t('harness.memory.expand') || 'Expand')}
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t('harness.memory.placeholder')}
        spellCheck={false}
        className={`w-full px-3 py-2 text-xs font-mono leading-relaxed border border-warm-200 rounded-lg bg-warm-50 text-warm-700 focus:ring-1 focus:ring-accent focus:border-accent resize-y ${
          expanded ? 'h-[75vh]' : 'h-96'
        }`}
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
