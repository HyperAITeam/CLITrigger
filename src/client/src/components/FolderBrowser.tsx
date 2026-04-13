import { useState, useEffect, useCallback } from 'react';
import { browseFolders, type BrowseResult } from '../api/projects';
import { useI18n } from '../i18n';

interface FolderBrowserProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export default function FolderBrowser({ initialPath, onSelect, onCancel }: FolderBrowserProps) {
  const { t } = useI18n();
  const [data, setData] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');

  const navigate = useCallback((path?: string) => {
    setLoading(true);
    setError('');
    browseFolders(path)
      .then((result) => {
        setData(result);
        if (result.current) setSelected(result.current);
      })
      .catch(() => setError(t('browse.error')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    navigate(initialPath || undefined);
  }, [initialPath, navigate]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg animate-scale-in">
        <div className="card p-6 shadow-elevated flex flex-col" style={{ maxHeight: '70vh' }}>
          <h3 className="text-base font-semibold text-warm-800 mb-3">
            {t('browse.title')}
          </h3>

          {/* Current path display */}
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-warm-100/50 text-sm text-warm-600 font-mono min-h-[36px]">
            {data?.current || '/'}
            {data?.isGitRepo && (
              <span className="ml-auto text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 shrink-0">git</span>
            )}
          </div>

          {/* Directory list */}
          <div className="flex-1 overflow-y-auto border border-warm-200 rounded-lg mb-4 min-h-[200px]">
            {loading ? (
              <div className="flex items-center justify-center h-full text-warm-500 text-sm">
                {t('browse.loading')}
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-full text-red-400 text-sm">
                {error}
              </div>
            ) : (
              <div className="divide-y divide-warm-100">
                {/* Parent directory */}
                {data?.parent && (
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-warm-500 hover:bg-warm-100/50 transition-colors"
                    onClick={() => navigate(data.parent!)}
                  >
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    ..
                  </button>
                )}
                {/* Subdirectories */}
                {data?.dirs.map((dir) => (
                  <button
                    key={dir.path}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                      selected === dir.path
                        ? 'bg-blue-500/15 text-blue-400'
                        : 'text-warm-700 hover:bg-warm-100/50'
                    }`}
                    onClick={() => {
                      setSelected(dir.path);
                    }}
                    onDoubleClick={() => navigate(dir.path)}
                  >
                    <svg className="w-4 h-4 shrink-0 text-warm-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    {dir.name}
                  </button>
                ))}
                {data?.dirs.length === 0 && !data?.parent && (
                  <div className="flex items-center justify-center py-8 text-warm-500 text-sm">
                    {t('browse.empty')}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="btn-ghost text-sm"
            >
              {t('form.cancel')}
            </button>
            <button
              type="button"
              onClick={() => selected && onSelect(selected)}
              disabled={!selected}
              className="btn-primary text-sm"
            >
              {t('browse.select')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
