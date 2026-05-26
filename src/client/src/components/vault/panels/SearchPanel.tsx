import { useMemo, useState } from 'react';
import { Search, FileText } from 'lucide-react';
import { useI18n } from '../../../i18n';
import type { VaultFile } from '../../../api/vault';

interface Props {
  files: VaultFile[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
}

interface Result {
  file: VaultFile;
  snippet: string;
  score: number;
}

export function SearchPanel({ files, activeFile, onSelectFile }: Props) {
  const { t } = useI18n();
  const [q, setQ] = useState('');

  const results = useMemo<Result[]>(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    const out: Result[] = [];
    for (const f of files) {
      const stem = f.stem.toLowerCase();
      const title = f.title.toLowerCase();
      const preview = f.bodyPreview.toLowerCase();
      const tags = f.tags.map((tt) => tt.toLowerCase());
      const stemHit = stem.includes(query);
      const titleHit = title.includes(query);
      const tagHit = tags.some((tg) => tg.includes(query));
      const previewIdx = preview.indexOf(query);
      const previewHit = previewIdx >= 0;
      if (!stemHit && !titleHit && !tagHit && !previewHit) continue;
      let snippet = '';
      if (previewHit) {
        const start = Math.max(0, previewIdx - 30);
        const end = Math.min(f.bodyPreview.length, previewIdx + query.length + 50);
        snippet = (start > 0 ? '…' : '') + f.bodyPreview.slice(start, end) + (end < f.bodyPreview.length ? '…' : '');
      } else {
        snippet = f.bodyPreview.slice(0, 80);
      }
      const score = (titleHit ? 4 : 0) + (stemHit ? 3 : 0) + (tagHit ? 2 : 0) + (previewHit ? 1 : 0);
      out.push({ file: f, snippet, score });
    }
    return out.sort((a, b) => b.score - a.score);
  }, [files, q]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-2 border-b border-warm-200 shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-warm-400 w-3 h-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('vault.search.prompt')}
            className="w-full pl-7 pr-2 py-1 rounded-md border border-warm-200 bg-warm-0 text-xs focus:outline-none focus:ring-1 focus:ring-warm-400"
            autoFocus
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-1">
        {!q.trim() && (
          <div className="text-xs text-warm-400 px-2 py-4 text-center">{t('vault.search.prompt')}</div>
        )}
        {q.trim() && results.length === 0 && (
          <div className="text-xs text-warm-400 px-2 py-4 text-center">{t('vault.search.empty')}</div>
        )}
        {results.map(({ file, snippet }) => (
          <button
            key={file.relativePath}
            onClick={() => onSelectFile(file.relativePath)}
            className={`w-full text-left px-2 py-1.5 rounded hover:bg-warm-100 ${
              activeFile === file.relativePath ? 'bg-warm-200' : ''
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs">
              <FileText className="w-3 h-3 text-sky-500 shrink-0" />
              <span className="font-medium text-warm-800 truncate">{file.stem}</span>
            </div>
            <div className="text-[10px] text-warm-500 truncate pl-[18px] mt-0.5">{file.relativePath}</div>
            {snippet && (
              <div className="text-[10px] text-warm-600 line-clamp-2 pl-[18px] mt-0.5 leading-snug">{snippet}</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
