import { Loader2 } from 'lucide-react';
import { useI18n } from '../../../i18n';
import VaultGraph from '../../VaultGraph';
import type { VaultFile, VaultEdge } from '../../../api/vault';

interface Props {
  files: VaultFile[];
  edges: VaultEdge[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  loading: boolean;
  error?: boolean;
  // Zero files because every doc is .vaultignore-hidden (vs. none existing).
  allHidden?: boolean;
  projectId: string;
  onGraphChanged?: () => void;
}

export function GraphPanel({ files, edges, activeFile, onSelectFile, loading, error, allHidden, projectId, onGraphChanged }: Props) {
  const { t } = useI18n();
  // allHidden reloads always have 0 files — skip the spinner there or the
  // "all hidden" notice blinks on every background vault:changed reload.
  if (loading && files.length === 0 && !allHidden) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-warm-400">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> {t('files.loading')}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 h-full text-xs text-warm-500">
        <span>{t('vault.loadError')}</span>
        <button
          type="button"
          onClick={() => onGraphChanged?.()}
          className="px-2.5 py-1 rounded-md border border-warm-300 text-warm-600 hover:bg-warm-100"
        >
          {t('vault.retry')}
        </button>
      </div>
    );
  }
  if (files.length === 0 && allHidden) {
    return (
      <div className="flex items-center justify-center h-full px-6 text-center text-xs text-warm-500">
        {t('vault.allHidden')}
      </div>
    );
  }
  return (
    <div className="h-full p-1">
      <VaultGraph
        files={files}
        edges={edges}
        selectedPath={activeFile}
        onSelectFile={(p) => { if (p) onSelectFile(p); }}
        projectId={projectId}
        onGraphChanged={onGraphChanged}
      />
    </div>
  );
}
