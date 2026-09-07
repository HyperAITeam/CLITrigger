import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import Modal from '../Modal';
import Button from '../Button';
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

// Static usage guide behind the "?" button in the vault sidebar rail.
// Same modal shell as VaultIgnoreModal; hardcoded Korean like its sibling.
export function VaultIgnoreHelpModal({ open, onClose, onOpenEditor }: {
  open: boolean;
  onClose: () => void;
  onOpenEditor: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} size="xl">
      <div className="bg-theme-card border border-theme-border rounded-2xl shadow-elevated max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-warm-200">
          <div className="text-sm font-semibold text-warm-800">.vaultignore 사용법</div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-warm-200 text-warm-500 hover:text-warm-800"
            aria-label="close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 text-xs text-warm-600 space-y-3 overflow-y-auto">
          <p>
            프로젝트 루트의 <code className="text-warm-800">.vaultignore</code> 파일로
            문서(그래프·검색·태그·주입)에서 제외할 파일을 정합니다.
            gitignore 문법(<code>*</code>, <code>**</code>, <code>!</code>)을 그대로 사용합니다.
          </p>
          <pre className="rounded-md border border-warm-300 bg-[var(--color-bg-input)] text-warm-800 px-3 py-2 font-mono leading-relaxed">
{`*.draft.md        # 특정 확장자 숨김
private/**        # 폴더 전체 숨김
!private/keep.md  # 예외로 다시 표시
*                 # 전부 숨김으로 시작`}
          </pre>
          <ul className="list-disc pl-4 space-y-1">
            <li>
              <code className="text-warm-800">*</code> 하나만 있으면 모든 문서가 숨겨집니다(온보딩의 "전부 숨김으로 시작").
              파일 탐색기에서 우클릭 → <span className="text-warm-800">"문서에 다시 보이기"</span>로 필요한 문서만 해제하세요.
            </li>
            <li>
              탐색기 우클릭 → <span className="text-warm-800">"문서에서 숨기기"</span>로 개별 파일/폴더를 다시 숨길 수 있습니다.
            </li>
            <li>
              <code className="text-warm-800">node_modules</code>, <code className="text-warm-800">.git</code>, <code className="text-warm-800">dist</code> 등은 기본 제외라 적지 않아도 됩니다.
            </li>
          </ul>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-warm-200">
          <Button variant="ghost" size="sm" onClick={onOpenEditor}>
            .vaultignore 직접 편집
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </Modal>
  );
}

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

  return (
    <Modal open={open} onClose={onClose} size="xl">
      <div className="bg-theme-card border border-theme-border rounded-2xl shadow-elevated max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-warm-200">
          <div className="text-sm font-semibold text-warm-800">.vaultignore</div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-warm-200 text-warm-500 hover:text-warm-800"
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
          <Button variant="ghost" size="sm" onClick={onClose}>
            취소
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={loading || saving}
          >
            {saving ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
