import { useEffect, useState } from 'react';
import { ArrowRight, FileText, Loader2 } from 'lucide-react';
import type { MemoryNode } from '../types';
import { type RawFileEntry, getRawFileByPath, parseMemoryTags } from '../api/memory';
import { useI18n } from '../i18n';

interface RawFileViewerProps {
  projectId: string;
  file: RawFileEntry;
  allNodes: MemoryNode[];
  onSelectNode: (id: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatMtime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export default function RawFileViewer({ projectId, file, allNodes, onSelectNode }: RawFileViewerProps) {
  const { t } = useI18n();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    setContent(null);
    getRawFileByPath(projectId, file.relative_path)
      .then(setContent)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [projectId, file.relative_path]);

  const derivedNodes = file.derived_node_ids
    .map((id) => allNodes.find((n) => n.id === id))
    .filter((n): n is MemoryNode => !!n);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-2 border-b border-warm-200">
        <FileText size={14} className="text-warm-500 flex-shrink-0" />
        <span className="flex-1 text-base font-semibold text-warm-900 truncate min-w-0">{file.filename}</span>
        <span className="text-[11px] text-warm-500 flex-shrink-0">
          {formatSize(file.size)} · {formatMtime(file.mtime)}
        </span>
      </div>
      <div className="px-4 py-1 border-b border-warm-100">
        <code className="text-[10px] text-warm-500">{file.relative_path}</code>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-warm-500 py-8 justify-center">
            <Loader2 size={14} className="animate-spin" /> {t('wiki.loading')}
          </div>
        ) : error ? (
          <p className="text-sm text-status-error py-4">{error}</p>
        ) : (
          <pre className="text-xs text-warm-800 bg-warm-100 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed">{content}</pre>
        )}
      </div>

      {/* Derived */}
      <div className="border-t border-warm-200 px-4 py-2 max-h-48 overflow-y-auto">
        <p className="text-[10px] font-semibold text-warm-500 uppercase tracking-wide mb-1.5">
          {t('wiki.rawFile.derivedTitle')} ({derivedNodes.length})
        </p>
        {derivedNodes.length === 0 ? (
          <p className="text-[11px] text-warm-400 italic py-1">{t('wiki.rawFile.noDerived')}</p>
        ) : (
          <div className="space-y-0.5">
            {derivedNodes.map((n) => {
              const tags = parseMemoryTags(n.tags);
              const firstTag = tags[0];
              return (
                <button
                  key={n.id}
                  onClick={() => onSelectNode(n.id)}
                  className="w-full flex items-center gap-2 text-left px-2 py-1 rounded hover:bg-warm-100 group"
                >
                  <span className="flex-1 text-[12px] text-warm-800 truncate min-w-0">{n.title}</span>
                  {firstTag && (
                    <span className="text-[10px] text-warm-500 px-1.5 py-0.5 rounded bg-warm-100 group-hover:bg-warm-200 flex-shrink-0">
                      {firstTag}
                    </span>
                  )}
                  <ArrowRight size={12} className="text-warm-400 flex-shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
