// On-demand diff view for a session: everything the session changed since it
// started (committed + uncommitted), fetched only when opened. Reuses the
// shared CommitFileList / CommitDiffViewer from the git/review UI.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useI18n } from '../i18n';
import * as sessionsApi from '../api/sessions';
import type { CommitFile } from '../api/projects';
import { CommitFileList, CommitDiffViewer } from './DiffViewer';

interface SessionDiffPanelProps {
  sessionId: string;
  onClose: () => void;
}

export default function SessionDiffPanel({ sessionId, onClose }: SessionDiffPanelProps) {
  const { t } = useI18n();
  const [files, setFiles] = useState<CommitFile[]>([]);
  const [available, setAvailable] = useState(true);
  const [reason, setReason] = useState<string | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState('');
  const [fileDiffLoading, setFileDiffLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // File list — on mount and on manual refresh (no live subscription).
  useEffect(() => {
    let cancelled = false;
    setFilesLoading(true);
    sessionsApi.getSessionDiff(sessionId)
      .then((res) => {
        if (cancelled) return;
        setAvailable(res.available);
        setReason(res.reason ?? null);
        const list: CommitFile[] = res.available && res.files
          ? res.files.map((f) => ({ path: f.path, status: f.status, additions: f.insertions, deletions: f.deletions }))
          : [];
        setFiles(list);
        setSelectedFile((prev) => {
          if (prev && list.some((f) => f.path === prev)) return prev;
          return list.length > 0 ? list[0].path : null;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setAvailable(false);
        setReason('error');
        setFiles([]);
      })
      .finally(() => { if (!cancelled) setFilesLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId, nonce]);

  // Unified diff for the selected file.
  useEffect(() => {
    if (!selectedFile) { setFileDiff(''); return; }
    let cancelled = false;
    setFileDiffLoading(true);
    setFileDiff('');
    sessionsApi.getSessionFileDiff(sessionId, selectedFile)
      .then((res) => { if (!cancelled) setFileDiff(res.available && res.diff ? res.diff : ''); })
      .catch(() => { if (!cancelled) setFileDiff(''); })
      .finally(() => { if (!cancelled) setFileDiffLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId, selectedFile, nonce]);

  return (
    <div className="h-full flex flex-col bg-warm-50">
      <div className="flex items-center justify-between px-3 py-2 border-b border-warm-100 shrink-0">
        <span className="text-xs font-semibold text-warm-600">{t('session.diff.title') || 'Diff'}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={refresh}
            title={t('common.refresh') || 'Refresh'}
            className="p-1 rounded hover:bg-warm-100 text-warm-500"
          >
            <RefreshCw size={13} className={filesLoading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={onClose}
            title={t('common.close') || 'Close'}
            className="p-1 rounded hover:bg-warm-100 text-warm-500"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {!available ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <span className="text-xs text-warm-400">
            {reason === 'not-git'
              ? (t('session.diff.notGit') || 'Not a git repository')
              : (t('session.diff.unavailable') || 'Diff unavailable')}
          </span>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <div className="w-2/5 min-w-[180px] max-w-[320px] border-r border-warm-100 overflow-hidden">
            <CommitFileList files={files} loading={filesLoading} selectedFile={selectedFile} onFileClick={setSelectedFile} />
          </div>
          <div className="flex-1 min-w-0">
            <CommitDiffViewer diff={fileDiff} loading={fileDiffLoading} selectedFile={selectedFile} />
          </div>
        </div>
      )}
    </div>
  );
}
