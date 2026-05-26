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
}

export function GraphPanel({ files, edges, activeFile, onSelectFile, loading }: Props) {
  const { t } = useI18n();
  if (loading && files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-warm-400">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> {t('files.loading')}
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
      />
    </div>
  );
}
