import { useMemo } from 'react';
import { useI18n } from '../../i18n';
import { entryFromPath } from './files-utils';
import { PreviewPanel } from './PreviewPanel';

interface Props {
  projectId: string;
  activeFile: string | null;
  onSelectFile: (path: string | null) => void;
  onSaved: () => void;
}

export function CenterEditor({ projectId, activeFile, onSelectFile, onSaved }: Props) {
  const { t } = useI18n();
  const entry = useMemo(() => (activeFile ? entryFromPath(activeFile) : null), [activeFile]);

  if (!activeFile) {
    return (
      <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center text-xs text-warm-400 bg-[var(--color-bg-card)]">
        {t('vault.activeFile.empty')}
      </div>
    );
  }
  return (
    <PreviewPanel
      projectId={projectId}
      path={activeFile}
      entry={entry}
      onNavigateFile={onSelectFile}
      onSaved={onSaved}
      trackEdits
    />
  );
}
