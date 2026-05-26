import { useMemo } from 'react';
import { FileText, ArrowLeft } from 'lucide-react';
import { useI18n } from '../../../i18n';
import type { VaultFile } from '../../../api/vault';

interface Props {
  files: VaultFile[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
}

export function BacklinksPanel({ files, activeFile, onSelectFile }: Props) {
  const { t } = useI18n();
  const active = useMemo(() => files.find((f) => f.relativePath === activeFile) ?? null, [files, activeFile]);
  const backlinks = useMemo(() => {
    if (!active) return [];
    const stem = active.stem.toLowerCase();
    const title = active.title.toLowerCase();
    return files.filter((f) =>
      f.relativePath !== active.relativePath
      && f.wikilinks.some((w) => {
        const wl = w.toLowerCase();
        return wl === stem || wl === title;
      }),
    );
  }, [files, active]);

  if (!active) {
    return <div className="text-xs text-warm-400 px-3 py-4 text-center">{t('vault.activeFile.empty')}</div>;
  }
  if (backlinks.length === 0) {
    return <div className="text-xs text-warm-400 px-3 py-4 text-center">{t('vault.backlinks.empty')}</div>;
  }
  return (
    <div className="flex flex-col py-1">
      {backlinks.map((f) => (
        <button
          key={f.relativePath}
          onClick={() => onSelectFile(f.relativePath)}
          className="w-full text-left px-2 py-1.5 hover:bg-warm-100"
        >
          <div className="flex items-center gap-1.5 text-xs">
            <ArrowLeft className="w-3 h-3 text-warm-400 shrink-0" />
            <FileText className="w-3 h-3 text-sky-500 shrink-0" />
            <span className="font-medium text-warm-800 truncate">{f.stem}</span>
          </div>
          <div className="text-[10px] text-warm-500 truncate pl-[26px] mt-0.5">{f.relativePath}</div>
        </button>
      ))}
    </div>
  );
}
