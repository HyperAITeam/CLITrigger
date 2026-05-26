import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Search, Tag, GitBranch, List, ArrowLeftRight, ArrowRight } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useVaultState, type LeftPanelId, type RightPanelId } from './vault-state';
import { Resizer } from './Resizer';
import { SidebarRail, type PanelDef } from './SidebarRail';
import { getVaultGraph, type VaultFile, type VaultEdge } from '../../api/vault';
import { FileExplorerPanel } from './panels/FileExplorerPanel';
import { SearchPanel } from './panels/SearchPanel';
import { TagsPanel } from './panels/TagsPanel';
import { GraphPanel } from './panels/GraphPanel';
import { OutlinePanel } from './panels/OutlinePanel';
import { BacklinksPanel } from './panels/BacklinksPanel';
import { OutgoingLinksPanel } from './panels/OutgoingLinksPanel';
import { CenterEditor } from './CenterEditor';

interface Props {
  projectId: string;
}

export default function VaultLayout({ projectId }: Props) {
  const { t } = useI18n();
  const state = useVaultState(projectId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [vaultFiles, setVaultFiles] = useState<VaultFile[]>([]);
  const [vaultEdges, setVaultEdges] = useState<VaultEdge[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);

  const reloadVault = useCallback(() => {
    setVaultLoading(true);
    getVaultGraph(projectId)
      .then((g) => { setVaultFiles(g.files); setVaultEdges(g.edges); })
      .catch(() => { setVaultFiles([]); setVaultEdges([]); })
      .finally(() => setVaultLoading(false));
  }, [projectId]);

  useEffect(() => { reloadVault(); }, [reloadVault]);

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
  ], [t, projectId, state.activeFile, state.setActiveFile, vaultFiles]);

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
  ], [t, projectId, state.activeFile, state.setActiveFile, vaultFiles, vaultEdges, vaultLoading]);

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
    </div>
  );
}
