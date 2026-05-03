import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { MemoryInjectMode, MemoryNode } from '../types';
import { useI18n } from '../i18n';
import {
  getMemoryNodes,
  previewMemoryInjection,
  getProjectRawFiles,
  type RawFileEntry,
} from '../api/memory';

interface MemoryInjectControlProps {
  projectId: string;
  mode: MemoryInjectMode;
  selectedIds: string[];
  onChange: (mode: MemoryInjectMode, selectedIds: string[]) => void;
  rawFilePaths?: string[];
  onChangeRawFiles?: (paths: string[]) => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

export default function MemoryInjectControl({
  projectId,
  mode,
  selectedIds,
  onChange,
  rawFilePaths = [],
  onChangeRawFiles,
}: MemoryInjectControlProps) {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<MemoryNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewText, setPreviewText] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [filter, setFilter] = useState('');

  const [rawFiles, setRawFiles] = useState<RawFileEntry[]>([]);
  const [rawLoaded, setRawLoaded] = useState(false);
  const [rawFilter, setRawFilter] = useState('');

  const showRawSection = !!onChangeRawFiles;

  useEffect(() => {
    let cancelled = false;
    getMemoryNodes(projectId).then(ns => {
      if (cancelled) return;
      setNodes(ns);
      setLoaded(true);
    }).catch(err => { console.error('Load memory nodes failed', err); setLoaded(true); });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!showRawSection) return;
    let cancelled = false;
    getProjectRawFiles(projectId).then(res => {
      if (cancelled) return;
      setRawFiles(res.files);
      setRawLoaded(true);
    }).catch(err => { console.error('Load raw files failed', err); setRawLoaded(true); });
    return () => { cancelled = true; };
  }, [projectId, showRawSection]);

  const filtered = useMemo(() => {
    if (!filter) return nodes;
    const q = filter.toLowerCase();
    return nodes.filter(n => n.title.toLowerCase().includes(q));
  }, [nodes, filter]);

  const filteredRaw = useMemo(() => {
    if (!rawFilter) return rawFiles;
    const q = rawFilter.toLowerCase();
    return rawFiles.filter(f => f.filename.toLowerCase().includes(q) || f.source_type.toLowerCase().includes(q));
  }, [rawFiles, rawFilter]);

  const groupedRaw = useMemo(() => {
    const groups: Record<string, RawFileEntry[]> = {};
    for (const f of filteredRaw) {
      const key = f.source_type;
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    }
    return groups;
  }, [filteredRaw]);

  const totalRawSize = useMemo(() => {
    let bytes = 0;
    for (const f of rawFiles) {
      if (rawFilePaths.includes(f.relative_path)) bytes += f.size;
    }
    return bytes;
  }, [rawFiles, rawFilePaths]);

  const toggleNode = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter(s => s !== id)
      : [...selectedIds, id];
    onChange('selected', next);
  };

  const toggleRawFile = (relPath: string) => {
    if (!onChangeRawFiles) return;
    const next = rawFilePaths.includes(relPath)
      ? rawFilePaths.filter(p => p !== relPath)
      : [...rawFilePaths, relPath];
    onChangeRawFiles(next);
  };

  const fetchPreview = async () => {
    setPreviewLoading(true);
    try {
      const res = await previewMemoryInjection(projectId, mode, selectedIds, rawFilePaths);
      setPreviewText(res.prompt || t('wikiInject.empty'));
    } catch (err) {
      setPreviewText(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  };

  const previewable = (mode !== 'none' && mode !== 'auto') || rawFilePaths.length > 0;

  useEffect(() => {
    if (showPreview) fetchPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPreview, mode, selectedIds, rawFilePaths]);

  return (
    <div className="rounded-lg border border-warm-200 bg-warm-50 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-warm-800">{t('wikiInject.title')}</div>
        {previewable && (
          <button
            type="button"
            onClick={() => setShowPreview(s => !s)}
            className="inline-flex items-center gap-1 text-xs text-warm-600 hover:text-warm-800"
          >
            {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
            {t('wikiInject.previewToggle')}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2">
        {(['none', 'auto', 'all', 'selected'] as MemoryInjectMode[]).map(m => (
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
            {t(`wikiInject.mode${m.charAt(0).toUpperCase() + m.slice(1)}`)}
          </button>
        ))}
      </div>

      {mode === 'auto' && (
        <div className="text-xs text-warm-500 mt-1 leading-snug">
          {t('wikiInject.autoHint').replace('{count}', String(nodes.length))}
        </div>
      )}

      {mode === 'selected' && (
        <div className="mt-2">
          {!loaded ? (
            <div className="text-xs text-warm-500">{t('wikiInject.loading')}</div>
          ) : nodes.length === 0 ? (
            <div className="text-xs text-warm-500 italic">{t('wikiInject.empty')}</div>
          ) : (
            <>
              <input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder={t('wikiInject.searchPlaceholder')}
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
                  <div className="text-xs text-warm-500 italic px-2 py-2">{t('wiki.noResults')}</div>
                )}
              </div>
              <div className="text-xs text-warm-500 mt-1.5">
                {t('wikiInject.injectedCount').replace('{count}', String(selectedIds.length))}
              </div>
            </>
          )}
        </div>
      )}

      {mode === 'all' && nodes.length > 0 && (
        <div className="text-xs text-warm-500 mt-1">
          {t('wikiInject.allCount').replace('{count}', String(nodes.length))}
        </div>
      )}

      {showRawSection && (
        <div className="mt-3 pt-3 border-t border-warm-200">
          <div className="text-sm font-medium text-warm-800 mb-1">{t('wikiInject.rawFilesTitle')}</div>
          <div className="text-xs text-warm-500 leading-snug mb-2">{t('wikiInject.rawFilesHint')}</div>
          {!rawLoaded ? (
            <div className="text-xs text-warm-500">{t('wikiInject.loading')}</div>
          ) : rawFiles.length === 0 ? (
            <div className="text-xs text-warm-500 italic">{t('wikiInject.rawFilesEmpty')}</div>
          ) : (
            <>
              <input
                value={rawFilter}
                onChange={e => setRawFilter(e.target.value)}
                placeholder={t('wikiInject.searchPlaceholder')}
                className="w-full px-2 py-1.5 rounded-md border border-warm-200 bg-warm-0 text-sm focus:outline-none focus:ring-2 focus:ring-warm-400 mb-2"
              />
              <div className="max-h-48 overflow-y-auto border border-warm-200 rounded-md">
                {Object.keys(groupedRaw).length === 0 ? (
                  <div className="text-xs text-warm-500 italic px-2 py-2">{t('wiki.noResults')}</div>
                ) : (
                  Object.entries(groupedRaw).map(([sourceType, files]) => (
                    <div key={sourceType}>
                      <div className="text-[10px] uppercase tracking-wide text-warm-500 px-2 py-1 bg-warm-100 sticky top-0">
                        {sourceType}
                      </div>
                      <div className="divide-y divide-warm-100">
                        {files.map(f => (
                          <label
                            key={f.relative_path}
                            className="flex items-center gap-2 px-2 py-1.5 hover:bg-warm-100 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={rawFilePaths.includes(f.relative_path)}
                              onChange={() => toggleRawFile(f.relative_path)}
                            />
                            <span className="text-sm text-warm-800 truncate flex-1" title={f.relative_path}>
                              {f.filename}
                            </span>
                            <span className="text-[10px] text-warm-500 font-mono shrink-0">{formatBytes(f.size)}</span>
                            {f.derived_node_ids.length > 0 && (
                              <span
                                className="text-[10px] text-warm-600 bg-warm-200 px-1.5 py-0.5 rounded shrink-0"
                                title={t('wikiInject.rawFilesHasNodes')}
                              >
                                {String(f.derived_node_ids.length)}
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
              {rawFilePaths.length > 0 && (
                <div className="text-xs text-warm-500 mt-1.5">
                  {t('wikiInject.rawFilesSelected')
                    .replace('{count}', String(rawFilePaths.length))
                    .replace('{size}', formatBytes(totalRawSize))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showPreview && previewable && (
        <div className="mt-3">
          <textarea
            readOnly
            value={previewLoading ? '...' : previewText}
            rows={8}
            className="w-full px-2 py-1.5 rounded-md border border-warm-200 bg-warm-100 text-xs font-mono resize-y"
          />
          {!previewLoading && previewText && (
            <div className="mt-1 flex items-center justify-end gap-3 text-[10px] text-warm-500 font-mono">
              <span>{t('wikiInject.previewChars').replace('{n}', previewText.length.toLocaleString())}</span>
              <span>{t('wikiInject.previewTokens').replace('{n}', Math.ceil(previewText.length / 4).toLocaleString())}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
