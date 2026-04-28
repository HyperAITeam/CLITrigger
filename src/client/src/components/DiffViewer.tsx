import type { CommitFile } from '../api/projects';
import { useI18n } from '../i18n';

export function commitFileStatusLabel(status: string): { label: string; color: string } {
  switch (status) {
    case 'A': return { label: 'A', color: 'text-status-success' };
    case 'D': return { label: 'D', color: 'text-status-error' };
    case 'R': return { label: 'R', color: 'text-purple-500' };
    case 'C': return { label: 'C', color: 'text-blue-500' };
    default:  return { label: 'M', color: 'text-accent' };
  }
}

export function CommitFileList({
  files,
  loading,
  selectedFile,
  onFileClick,
  commitHash,
}: {
  files: CommitFile[];
  loading: boolean;
  selectedFile: string | null;
  onFileClick: (path: string) => void;
  commitHash?: string;
}) {
  const { t } = useI18n();

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-warm-100 flex items-center justify-between shrink-0">
        <span className="text-[11px] font-semibold text-warm-500 uppercase tracking-wider">
          {t('git.changedFiles')}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-2xs text-warm-400">{files.length} {t('git.files')}</span>
          {commitHash && (
            <span className="text-2xs font-mono text-warm-400">{commitHash.substring(0, 7)}</span>
          )}
        </div>
      </div>
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-warm-400">{t('git.loadingFiles')}</span>
        </div>
      ) : files.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-warm-400">{t('git.noFilesChanged')}</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {files.map((f) => {
            const st = commitFileStatusLabel(f.status);
            const isSelected = selectedFile === f.path;
            return (
              <div
                key={f.path}
                onClick={() => onFileClick(f.path)}
                className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs hover:bg-warm-50/50 transition-colors ${
                  isSelected ? 'bg-accent/10 border-l-2 border-accent' : ''
                }`}
              >
                <span className={`font-mono font-bold text-2xs w-3 shrink-0 ${st.color}`}>{st.label}</span>
                <span className="truncate flex-1 text-warm-600" title={f.path}>
                  {f.path.split('/').pop()}
                  <span className="text-warm-400 ml-1 text-2xs">
                    {f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : ''}
                  </span>
                </span>
                <span className="shrink-0 text-2xs text-status-success">+{f.additions}</span>
                <span className="shrink-0 text-2xs text-status-error">-{f.deletions}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CommitDiffViewer({
  diff,
  loading,
  selectedFile,
}: {
  diff: string;
  loading: boolean;
  selectedFile: string | null;
}) {
  const { t } = useI18n();

  if (!selectedFile) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-sm text-warm-400">{t('git.selectFileToViewDiff')}</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-xs text-warm-400">{t('git.loadingDiff')}</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#1A1A1A]">
      <div className="px-3 py-2 border-b border-gray-700 shrink-0">
        <span className="text-xs font-mono text-gray-100">{selectedFile}</span>
      </div>
      <div className="flex-1 overflow-auto">
        <pre className="p-3 font-mono text-xs leading-relaxed">
          {diff ? diff.split('\n').map((line, i) => {
            let className = 'text-gray-200';
            if (line.startsWith('+') && !line.startsWith('+++')) className = 'text-gray-100 bg-green-500/20';
            else if (line.startsWith('-') && !line.startsWith('---')) className = 'text-gray-100 bg-red-500/20';
            else if (line.startsWith('@@')) className = 'text-blue-400';
            else if (line.startsWith('diff ')) className = 'text-amber-300 font-bold';
            return <div key={i} className={className}>{line || ' '}</div>;
          }) : <span className="text-gray-400 italic">No changes</span>}
        </pre>
      </div>
    </div>
  );
}
