import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { MemoryInjectMode, MemoryNode } from '../types';
import { useI18n } from '../i18n';
import { getMemoryNodes, previewMemoryInjection } from '../api/memory';

interface MemoryInjectControlProps {
  projectId: string;
  mode: MemoryInjectMode;
  selectedIds: string[];
  onChange: (mode: MemoryInjectMode, selectedIds: string[]) => void;
}

export default function MemoryInjectControl({
  projectId,
  mode,
  selectedIds,
  onChange,
}: MemoryInjectControlProps) {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<MemoryNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewText, setPreviewText] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    getMemoryNodes(projectId).then(ns => {
      if (cancelled) return;
      setNodes(ns);
      setLoaded(true);
    }).catch(err => { console.error('Load memory nodes failed', err); setLoaded(true); });
    return () => { cancelled = true; };
  }, [projectId]);

  const filtered = useMemo(() => {
    if (!filter) return nodes;
    const q = filter.toLowerCase();
    return nodes.filter(n => n.title.toLowerCase().includes(q));
  }, [nodes, filter]);

  const toggleNode = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter(s => s !== id)
      : [...selectedIds, id];
    onChange('selected', next);
  };

  const fetchPreview = async () => {
    setPreviewLoading(true);
    try {
      const res = await previewMemoryInjection(projectId, mode, selectedIds);
      setPreviewText(res.prompt || t('memoryInject.empty'));
    } catch (err) {
      setPreviewText(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (showPreview) fetchPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPreview, mode, selectedIds]);

  return (
    <div className="rounded-lg border border-warm-200 bg-warm-50 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-warm-800">{t('memoryInject.title')}</div>
        {mode !== 'none' && (
          <button
            type="button"
            onClick={() => setShowPreview(s => !s)}
            className="inline-flex items-center gap-1 text-xs text-warm-600 hover:text-warm-800"
          >
            {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
            {t('memoryInject.previewToggle')}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2">
        {(['none', 'all', 'selected'] as MemoryInjectMode[]).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m, m === 'selected' ? selectedIds : [])}
            className={`px-3 py-1.5 rounded-md text-xs ${
              mode === m
                ? 'bg-warm-700 text-warm-50'
                : 'bg-warm-100 text-warm-700 hover:bg-warm-200'
            }`}
          >
            {t(`memoryInject.mode${m.charAt(0).toUpperCase() + m.slice(1)}`)}
          </button>
        ))}
      </div>

      {mode === 'selected' && (
        <div className="mt-2">
          {!loaded ? (
            <div className="text-xs text-warm-500">{t('memoryInject.loading')}</div>
          ) : nodes.length === 0 ? (
            <div className="text-xs text-warm-500 italic">{t('memoryInject.empty')}</div>
          ) : (
            <>
              <input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder={t('memoryInject.searchPlaceholder')}
                className="w-full px-2 py-1.5 rounded-md border border-warm-200 bg-warm-0 text-sm focus:outline-none focus:ring-2 focus:ring-warm-400 mb-2"
              />
              <div className="max-h-48 overflow-y-auto border border-warm-200 rounded-md divide-y divide-warm-100">
                {filtered.map(n => (
                  <label key={n.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-warm-100 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(n.id)}
                      onChange={() => toggleNode(n.id)}
                    />
                    <span className="text-sm text-warm-800 truncate flex-1">{n.title}</span>
                  </label>
                ))}
                {filtered.length === 0 && (
                  <div className="text-xs text-warm-500 italic px-2 py-2">{t('memory.noResults')}</div>
                )}
              </div>
              <div className="text-xs text-warm-500 mt-1.5">
                {t('memoryInject.injectedCount').replace('{count}', String(selectedIds.length))}
              </div>
            </>
          )}
        </div>
      )}

      {mode === 'all' && nodes.length > 0 && (
        <div className="text-xs text-warm-500 mt-1">
          {t('memoryInject.allCount').replace('{count}', String(nodes.length))}
        </div>
      )}

      {showPreview && mode !== 'none' && (
        <div className="mt-3">
          <textarea
            readOnly
            value={previewLoading ? '...' : previewText}
            rows={8}
            className="w-full px-2 py-1.5 rounded-md border border-warm-200 bg-warm-100 text-xs font-mono resize-y"
          />
        </div>
      )}
    </div>
  );
}
