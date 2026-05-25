import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useI18n } from '../i18n';
import { getVaultFiles, previewVaultInjection, type VaultFile, type VaultInjectMode } from '../api/vault';

interface VaultInjectControlProps {
  projectId: string;
  mode: VaultInjectMode;
  selectedPaths: string[];
  onChange: (mode: VaultInjectMode, selectedPaths: string[]) => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

export default function VaultInjectControl({
  projectId,
  mode,
  selectedPaths,
  onChange,
}: VaultInjectControlProps) {
  const { t } = useI18n();
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewText, setPreviewText] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    getVaultFiles(projectId).then(res => {
      if (cancelled) return;
      setFiles(res.files);
      setLoaded(true);
    }).catch(err => { console.error('Load vault files failed', err); setLoaded(true); });
    return () => { cancelled = true; };
  }, [projectId]);

  const grouped = useMemo(() => {
    const q = filter.toLowerCase();
    const filtered = q ? files.filter(f =>
      f.stem.toLowerCase().includes(q) ||
      f.title.toLowerCase().includes(q) ||
      f.relativePath.toLowerCase().includes(q)
    ) : files;

    const groups: Record<string, VaultFile[]> = {};
    for (const f of filtered) {
      const dir = f.relativePath.includes('/') ? f.relativePath.split('/').slice(0, -1).join('/') : '.';
      if (!groups[dir]) groups[dir] = [];
      groups[dir].push(f);
    }
    return groups;
  }, [files, filter]);

  const toggleFile = (path: string) => {
    const next = selectedPaths.includes(path)
      ? selectedPaths.filter(p => p !== path)
      : [...selectedPaths, path];
    onChange('selected', next);
  };

  const fetchPreview = async () => {
    setPreviewLoading(true);
    try {
      const m = mode === 'auto' ? 'all' : mode as 'all' | 'selected';
      const res = await previewVaultInjection(projectId, m, selectedPaths);
      setPreviewText(res.block || t('vault.empty'));
    } catch (err) {
      setPreviewText(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  };

  const previewable = mode !== 'none' && mode !== 'auto';

  useEffect(() => {
    if (showPreview && previewable) fetchPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPreview, mode, selectedPaths]);

  return (
    <div className="rounded-lg border border-warm-200 bg-warm-50 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-warm-800">{t('vaultInject.title')}</div>
        {previewable && (
          <button
            type="button"
            onClick={() => setShowPreview(s => !s)}
            className="inline-flex items-center gap-1 text-xs text-warm-600 hover:text-warm-800"
          >
            {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
            {t('vaultInject.previewToggle')}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2">
        {(['none', 'auto', 'all', 'selected'] as VaultInjectMode[]).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m, m === 'selected' ? selectedPaths : [])}
            className={`px-3 py-1.5 rounded-md text-xs ${
              mode === m
                ? 'bg-warm-700 text-warm-50'
                : 'bg-warm-100 text-warm-700 hover:bg-warm-200'
            }`}
          >
            {t(`vaultInject.mode${m.charAt(0).toUpperCase() + m.slice(1)}`)}
          </button>
        ))}
      </div>

      {mode === 'auto' && (
        <div className="text-xs text-warm-500 mt-1 leading-snug">
          {t('vaultInject.autoHint').replace('{count}', String(files.length))}
        </div>
      )}

      {mode === 'selected' && (
        <div className="mt-2">
          {!loaded ? (
            <div className="text-xs text-warm-500">{t('vaultInject.loading')}</div>
          ) : files.length === 0 ? (
            <div className="text-xs text-warm-500 italic">{t('vault.empty')}</div>
          ) : (
            <>
              <input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder={t('vaultInject.searchPlaceholder')}
                className="w-full px-2 py-1.5 rounded-md border border-warm-200 bg-warm-0 text-sm focus:outline-none focus:ring-2 focus:ring-warm-400 mb-2"
              />
              <div className="max-h-48 overflow-y-auto border border-warm-200 rounded-md">
                {Object.keys(grouped).length === 0 ? (
                  <div className="text-xs text-warm-500 italic px-2 py-2">{t('vault.noResults')}</div>
                ) : (
                  Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([dir, dirFiles]) => (
                    <div key={dir}>
                      <div className="text-[10px] uppercase tracking-wide text-warm-500 px-2 py-1 bg-warm-100 sticky top-0">
                        {dir}
                      </div>
                      <div className="divide-y divide-warm-100">
                        {dirFiles.map(f => (
                          <label
                            key={f.relativePath}
                            className="flex items-center gap-2 px-2 py-1.5 hover:bg-warm-100 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedPaths.includes(f.relativePath)}
                              onChange={() => toggleFile(f.relativePath)}
                            />
                            <span className="text-sm text-warm-800 truncate flex-1" title={f.relativePath}>
                              {f.stem}
                            </span>
                            <span className="text-[10px] text-warm-500 font-mono shrink-0">{formatBytes(f.size)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="text-xs text-warm-500 mt-1.5">
                {t('vaultInject.injectedCount').replace('{count}', String(selectedPaths.length))}
              </div>
            </>
          )}
        </div>
      )}

      {mode === 'all' && files.length > 0 && (
        <div className="text-xs text-warm-500 mt-1">
          {t('vaultInject.allCount').replace('{count}', String(files.length))}
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
              <span>{t('vaultInject.previewChars').replace('{n}', previewText.length.toLocaleString())}</span>
              <span>{t('vaultInject.previewTokens').replace('{n}', Math.ceil(previewText.length / 4).toLocaleString())}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
