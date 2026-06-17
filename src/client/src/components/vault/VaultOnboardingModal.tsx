import { EyeOff, Eye, MousePointerClick, GitBranch } from 'lucide-react';
import { createPortal } from 'react-dom';

interface Props {
  saving: boolean;
  onIgnoreAll: () => void;
  onShowAll: () => void;
}

// First-visit gate for the Vault tab. Large projects choke on the initial
// scan + force-directed graph, so before anything renders we offer to start
// from an "ignore everything" .vaultignore and teach the unhide flow.
// Rendering begins only after a choice; the choice is remembered per project
// (vault:onboarded:<projectId>) and a pre-existing .vaultignore skips this
// entirely.
export function VaultOnboardingModal({ saving, onIgnoreAll, onShowAll }: Props) {
  return createPortal(
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-bg-card)] border border-warm-200 rounded-lg shadow-elevated w-[min(560px,90vw)] max-h-[85vh] overflow-y-auto flex flex-col">
        <div className="px-5 py-4 border-b border-warm-200">
          <div className="text-sm font-semibold text-warm-800">볼트 시작하기</div>
          <p className="mt-1.5 text-xs text-warm-500 leading-relaxed">
            볼트는 프로젝트의 <code className="text-warm-700">.md</code>/<code className="text-warm-700">.html</code> 문서를
            스캔해 <code className="text-warm-700">[[wikilink]]</code> 그래프로 보여줍니다.
            큰 프로젝트는 파일이 많아 첫 스캔과 그래프 렌더링이 느릴 수 있어요.
            <code className="text-warm-700">.vaultignore</code>(gitignore 문법)로 표시할 문서만 골라두면 가볍게 쓸 수 있습니다.
          </p>
        </div>

        <div className="px-5 py-4 space-y-3 text-xs text-warm-600">
          <div className="flex items-start gap-2.5">
            <EyeOff className="w-4 h-4 mt-0.5 text-warm-400 flex-shrink-0" />
            <p className="leading-relaxed">
              <span className="font-semibold text-warm-700">① 전부 숨김으로 시작</span> —
              <code className="text-warm-700"> .vaultignore</code>에 <code className="text-warm-700">*</code>가 들어가
              모든 파일이 볼트에서 제외된 상태로 시작합니다 (파일은 그대로, 볼트에서만 안 보임).
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <MousePointerClick className="w-4 h-4 mt-0.5 text-warm-400 flex-shrink-0" />
            <p className="leading-relaxed">
              <span className="font-semibold text-warm-700">② 필요한 문서만 해제</span> —
              파일 탐색기에서 회색으로 표시된 파일·폴더를 우클릭 → <span className="font-semibold text-warm-700">"볼트에 다시 보이기"</span>.
              숨김 파일 표시(<Eye className="w-3 h-3 inline" />)는 자동으로 켜 둡니다.
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <GitBranch className="w-4 h-4 mt-0.5 text-warm-400 flex-shrink-0" />
            <p className="leading-relaxed">
              <span className="font-semibold text-warm-700">③ 그래프는 표시된 문서만</span> —
              해제한 문서만 스캔/그래프에 올라가 렉 없이 동작합니다.
              패턴은 언제든 좌측 레일의 <code className="text-warm-700">.vaultignore</code> 설정(⚙)에서 직접 편집할 수 있어요.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 px-5 py-4 border-t border-warm-200">
          <button
            type="button"
            onClick={onIgnoreAll}
            disabled={saving}
            className="w-full px-3 py-2.5 rounded-md text-xs font-semibold bg-accent text-white hover:bg-accent-dark disabled:opacity-50"
          >
            {saving ? '설정 중…' : '전부 숨김으로 시작 (큰 프로젝트 권장)'}
          </button>
          <button
            type="button"
            onClick={onShowAll}
            disabled={saving}
            className="w-full px-3 py-2 rounded-md text-xs text-warm-600 hover:bg-warm-200 disabled:opacity-50"
          >
            전체 표시로 시작 (작은 프로젝트라면 괜찮아요)
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
