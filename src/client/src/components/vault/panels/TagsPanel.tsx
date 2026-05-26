import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Tag, FileText } from 'lucide-react';
import { useI18n } from '../../../i18n';
import type { VaultFile } from '../../../api/vault';

interface Props {
  files: VaultFile[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
}

interface TagEntry {
  tag: string;
  files: VaultFile[];
}

export function TagsPanel({ files, activeFile, onSelectFile }: Props) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const tagList = useMemo<TagEntry[]>(() => {
    const m = new Map<string, VaultFile[]>();
    for (const f of files) {
      for (const tag of f.tags) {
        const key = tag.toLowerCase();
        const arr = m.get(key);
        if (arr) arr.push(f);
        else m.set(key, [f]);
      }
    }
    return [...m.entries()]
      .map(([tag, fs]) => ({ tag, files: fs.slice().sort((a, b) => a.stem.localeCompare(b.stem)) }))
      .sort((a, b) => b.files.length - a.files.length || a.tag.localeCompare(b.tag));
  }, [files]);

  const toggle = (tag: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  if (tagList.length === 0) {
    return (
      <div className="text-xs text-warm-400 px-3 py-4 text-center">
        {t('vault.tags.empty')}
      </div>
    );
  }

  return (
    <div className="flex flex-col py-1">
      {tagList.map(({ tag, files: fs }) => {
        const isOpen = expanded.has(tag);
        return (
          <div key={tag}>
            <button
              onClick={() => toggle(tag)}
              className="w-full flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-warm-100 text-warm-700"
            >
              {isOpen
                ? <ChevronDown className="w-3 h-3 shrink-0 text-warm-400" />
                : <ChevronRight className="w-3 h-3 shrink-0 text-warm-400" />}
              <Tag className="w-3 h-3 text-emerald-500 shrink-0" />
              <span className="truncate font-medium">{tag}</span>
              <span className="text-[10px] text-warm-400 ml-auto">{fs.length}</span>
            </button>
            {isOpen && fs.map((f) => (
              <button
                key={f.relativePath}
                onClick={() => onSelectFile(f.relativePath)}
                className={`w-full flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-warm-100 ${
                  activeFile === f.relativePath ? 'bg-warm-200 text-warm-800 font-medium' : 'text-warm-700'
                }`}
                style={{ paddingLeft: 32 }}
                title={f.relativePath}
              >
                <FileText className="w-3 h-3 text-sky-500 shrink-0" />
                <span className="truncate">{f.stem}</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
