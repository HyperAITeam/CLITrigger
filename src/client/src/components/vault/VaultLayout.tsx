import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Search, Tag, GitBranch, List, ArrowLeftRight, ArrowRight, Settings, HelpCircle } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useVaultState, type LeftPanelId, type RightPanelId } from './vault-state';
import { Resizer } from './Resizer';
import { SidebarRail, type PanelDef } from './SidebarRail';
import { getVaultGraph, getVaultIgnore, saveVaultIgnore, type VaultFile, type VaultEdge } from '../../api/vault';
import { FileExplorerPanel } from './panels/FileExplorerPanel';
import { SearchPanel } from './panels/SearchPanel';
import { TagsPanel } from './panels/TagsPanel';
import { GraphPanel } from './panels/GraphPanel';
import { OutlinePanel } from './panels/OutlinePanel';
import { BacklinksPanel } from './panels/BacklinksPanel';
import { OutgoingLinksPanel } from './panels/OutgoingLinksPanel';
import { CenterEditor } from './CenterEditor';
import { VaultIgnoreModal, VaultIgnoreHelpModal } from './VaultIgnoreModal';
import { VaultOnboardingModal } from './VaultOnboardingModal';
import { bumpVaultZoom } from '../../hooks/useVaultZoom';

interface Props {
  projectId: string;
  // Create an automation task from a file (file explorer right-click menu).
  onCreateTask?: (path: string) => void | Promise<void>;
}

// Written by the onboarding "ignore everything" choice. The unhide flow
// (right-click → "볼트에 다시 보이기") appends gitignore negations on top.
const IGNORE_ALL_TEMPLATE = `# CLITrigger Vault — 전부 숨김으로 시작
# 파일 탐색기에서 우클릭 → "문서에 다시 보이기"로 필요한 문서만 해제하세요.
# gitignore 문법(*, **, ! 제외 패턴)을 그대로 사용합니다.
*
`;

export default function VaultLayout({ projectId, onCreateTask }: Props) {
  const { t } = useI18n();
  const state = useVaultState(projectId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [vaultFiles, setVaultFiles] = useState<VaultFile[]>([]);
  const [vaultEdges, setVaultEdges] = useState<VaultEdge[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [vaultError, setVaultError] = useState(false);
  // Zero files scanned while .vaultignore has active patterns — most likely
  // the onboarding "ignore everything" state, not a project without docs.
  const [allHidden, setAllHidden] = useState(false);
  const [ignoreModalOpen, setIgnoreModalOpen] = useState(false);
  const [ignoreHelpOpen, setIgnoreHelpOpen] = useState(false);

  const reloadVault = useCallback(() => {
    setVaultLoading(true);
    getVaultGraph(projectId)
      .then(async (g) => {
        setVaultFiles(g.files);
        setVaultEdges(g.edges);
        setVaultError(false);
        if (g.files.length === 0) {
          try {
            const { content } = await getVaultIgnore(projectId);
            setAllHidden(content.split(/\r?\n/).some((l) => l.trim() && !l.trim().startsWith('#')));
          } catch { setAllHidden(false); }
        } else {
          setAllHidden(false);
        }
      })
      .catch(() => { setVaultFiles([]); setVaultEdges([]); setVaultError(true); })
      .finally(() => setVaultLoading(false));
  }, [projectId]);

  // ── First-visit onboarding gate ───────────────────────────────────────────
  // Large projects choke on the initial scan + force-directed graph, so the
  // vault doesn't render (or scan) until the user has been offered an
  // "ignore everything" .vaultignore start. Skipped when the project already
  // has a non-empty .vaultignore or the choice was made before.
  const onboardKey = `vault:onboarded:${projectId}`;
  const [ready, setReady] = useState(() => {
    try { return localStorage.getItem(onboardKey) === '1'; } catch { return true; }
  });
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardSaving, setOnboardSaving] = useState(false);

  const markOnboarded = useCallback(() => {
    try { localStorage.setItem(onboardKey, '1'); } catch { /* ignore */ }
  }, [onboardKey]);

  useEffect(() => {
    if (ready) { reloadVault(); return; }
    let cancelled = false;
    getVaultIgnore(projectId)
      .then(({ content }) => {
        if (cancelled) return;
        if (content.trim()) {
          // Already configured (by hand or on another machine) — no tutorial.
          markOnboarded();
          setReady(true);
        } else {
          setShowOnboarding(true);
        }
      })
      .catch(() => { if (!cancelled) { markOnboarded(); setReady(true); } });
    return () => { cancelled = true; };
  }, [ready, projectId, reloadVault, markOnboarded]);

  const finishOnboarding = useCallback(() => {
    markOnboarded();
    setShowOnboarding(false);
    setReady(true); // remounts the panels below; the gate effect then loads the graph
  }, [markOnboarded]);

  const handleOnboardIgnoreAll = useCallback(async () => {
    setOnboardSaving(true);
    try {
      await saveVaultIgnore(projectId, IGNORE_ALL_TEMPLATE);
      // Pre-enable the explorer's hidden-files toggle so the freshly ignored
      // (dimmed) files are visible for right-click → unhide. Must happen
      // before the panels mount — the toggle is read in a useState initializer.
      try { localStorage.setItem(`vault:fileExplorer:${projectId}:showHidden`, '1'); } catch { /* ignore */ }
    } catch { /* write failed — proceed unfiltered rather than blocking */ }
    setOnboardSaving(false);
    finishOnboarding();
  }, [projectId, finishOnboarding]);

  // Ctrl/Cmd + wheel → Vault font zoom. React onWheel is passive by default
  // so we attach natively with passive:false to preventDefault the browser's
  // page zoom. Non-zoom wheel events pass through unchanged for normal scroll.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.deltaY === 0) return;
      bumpVaultZoom(projectId, e.deltaY < 0 ? +1 : -1);
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [projectId]);

  const onLeftResize = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    state.setLeftWidth(clientX - rect.left);
  }, [state]);
  const onRightResize = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    state.setRightWidth(rect.right - clientX);
  }, [state]);

  const leftPanels = useMemo<readonly PanelDef<LeftPanelId>[]>(() => [
    {
      id: 'files',
      label: t('vault.panel.fileExplorer'),
      Icon: FileText,
      render: () => (
        <FileExplorerPanel
          projectId={projectId}
          activeFile={state.activeFile}
          onSelectFile={state.setActiveFile}
          onVaultIgnoreChanged={reloadVault}
          onCreateTask={onCreateTask}
        />
      ),
    },
    {
      id: 'search',
      label: t('vault.panel.search'),
      Icon: Search,
      render: () => (
        <SearchPanel
          files={vaultFiles}
          activeFile={state.activeFile}
          onSelectFile={state.setActiveFile}
        />
      ),
    },
    {
      id: 'tags',
      label: t('vault.panel.tags'),
      Icon: Tag,
      render: () => (
        <TagsPanel
          files={vaultFiles}
          activeFile={state.activeFile}
          onSelectFile={state.setActiveFile}
        />
      ),
    },
  ], [t, projectId, state.activeFile, state.setActiveFile, vaultFiles, reloadVault, onCreateTask]);

  const rightPanels = useMemo<readonly PanelDef<RightPanelId>[]>(() => [
    {
      id: 'graph',
      label: t('vault.panel.graph'),
      Icon: GitBranch,
      render: () => (
        <GraphPanel
          files={vaultFiles}
          edges={vaultEdges}
          activeFile={state.activeFile}
          onSelectFile={state.setActiveFile}
          loading={vaultLoading}
          error={vaultError}
          allHidden={allHidden}
          projectId={projectId}
          onGraphChanged={reloadVault}
        />
      ),
    },
    {
      id: 'outline',
      label: t('vault.panel.outline'),
      Icon: List,
      render: () => (
        <OutlinePanel projectId={projectId} activeFile={state.activeFile} />
      ),
    },
    {
      id: 'backlinks',
      label: t('vault.panel.backlinks'),
      Icon: ArrowLeftRight,
      render: () => (
        <BacklinksPanel
          files={vaultFiles}
          activeFile={state.activeFile}
          onSelectFile={state.setActiveFile}
        />
      ),
    },
    {
      id: 'outgoing',
      label: t('vault.panel.outgoing'),
      Icon: ArrowRight,
      render: () => (
        <OutgoingLinksPanel
          files={vaultFiles}
          activeFile={state.activeFile}
          onSelectFile={state.setActiveFile}
        />
      ),
    },
  ], [t, projectId, state.activeFile, state.setActiveFile, vaultFiles, vaultEdges, vaultLoading, vaultError, allHidden, reloadVault]);

  // Hold off the entire vault (scan + panels + graph) until the onboarding
  // choice — that's the whole point: nothing heavy runs before the user has
  // had the chance to start in ignore-everything mode. The panels then mount
  // fresh and pick up the pre-set explorer showHidden toggle.
  if (!ready) {
    return (
      <div className="flex h-[calc(100vh-220px)] min-h-[500px] items-center justify-center border border-warm-200 rounded-lg bg-[var(--color-bg-card)]">
        <span className="text-xs text-warm-400">{showOnboarding ? '' : '문서 준비 중…'}</span>
        {showOnboarding && (
          <VaultOnboardingModal
            saving={onboardSaving}
            onIgnoreAll={handleOnboardIgnoreAll}
            onShowAll={finishOnboarding}
          />
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex h-[calc(100vh-220px)] min-h-[500px] border border-warm-200 rounded-lg overflow-hidden bg-[var(--color-bg-card)]"
    >
      <SidebarRail<LeftPanelId>
        side="left"
        collapsed={state.layout.leftCollapsed}
        onToggleCollapsed={state.toggleLeftCollapsed}
        activeId={state.panels.leftPanelId}
        onActivate={state.setLeftPanelId}
        panels={leftPanels}
        width={state.layout.leftWidth}
        actions={
          <>
            <button
              type="button"
              onClick={() => setIgnoreHelpOpen(true)}
              className="p-1.5 rounded text-warm-500 hover:bg-warm-200 hover:text-warm-700"
              title={t('vault.ignoreHelp')}
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIgnoreModalOpen(true)}
              className="p-1.5 rounded text-warm-500 hover:bg-warm-200 hover:text-warm-700"
              title=".vaultignore"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </>
        }
      />
      {!state.layout.leftCollapsed && <Resizer onResize={onLeftResize} />}

      <CenterEditor
        projectId={projectId}
        activeFile={state.activeFile}
        onSelectFile={state.setActiveFile}
        onSaved={reloadVault}
      />

      {!state.layout.rightCollapsed && <Resizer onResize={onRightResize} />}
      <SidebarRail<RightPanelId>
        side="right"
        collapsed={state.layout.rightCollapsed}
        onToggleCollapsed={state.toggleRightCollapsed}
        activeId={state.panels.rightPanelId}
        onActivate={state.setRightPanelId}
        panels={rightPanels}
        width={state.layout.rightWidth}
      />
      <VaultIgnoreModal
        open={ignoreModalOpen}
        projectId={projectId}
        onClose={() => setIgnoreModalOpen(false)}
        onSaved={reloadVault}
      />
      <VaultIgnoreHelpModal
        open={ignoreHelpOpen}
        onClose={() => setIgnoreHelpOpen(false)}
        onOpenEditor={() => { setIgnoreHelpOpen(false); setIgnoreModalOpen(true); }}
      />
    </div>
  );
}
