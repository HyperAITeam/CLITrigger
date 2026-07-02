import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { getVaultIgnore, saveVaultIgnore } from '../../api/vault';

interface Props {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}

const PLACEHOLDER = `# gitignore 문법
# 예시:
# *.draft.md
# private/**
# !private/keep.md
# release-notes-*.md`;

export function VaultIgnoreModal({ open, projectId, onClose, onSaved }: Props) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    getVaultIgnore(projectId)
      .then((r) => setContent(r.content))
      .catch(() => setError('불러오기 실패'))
      .finally(() => setLoading(false));
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveVaultIgnore(projectId, content);
      onSaved();
      onClose();
    } catch {
      setError('저장 실패');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-bg-card)] border border-warm-200 rounded-lg shadow-elevated w-[min(600px,90vw)] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-warm-200">
          <div className="text-sm font-semibold text-warm-800">.vaultignore</div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-warm-200 text-warm-500 hover:text-warm-800"
            aria-label="close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 text-xs text-warm-600 border-b border-warm-200">
          프로젝트 루트의 <code className="text-warm-800">.vaultignore</code> 파일.
          gitignore 문법(<code>*</code>, <code>**</code>, <code>!</code>) 그대로 동작.
          <code className="text-warm-800">node_modules</code>, <code className="text-warm-800">.git</code> 등은 기본 제외라 안 적어도 됨.
        </div>

        <div className="flex-1 p-4 min-h-0">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={PLACEHOLDER}
            disabled={loading || saving}
            spellCheck={false}
            className="w-full h-[300px] resize-none rounded-md border border-warm-300 bg-[var(--color-bg-input)] text-warm-800 placeholder:text-warm-400 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent"
          />
          {error && (
            <div className="mt-2 text-xs text-status-error">{error}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-warm-200">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-xs text-warm-700 hover:bg-warm-200"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading || saving}
            className="px-3 py-1.5 rounded-md text-xs bg-accent text-white hover:bg-accent-dark disabled:opacity-50"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
